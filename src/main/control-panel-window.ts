/**
 * Control Panel ウィンドウ(FR-7 + FR-15)。chat-pane.md 論点1「ウィンドウ幅の配分とリサイズ」が正本。
 *
 * このウィンドウは「会話ペイン(左・常時表示) + 折りたたみタブ + Control Panel(右・6タブ)」の
 * 1ウィンドウ構成(C-21)。**折りたたみは内部レイアウトの再フローではなく、BrowserWindow 自体の
 * 幅を会話ペイン幅まで縮小する**(chat-pane.md 論点1)。よってレンダラー側でCSS幅を変えるのではなく、
 * Renderer → IPC → Main で `setBounds()` を呼ぶ。
 *
 * 幅の配分(chat-pane.md の表):
 *   会話ペイン 560(可変・flex:1) + 折りたたみタブ 16 + Control Panel 400(固定)
 *   = 展開 976px / 折りたたみ 576px。**折りたたみタブでの切替はこの2値へ厳密にスナップする既定サイズ**
 *   であり、手動リサイズの下限ではない(下限は別途 MIN_CONVERSATION_PANE_WIDTH から算出する。
 *   2026-07-20 ユーザー指示)。
 *
 * ── 実測に基づく決定(Electron 43.1.1 / macOS。オフスクリーンで計測) ──────────────
 *
 * 1. **`resizable: false` でも `setBounds()` は効く**(976→576→976 いずれも要求どおり反映され、
 *    `isResizable()` は false のまま)。よって「リサイズ不可にすると折りたたみできない」という
 *    制約は存在しない。
 *
 * 2. **`minimumSize`/`maximumSize` は `setBounds()` をクランプする**。`minWidth: 976` のまま
 *    576 を要求すると 976 のまま無視された。**幅の下限/上限を付け替えてから setBounds する**
 *    という順序が必須(付け替えなしでは黙って効かない)。`setCollapsed()` が setBounds の前後で
 *    min/maxSize を付け替えている(スナップ→開放)のはこの実測に基づく。
 *
 * 3. **アニメーション(`setBounds(bounds, animate)`)は採否を「瞬時切替」に決定**した
 *    (chat-pane.md 実装TODO・要決着)。理由: `show: false` のオフスクリーンでは animate:true でも
 *    `getBounds()` が即座に目標値を返し(0〜3ms)、**アニメーションの所要時間を実測できない**。
 *    設計は「実測してから見た目を合わせるか、瞬時切替で割り切るかを決める(推測で決めない)」と
 *    しており、実測できない以上、OS任せの不明な所要時間にモックアップの `transition: width 0.25s`
 *    を推測で合わせることはしない。**`animate` を省略して瞬時に切り替える**。
 *
 * ── resizable / minimumSize の決定 ──────────────────────────────
 *
 * **幅・高さともに可変。下限のみ強制**する(上限なし)。
 *
 * - 2026-07-20(1回目・ユーザー指示): 当初「幅は完全固定(min=max)」としていたのを、
 *   「下限のみ展開976px/折りたたみ576px・上限は開放」に変更(会話ペインは flex:1 のため、
 *   幅を広げた分はそのまま会話ペインが受け取り、Control Panelの400px固定列は崩れない)。
 * - 2026-07-20(2回目・ユーザー指示): **下限をさらに引き下げ**、会話ペイン自身の最小幅
 *   `MIN_CONVERSATION_PANE_WIDTH`(393px。憑坐状態帯の「霊力状態 ── {Moodラベル}」が
 *   折り返さない幅+全角1.5文字ぶんを実測)を基準にした
 *   `minWindowWidthForCollapsed(collapsed)`(展開809px/折りたたみ409px)へ変更。
 *   Control Panel(400px)自体の大きさは変えない(ユーザー指示「設定画面は現状で固定」)。
 *
 * **折りたたみタブでの切替は、手動リサイズの有無に関わらず厳密に976/576(`widthForCollapsed`)
 * へスナップする**(`setCollapsed()`)。手動で976pxより広げていても、畳めば576pxに戻り、
 * その状態を展開すれば976pxに戻る(広げた分は記憶しない)。config が保持するのは折りたたみの
 * 真偽値のみで、任意の手動幅を永続化する仕組みは持たない(既存のconfigスキーマを拡張しない選択)。
 *
 * 形式非依存: このウィンドウは Live2D/スプライトセットのどちらにも依存しない。ウィンドウ幅は
 * 会話ペイン+タブ+Control Panel の**UIレイアウト**から決まり、モデルの `baseResolution` を
 * 参照しない(それを使うのはキャラクターウィンドウのみ。character-window.md)。会話ペイン自体も
 * `CharacterRenderer` に触れず EmotionEngine へ trigger/release を送るだけである
 * (chat-pane.md「形式による分岐について」)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import { join } from 'node:path';

import { guardNavigation, openExternalHttpOnly } from './window-security';

import type { ConfigStore } from './config-store';
import { IPC, CONTROL_PANEL_COLLAPSED_ARG, ONBOARDING_PENDING_ARG } from '../shared/ipc';

/** 会話ペインの目安幅(実際は flex:1 で可変。総幅の算出根拠として持つ)。 */
export const CONVERSATION_PANE_WIDTH = 560;
/** 折りたたみタブ(つまみ)の幅。App.tsx の button と一致させること。 */
export const COLLAPSE_TAB_WIDTH = 16;
/** Control Panel(6タブ)の固定幅。ControlPanelTabs.tsx の width と一致させること。 */
export const CONTROL_PANEL_WIDTH = 400;

