/**
 * キャラクター表示ウィンドウ(FR-6)。character-window.md が正本。
 *
 * FR-6の機構(すべて実機実測済み。character-window.md「ウィンドウ生成オプション」):
 * - 透過・枠なし・影なし・タスクバー非表示・リサイズ不可
 * - `setAlwaysOnTop(true, 'floating')`(`'normal'` は最前面が無効になるので使わない)
 * - `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`(Spaces追従・フルスクリーンは妨げない)
 * - クリックスルーは `setIgnoreMouseEvents(true, { forward: true })`(既定ON。config.general.clickThrough)
 *
 * 位置解決(window-position.ts)は純粋関数へ分離してオフスクリーン検証している。ここでは
 * Electronの `screen` から DisplayEnv を組み立てて渡し、起動時と display-* イベント時に再適用する。
 *
 * 形式非依存: ウィンドウの透過・最前面・クリックスルー・位置はLive2D/スプライトセットで共通。
 * サイズだけは形式で算出元が異なるが、両形式とも `ModelSlot.baseResolution`(形式共通・必須。
 * character-window.md 案2で決着済み)× displaySize で決まるため、ここでの分岐は不要。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import type { ConfigStore } from './config-store';
import type { AppConfig, ModelSlot } from '../shared/config-schema';
import { IPC, type WindowPoint } from '../shared/ipc';
import {
  resolvePosition,
  defaultPosition,
  type DisplayEnv,
  type Point,
  type Rect,
  type Size,
} from './window-position';

/** モデル未導入時の基準解像度。導入後は ModelSlot.baseResolution が使われる(onboarding #10/#5)。 */
export const FALLBACK_BASE_RESOLUTION: Size = { width: 400, height: 400 };

/** windowPosition のドラッグ終了時保存デバウンス(ms)。moved連発でconfig書き込みが頻発するのを防ぐ。 */
const POSITION_SAVE_DEBOUNCE_MS = 500;

export interface CharacterWindowDeps {
  configStore: ConfigStore;
  /** electron-vite dev の ELECTRON_RENDERER_URL。無ければ(prod)ローカルサーバーから読む。 */
  rendererUrl?: string;
  /** ローカルサーバーの実ポート(C3: prod時 http://127.0.0.1:<port>/character から読む)。 */
  serverPort: number | null;
  /** preload スクリプトの絶対パス。 */
  preloadPath: string;
  /** クリックスルーOFF時の右クリックで共通メニューを表示するコールバック(index.tsが配線)。 */
  onContextMenu?: (win: BrowserWindow) => void;
}

/**
 * config から今アクティブなモデルスロットを1つ選ぶ。
 * v1は最小限: manualActiveId 一致 → そのスロット、無ければ先頭スロット、スロット無しなら null。
 * autoSwitchByMode 等の本格的な選択ロジックはモデル管理(#5/model-mapping-ui.md)側で精緻化する。
 */
export function resolveActiveModel(config: AppConfig): ModelSlot | null {
  const { slots, manualActiveId } = config.model;
  if (slots.length === 0) {
    return null;
  }
  if (manualActiveId) {
    const found = slots.find((s) => s.id === manualActiveId);
    if (found) {
      return found;
    }
  }
  return slots[0] ?? null;
}

/** アクティブモデルの baseResolution × displaySize でウィンドウの物理サイズを決める。 */
export function resolveWindowSize(config: AppConfig): Size {
  const active = resolveActiveModel(config);
  const base = active?.baseResolution ?? FALLBACK_BASE_RESOLUTION;
  const scale = config.general.displaySize;
  return {
    width: Math.max(1, Math.round(base.width * scale)),
    height: Math.max(1, Math.round(base.height * scale)),
  };
}

export class CharacterWindow {
  private readonly deps: CharacterWindowDeps;
  private win: BrowserWindow | null = null;
  private savePositionTimer: NodeJS.Timeout | null = null;
  private quitting = false;
  private readonly onDisplayChange = () => this.reapplyPositionOnDisplayChange();
  private readonly onBeforeQuit = () => {
    this.quitting = true;
  };