/** 展開時のウィンドウ幅(976)。 */
export const EXPANDED_WIDTH = CONVERSATION_PANE_WIDTH + COLLAPSE_TAB_WIDTH + CONTROL_PANEL_WIDTH;
/** 折りたたみ時のウィンドウ幅(576)。 */
export const COLLAPSED_WIDTH = CONVERSATION_PANE_WIDTH + COLLAPSE_TAB_WIDTH;

/** 既定の高さ。従来の 1000×720 から幅のみ 976 へ変更した(chat-pane.md 実装TODO: 差を埋める)。 */
export const DEFAULT_HEIGHT = 720;
/** 高さの下限。憑坐状態帯 + 履歴 + 入力欄が破綻しない最小値。 */
export const MIN_HEIGHT = 480;
/**
 * 幅・高さの上限(事実上の無制限)。`setMaximumSize()` は引数をネイティブのintへ変換するため
 * `Number.MAX_SAFE_INTEGER` を渡すと "conversion failure" で例外になる(実測。オフスクリーン検証で検出)。
 * 現実の画面サイズを大きく超える有限値を使う。
 */
export const MAX_WIDTH = 100000;
export const MAX_HEIGHT = 100000;

/**
 * 会話ペインの最小幅(2026-07-20 ユーザー指示)。「憑坐状態帯の『霊力状態 ── {Moodラベル}』が
 * 折り返さずに収まる幅 + 全角1.5文字ぶん」を実測して求めた値。
 *
 * 実測(Chromium。'Zen Antique', serif 19px。ConversationPane.tsx の実スタイルと同じ条件):
 *   - 「霊力状態 ── 静穏(せいおん)」の幅 = 252.59px(3種のMoodラベル中で最大。confident 252.03px /
 *     tired 249.94px よりも広く、これを基準にすれば他の2つも折り返さない)
 *   - 全角1文字の幅 = 19px(≒1em。「1.5文字」は 28.5px として扱う)
 *
 * **実測条件が本番と一致することの確認**: このアプリは Google Fonts を同梱しない方針のため
 * (App.tsx 冒頭コメント / 未決事項C2)、本番では 'Zen Antique' は解決されず総称 `serif` へ
 * フォールバックする。今回の計測機にも 'Zen Antique' のフォントファイルは存在しない
 * (`find /System/Library/Fonts /Library/Fonts ~/Library/Fonts` で確認)ため、
 * `'Zen Antique', serif` と、実在しないダミーフォント名 `'Definitely-Not-Installed-XYZ', serif`
 * とで幅を比較したところ**完全に同一(252.59375px)**だった。これは実測が最初から `serif`
 * フォールバックで行われていた証拠であり、**本番の描画条件と一致する**(推測でなく確認済み)。
 * この行は 憑坐状態帯(左右padding 18px×2) の中で、呪紋リング+アバター(60px, flexShrink:0) と
 * gap(14px) を挟んで並ぶ(ConversationPane.tsx の憑坐状態帯マークアップ)。会話ペイン自体にも
 * 右ボーダー1pxがある。よって「テキストが折り返さない最小の会話ペイン幅」は:
 *   36(左右padding) + 1(border) + 60(avatar) + 14(gap) + 252.59(テキスト) + 28.5(1.5文字)
 *   ≈ 392.1px → 切り上げて 393px。
 *
 * この値は Control Panel(400px固定・ユーザー指示により不変)より小さい会話ペインの下限を
 * 与える。展開時・折りたたみ時いずれも、この幅を下回るまで会話ペインを縮められない。
 */
export const MIN_CONVERSATION_PANE_WIDTH = 393;

/**
 * 現在の折りたたみ状態での、ウィンドウの最小幅(手動リサイズの下限)。
 * 会話ペインは常に MIN_CONVERSATION_PANE_WIDTH を下回れない。Control Panel(400px)は
 * 展開時のみ加算し、その大きさ自体は変更しない(ユーザー指示「設定画面は現状で固定」)。
 */
export function minWindowWidthForCollapsed(collapsed: boolean): number {
  return collapsed
    ? MIN_CONVERSATION_PANE_WIDTH + COLLAPSE_TAB_WIDTH
    : MIN_CONVERSATION_PANE_WIDTH + COLLAPSE_TAB_WIDTH + CONTROL_PANEL_WIDTH;
}

/**
 * 折りたたみ切替(トグルタブ)が厳密にスナップする既定のウィンドウ幅(976/576。純粋関数。
 * オフスクリーン検証用に切り出す)。**これは下限ではない** — 手動リサイズの下限は
 * minWindowWidthForCollapsed() が別に定める(2026-07-20の仕様変更でこの2つは分離した)。
 */
export function widthForCollapsed(collapsed: boolean): number {
  return collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
}

/**
 * 展開で右辺が伸びたときに、ウィンドウが workArea からはみ出さないよう左上のxを寄せる(純粋関数)。
 *
 * **macOSは画面外座標を補正しない**(character-window.md の実測)。折りたたみは x を保ったまま
 * 右辺だけを +400px 伸ばすため、ディスプレイ右端寄りに置いた状態で展開すると Control Panel 側が
 * 画面外に出る。CharacterWindowと違い「畳めば戻せる」逃げ道はあるが、設定を操作したくて展開した
 * のに設定側が見えないのは本末転倒なので、はみ出す場合のみ左へ寄せる。
 *
 * ユーザーが置いた位置は可能な限り動かさない(はみ出さないなら x はそのまま)。ウィンドウ幅が
 * workArea より広い場合は左端に合わせる(右側を切るより左を優先する)。
 */
export function clampXForWidth(x: number, width: number, workArea: { x: number; width: number }): number {
  const maxX = workArea.x + workArea.width - width;
  if (maxX < workArea.x) {
    return workArea.x;
  }
  return Math.min(Math.max(x, workArea.x), maxX);
}

export interface ControlPanelWindowDeps {
  configStore: ConfigStore;
  /** electron-vite dev の ELECTRON_RENDERER_URL。無ければ(prod)ローカルサーバー /panel から読む。 */
  rendererUrl?: string;
  /** ローカルサーバーの実ポート(生成時点で解決するため getter で受ける。未起動なら null)。 */
  getServerPort: () => number | null;
  /** preload スクリプトの絶対パス。 */
  preloadPath: string;
}

export class ControlPanelWindow {
  private readonly deps: ControlPanelWindowDeps;
  private win: BrowserWindow | null = null;

  constructor(deps: ControlPanelWindowDeps) {
    this.deps = deps;
    this.registerIpc();
  }

  /** 現在のウィンドウ(未生成/破棄後は null)。 */
  get browserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** Control Panel を開く(既に開いていればフォーカス)。Tray メニュー・activate から呼ぶ。 */
  open(): BrowserWindow {
    const existing = this.browserWindow;
    if (existing) {
      if (existing.isMinimized()) {
        existing.restore();
      }
      existing.focus();
      return existing;
    }
    return this.create();
  }

  /**
   * 折りたたみを切り替え、ウィンドウ幅を変更して config へ保存する。
   * 高さと左上座標(x, y)は保持し、**右辺だけが動く**ようにする(chat-pane.md 実装時の注意)。
   * 例外は展開時に右辺が workArea を越える場合のみで、そのときだけ x を左へ寄せる
   * (clampXForWidth。macOSは画面外座標を補正しないため)。
   */
  setCollapsed(collapsed: boolean): void {
    this.deps.configStore.update((draft) => {
      draft.general.controlPanelCollapsed = collapsed;
    });

    const win = this.browserWindow;
    if (!win) {
      // ウィンドウが無くても保存は済ませる(次回起動時にその幅で生成される)。
      return;
    }
    const bounds = win.getBounds();
    const width = widthForCollapsed(collapsed);
    // 実測2: min/max は setBounds をクランプするため、**必ず先に**付け替える。折りたたみ切替は
    // 手動リサイズの有無に関わらず厳密に width へスナップさせたいので、一時的に上限も width へ
    // 絞ってから setBounds し(通常状態は上限を開放しているため、これが無いと縮む方向にしか
    // 効かない)、スナップ後に「下限=width・上限=開放」という通常のモード制約へ戻す。
    win.setMinimumSize(width, MIN_HEIGHT);
    win.setMaximumSize(width, MAX_HEIGHT);
    // 展開で右辺が伸びる場合のみ、画面外へ出ないよう x を寄せる(macOSは自動補正しない)。
    const workArea = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
    const x = clampXForWidth(bounds.x, width, workArea);
    // 実測3: animate は指定しない(瞬時切替)。y/height は現在値を保つ。
    win.setBounds({ x, y: bounds.y, width, height: bounds.height });
    // スナップが終わったら、そのモードの下限(minWindowWidthForCollapsed)まで開放する。
    this.applySizeConstraints(win, collapsed);
  }