  constructor(deps: CharacterWindowDeps) {
    this.deps = deps;
  }

  /** 現在のウィンドウ(未生成/破棄後はnull)。 */
  get browserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** ウィンドウを生成し、位置解決・クリックスルー適用・IPC/ディスプレイ監視を配線して表示する。 */
  create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }
    const config = this.deps.configStore.current;
    const size = resolveWindowSize(config);
    const pos = resolvePosition(config.general.windowPosition, size, this.buildDisplayEnv());

    const win = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false, // 透過ウィンドウに影が付くと矩形の輪郭が見えてしまう
      skipTaskbar: true,
      title: '常世灯里',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.win = win;

    // 最前面レベルは 'floating'。'screen-saver' は他アプリのフルスクリーンにまで居座るため使わない。
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.applyClickThrough(config.general.clickThrough);

    win.on('ready-to-show', () => win.show());
    // 常駐マスコットのため、アプリ終了時以外はウィンドウを閉じさせない。フォーカス中の Cmd+W 等で
    // 破棄されると、枠なし・メニューバー経由でしか操作できず復帰手段が無くなる。終了時は
    // dispose() → destroy() で片付けるが、destroy() は 'close' を発火しないためこのガードに妨げられない。
    win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
      }
    });
    win.on('closed', () => this.handleClosed());

    this.registerIpc();
    app.on('before-quit', this.onBeforeQuit);
    screen.on('display-added', this.onDisplayChange);
    screen.on('display-removed', this.onDisplayChange);
    screen.on('display-metrics-changed', this.onDisplayChange);

    void win.loadURL(this.resolveLoadUrl());
    return win;
  }

  /** クリックスルーを切り替え、config へ保存する(メニューバーのチェックボックスから呼ぶ)。 */
  setClickThrough(value: boolean): void {
    this.applyClickThrough(value);
    this.deps.configStore.update((draft) => {
      draft.general.clickThrough = value;
    });
  }

  /** 位置を初期配置(右下)へ戻す。自動クランプが効かなかった場合の最後の逃げ道(論点3)。 */
  resetPosition(): void {
    const win = this.browserWindow;
    if (!win) {
      return;
    }
    const [width, height] = win.getSize();
    const primary = screen.getPrimaryDisplay().workArea;
    const pos = defaultPosition({ width, height }, toRect(primary));
    win.setPosition(pos.x, pos.y);
    this.persistPosition(pos);
  }

  /** アプリ終了時: タイマーとディスプレイ監視を片付け、ウィンドウを閉じる。 */
  dispose(): void {
    this.quitting = true; // close ガードを解除してから destroy する(destroy自体は'close'を発火しない)
    this.clearSaveTimer();
    this.teardownListeners();
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }

  // ── 内部 ───────────────────────────────────────────

  private resolveLoadUrl(): string {
    if (this.deps.rendererUrl) {
      // dev: electron-vite の Vite サーバー(http://localhost:xxxx、secure context)。HMRが効く。
      return `${this.deps.rendererUrl}/character/index.html`;
    }
    // prod(C3): ローカルサーバーから読む。file:// はsecure contextでなくWebCodecsが無効になるため使わない
    // (security.md 7章)。http://127.0.0.1 はsecure context扱い。
    return `http://127.0.0.1:${this.deps.serverPort}/character`;
  }

  private applyClickThrough(value: boolean): void {
    const win = this.browserWindow;
    if (!win) {
      return;
    }
    // { forward: true }: 下のウィンドウへ透過しつつ Renderer 側では mousemove を受け取り続ける
    // (ホバー演出や将来のアルファ判定に必要。character-window.md)。
    win.setIgnoreMouseEvents(value, value ? { forward: true } : undefined);
  }

  private buildDisplayEnv(): DisplayEnv {
    return {
      workAreas: screen.getAllDisplays().map((d) => toRect(d.workArea)),
      primaryWorkArea: toRect(screen.getPrimaryDisplay().workArea),
      nearestWorkArea: (point: Point) => toRect(screen.getDisplayNearestPoint(point).workArea),
    };
  }

  /**
   * ディスプレイ構成変更時に位置を再解決する。可視性を失った場合だけ移動する
   * (ユーザーが意図して置いた位置を勝手に動かさない。character-window.md 論点1)。
   */
  private reapplyPositionOnDisplayChange(): void {
    const win = this.browserWindow;
    if (!win) {
      return;
    }
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    const resolved = resolvePosition({ x, y }, { width, height }, this.buildDisplayEnv());
    if (resolved.x !== x || resolved.y !== y) {
      win.setPosition(resolved.x, resolved.y);
      this.persistPosition(resolved);
    }
  }

  private registerIpc(): void {
    ipcMain.handle(IPC.CharacterBeginDrag, (event: IpcMainInvokeEvent): WindowPoint | null => {
      const win = this.windowForSender(event.sender);
      if (!win) {
        return null;
      }
      const [x, y] = win.getPosition();
      return { x, y };
    });
    ipcMain.on(IPC.CharacterDragMove, (event: IpcMainEvent, point: unknown) => {
      const win = this.windowForSender(event.sender);
      if (!win || !isWindowPoint(point)) {
        return;
      }
      // ドラッグ中はクランプしない(掴んでいる最中なので見失いようがない。論点1)。
      win.setPosition(Math.round(point.x), Math.round(point.y));
    });
    ipcMain.on(IPC.CharacterEndDrag, (event: IpcMainEvent) => {
      const win = this.windowForSender(event.sender);
      if (!win) {
        return;
      }
      const [x, y] = win.getPosition();
      this.schedulePositionSave({ x, y });
    });
    ipcMain.on(IPC.CharacterContextMenu, (event: IpcMainEvent) => {
      const win = this.windowForSender(event.sender);
      if (win) {
        this.deps.onContextMenu?.(win);
      }
    });
  }

  /** IPCの送信元がこのキャラクターウィンドウのときだけ操作を許可する(Control Panelからの誤配線を弾く)。 */
  private windowForSender(sender: Electron.WebContents): BrowserWindow | null {
    const win = this.browserWindow;
    return win && win.webContents === sender ? win : null;
  }

  private schedulePositionSave(pos: WindowPoint): void {
    if (this.savePositionTimer) {
      clearTimeout(this.savePositionTimer);
    }
    this.savePositionTimer = setTimeout(() => {
      this.savePositionTimer = null;
      this.persistPosition(pos);
    }, POSITION_SAVE_DEBOUNCE_MS);
  }

  private persistPosition(pos: WindowPoint): void {
    this.deps.configStore.update((draft) => {
      draft.general.windowPosition = { x: pos.x, y: pos.y };
    });
  }

  private handleClosed(): void {
    // dispose() と後片付け内容を揃える(タイマーも止める。閉じた後に遅延保存が走らないように)。
    this.clearSaveTimer();
    this.teardownListeners();
    this.win = null;
  }

  private clearSaveTimer(): void {
    if (this.savePositionTimer) {
      clearTimeout(this.savePositionTimer);
      this.savePositionTimer = null;
    }
  }

  private teardownListeners(): void {
    app.removeListener('before-quit', this.onBeforeQuit);
    screen.removeListener('display-added', this.onDisplayChange);
    screen.removeListener('display-removed', this.onDisplayChange);
    screen.removeListener('display-metrics-changed', this.onDisplayChange);
    ipcMain.removeHandler(IPC.CharacterBeginDrag);
    ipcMain.removeAllListeners(IPC.CharacterDragMove);
    ipcMain.removeAllListeners(IPC.CharacterEndDrag);
    ipcMain.removeAllListeners(IPC.CharacterContextMenu);
  }
}

/** Electron.Rectangle(= {x,y,width,height}) を window-position.ts の Rect に写す。 */
function toRect(r: { x: number; y: number; width: number; height: number }): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function isWindowPoint(v: unknown): v is WindowPoint {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as WindowPoint).x === 'number' &&
    typeof (v as WindowPoint).y === 'number'
  );
}