  /** アプリ終了時: IPC を外し、ウィンドウを破棄する。 */
  dispose(): void {
    this.teardownIpc();
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }

  // ── 内部 ───────────────────────────────────────────

  private create(): BrowserWindow {
    // 次回起動時は保存済みの折りたたみ状態どおりの幅で**生成する**(開いてからリサイズすると
    // 一瞬広い窓が見えるため。chat-pane.md 実装時の注意)。
    const collapsed = this.deps.configStore.current.general.controlPanelCollapsed;
    const width = widthForCollapsed(collapsed);

    const win = new BrowserWindow({
      width,
      height: DEFAULT_HEIGHT,
      show: false,
      title: 'ヨリマシ.app',
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 初期折りたたみ状態を preload へ同期的に渡す(IPC非同期だと展開レイアウトが一瞬見える)。
        additionalArguments: [
          `${CONTROL_PANEL_COLLAPSED_ARG}${collapsed}`,
          // 初回起動フロー(FR-14)の要否。最初のフレームから正しく描くため起動引数で渡す
          // (IPCだと Control Panel の中身が一瞬見えてからオンボーディングが被さる)。
          `${ONBOARDING_PENDING_ARG}${!this.deps.configStore.current.onboarding.completed}`,
        ],
      },
    });
    this.win = win;

    // 下限のみ現在モードの下限幅(minWindowWidthForCollapsed)に固定し、上限は開放する。
    // 生成直後に適用する。
    this.applySizeConstraints(win, collapsed);

    win.on('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.win = null;
    });

    // レンダラー内のリンクは外部ブラウザで開き、Electronウィンドウを乗っ取らせない(FR-13 / security.md
    // 対策8)。権利タブ等は正当な外部リンクを持つため http/https のみ外部で開き(それ以外のスキームは拒否)、
    // 自オリジン外へのページ遷移自体も封じる。
    win.webContents.setWindowOpenHandler(openExternalHttpOnly);
    guardNavigation(win.webContents);

    this.load(win);
    return win;
  }

  /**
   * 幅の下限を minWindowWidthForCollapsed(collapsed)(会話ペインの最小幅ベース)に設定し、
   * 上限は幅・高さとも事実上無制限にする。「その時点のモードの下限より狭くはできないが、
   * 広げるのは自由」という通常状態の制約(2026-07-20 ユーザー指示で下限を引き下げた)。
   */
  private applySizeConstraints(win: BrowserWindow, collapsed: boolean): void {
    win.setMinimumSize(minWindowWidthForCollapsed(collapsed), MIN_HEIGHT);
    win.setMaximumSize(MAX_WIDTH, MAX_HEIGHT);
  }

  /**
   * 読み込み(C3)。dev は Vite、prod はローカルサーバー /panel。
   * Control Panel は WebCodecs 不要かつ、サーバー障害でも表示自体はブロックしない(可用性NFR)ため、
   * サーバー未起動時は loadFile へフォールバックする。
   */
  private load(win: BrowserWindow): void {
    const { rendererUrl } = this.deps;
    if (rendererUrl) {
      void win.loadURL(`${rendererUrl}/control-panel/index.html`);
      return;
    }
    const port = this.deps.getServerPort();
    if (port != null) {
      void win.loadURL(`http://127.0.0.1:${port}/panel`);
      return;
    }
    // loadFile はOSのファイルシステムパスを取る。URL.pathname はパーセントエンコード済み文字列を
    // 返すため渡してはいけない(配布名「ヨリマシ.app」自体が非ASCIIで、実在しないパスになる)。
    void win.loadFile(join(__dirname, '../renderer/control-panel/index.html'));
  }

  private registerIpc(): void {
    ipcMain.on(IPC.ControlPanelSetCollapsed, (event: IpcMainEvent, collapsed: unknown) => {
      if (!this.isSender(event.sender) || typeof collapsed !== 'boolean') {
        return;
      }
      this.setCollapsed(collapsed);
    });
  }

  /** IPCの送信元がこの Control Panel ウィンドウのときだけ操作を許可する(キャラウィンドウ等を弾く)。 */
  private isSender(sender: Electron.WebContents): boolean {
    const win = this.browserWindow;
    return win !== null && win.webContents === sender;
  }

  private teardownIpc(): void {
    ipcMain.removeAllListeners(IPC.ControlPanelSetCollapsed);
  }
}
