import { app, ipcMain, type Tray } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { EmotionEngine } from './emotion-engine';
import { ConfigStore } from './config-store';
import { ensureAuthToken } from './local-server/auth-token';
import { LocalServer } from './local-server/local-server';
import { CharacterWindow, resolveActiveModel } from './character-window';
import { ControlPanelWindow } from './control-panel-window';
import { ChatAdapter } from './chat-adapter/chat-adapter';
import { buildAppMenu, createTray, type AppMenuDeps } from './tray-menu';
import type { CharacterBootstrapModel } from '../shared/bootstrap';
import { IPC } from '../shared/ipc';
import type { EmotionSnapshot } from '../shared/emotions';
import type { ChatConfigPatch, ChatConfigSnapshot } from '../shared/chat';

/**
 * Mainプロセス。
 *
 * 実装済み:
 * - EmotionEngine(FR-4): 全10状態の権威ある実行時状態。WS経由でRendererへ配信する。
 * - ローカルサーバー(FR-2/FR-13): 127.0.0.1限定・トークン認証・/hook・/panel・/character・
 *   /models/*・WS /ws を提供(docs/api.md・security.md)。
 * - config.json永続化(FR-10): ConfigStore が userData/config.json をロード/保存する。
 * - キャラクター表示ウィンドウ(FR-6): CharacterWindow が透過・枠なし・最前面・クリックスルーの
 *   ウィンドウを生成し、位置解決/永続化・ドラッグ・メニューバーアイコン(Tray)を配線する
 *   (character-window.md)。
 * - Control Panelウィンドウ(FR-7/FR-15/#7): ControlPanelWindow が2ペイン構成のウィンドウを生成し、
 *   折りたたみ時に BrowserWindow の幅を 976⇄576px へ変更する(chat-pane.md 論点1)。
 * - Rendererの読み込み元をローカルサーバーへ移行(C3): キャラクターウィンドウは
 *   http://127.0.0.1:<port>/character、Control Panel は /panel から読む(prod)。file:// は
 *   secure contextでなくWebCodecsが無効になるため使わない(security.md 7章)。dev は
 *   electron-vite の Vite サーバー(ELECTRON_RENDERER_URL、これもsecure context)。
 *
 * - Chat Adapter mock(FR-3/#8): 会話ペインからの送信を受け、固定返答を擬似streamingで流し、
 *   thinking(sustain)→release→分類 を駆動する(chat-pane.md 論点3)。real は #12。
 *
 * 未実装:
 * - CharacterRenderer(FR-5/#5): キャラクターウィンドウ内の実描画(Live2D/スプライトセット)。
 *   現在はプレースホルダーHTMLを表示する。
 * - Code Adapter(FR-2/#9): onHookEvent → EmotionEngine の接続。
 * - Chat Adapter real(FR-3/#12): Anthropic SDK接続・APIキー導線・無通信ウォッチドッグ。
 *   **mockで代替せず**、real選択時は「未実装」を明示して失敗を返す(嘘をつかない)。
 */

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

let engine: EmotionEngine | null = null;
let localServer: LocalServer | null = null;
let configStore: ConfigStore | null = null;
let characterWindow: CharacterWindow | null = null;
let controlPanelWindow: ControlPanelWindow | null = null;
let chatAdapter: ChatAdapter | null = null;
let tray: Tray | null = null;
let unsubscribeEmotion: (() => void) | null = null;

/**
 * config と EmotionEngine の初期化はローカルサーバー起動から独立させる。サーバーが起動に
 * 失敗しても Control Panel は開けなければならない(可用性NFR)が、その生成には configStore
 * (折りたたみ状態=初期ウィンドウ幅)が、会話ペイン(FR-15)には engine が要るため。
 * サーバーが落ちていても Chat Adapter(mock)と憑坐状態帯は動く。
 */
function initCore(): void {
  configStore = ConfigStore.load(app.getPath('userData'));
  engine = new EmotionEngine(configStore.current.emotionEngine);
}

async function startLocalServer(): Promise<void> {
  const userDataDir = app.getPath('userData');

  if (!configStore || !engine) {
    throw new Error('config/EmotionEngine が未初期化です');
  }
  const config = configStore.current;

  const authToken = ensureAuthToken(userDataDir);

  const modelsRoot = join(userDataDir, 'models');
  try {
    mkdirSync(modelsRoot, { recursive: true });
  } catch {
    // 既存なら無視。配信時に個別のstatで存在確認する。
  }

  localServer = new LocalServer({
    authToken,
    preferredPort: config.codeAdapter.serverPort,
    engine,
    // ビルド済みRendererの出力ルート(out/renderer)。/panel・/character・静的資産の配信元。
    rendererRoot: join(__dirname, '../renderer'),
    modelsRoot,
    // /character HTML に「今描画すべきアクティブモデル」を埋め込む(FR-5)。configから解決。
    // モデル未導入なら null(キャラウィンドウは「モデル未導入」を表示)。
    getCharacterBootstrap: resolveCharacterBootstrap,
    // onHookEvent は Code Adapter(#9) 実装時に接続する(hooksイベント→EmotionEngine)。
  });

  const port = await localServer.start();
  // 競合フォールバックで既定8765以外に解決した場合、config.codeAdapter.serverPort へ
  // 書き戻す(dispatch.sh 等が参照するため。environments.md)。変化がなければ書かない。
  if (port !== config.codeAdapter.serverPort) {
    configStore.update((draft) => {
      draft.codeAdapter.serverPort = port;
    });
  }
  console.log(`[local-server] listening on http://127.0.0.1:${port}`);
}

/** /character に埋め込むアクティブモデルを config から解決する(未導入なら null)。 */
function resolveCharacterBootstrap(): CharacterBootstrapModel | null {
  const config = configStore?.current;
  if (!config) {
    return null;
  }
  const slot = resolveActiveModel(config);
  if (!slot) {
    return null;
  }
  return { installedDir: slot.installedDir, mappingFile: slot.mappingFile };
}

/** Control Panel を開く(既に開いていればフォーカス)。Tray メニュー・activate から呼ぶ。 */
function openControlPanel(): void {
  if (!configStore) {
    console.warn('[control-panel] config 未ロードのため Control Panel を開けません');
    return;
  }
  controlPanelWindow ??= new ControlPanelWindow({
    configStore,
    rendererUrl,
    getServerPort: () => localServer?.port ?? null,
    preloadPath: join(__dirname, '../preload/index.js'),
  });
  controlPanelWindow.open();
}

/** Control Panel ウィンドウの BrowserWindow(未生成/破棄後は null)。 */
function controlPanelBrowserWindow(): Electron.BrowserWindow | null {
  return controlPanelWindow?.browserWindow ?? null;
}

/**
 * Chat Adapter(FR-3)と憑坐状態帯への感情配信を配線する。
 *
 * 感情の配信先が2系統あるのは意図的:
 * - キャラクターウィンドウ … ローカルサーバーの WS /ws(api.md 3章)。サーバーが配信元。
 * - Control Panel(会話ペイン) … IPC。dev では Vite から読むためHTMLにトークンが埋め込まれず
 *   WSに接続できない。preload は dev/prod どちらでも効くのでこちらはIPCに寄せる。
 */
function startChatAdapter(): void {
  if (!configStore || !engine) {
    console.warn('[chat] config/EmotionEngine が未初期化のため Chat Adapter を開始できません');
    return;
  }

  chatAdapter = new ChatAdapter({
    engine,
    configStore,
    getTargetWindow: controlPanelBrowserWindow,
    onConfigChanged: broadcastChatConfig,
  });

  const currentEngine = engine;
  const currentStore = configStore;

  const isPanelSender = (sender: Electron.WebContents): boolean => {
    const win = controlPanelBrowserWindow();
    return win !== null && !win.isDestroyed() && win.webContents === sender;
  };

  ipcMain.handle(IPC.EmotionGet, (event): EmotionSnapshot => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return currentEngine.getSnapshot();
  });

  unsubscribeEmotion = currentEngine.subscribe((snapshot) => {
    const win = controlPanelBrowserWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.EmotionChanged, snapshot);
    }
  });

  // ── モード類(activeAdapter / chatAdapter.mode / model)の同期 ──────────────
  // 正本は config。Renderer側のstateは写しであり、変更も必ずここを通す。
  // Renderer内で完結させると「UI上はmockなのに実際はrealへ送る」食い違いが起きる
  // (constraints.md「アプリが自分の状態について嘘をつかない」)。
  ipcMain.handle(IPC.ChatConfigGet, (event): ChatConfigSnapshot => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return readChatConfig();
  });

  ipcMain.on(IPC.ChatConfigSet, (event, patch: unknown) => {
    if (!isPanelSender(event.sender) || typeof patch !== 'object' || patch === null) {
      return;
    }
    const { activeAdapter, chatMode, model } = patch as ChatConfigPatch;
    currentStore.update((draft) => {
      if (activeAdapter === 'code' || activeAdapter === 'chat') {
        draft.activeAdapter = activeAdapter;
      }
      // realへの切替はAPI課金が発生する操作。既定をmockから勝手に動かさないため、
      // ここでも列挙値の検証を必ず通す(C-08)。
      if (chatMode === 'mock' || chatMode === 'real') {
        draft.chatAdapter.mode = chatMode;
      }
      if (typeof model === 'string' && model.length > 0) {
        draft.chatAdapter.model = model;
      }
    });
    broadcastChatConfig();
  });
}

/** config から Renderer 向けのモードスナップショットを作る。 */
function readChatConfig(): ChatConfigSnapshot {
  const config = configStore?.current;
  return {
    activeAdapter: config?.activeAdapter ?? 'code',
    chatMode: config?.chatAdapter.mode ?? 'mock',
    model: config?.chatAdapter.model ?? '',
  };
}

/**
 * モードの現在値を Control Panel へ通知する。
 * Chat Adapter の自動切替(C-24)や **Tray からの activeAdapter 変更** でも呼ぶ
 * (呼ばないと会話ペインの「Code Adapter・待機中」表示が実体とずれる)。
 */
function broadcastChatConfig(): void {
  const win = controlPanelBrowserWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.ChatConfigChanged, readChatConfig());
  }
}

/** メニューバー・右クリック共通メニューの依存。呼び出し時点の config を読む/書く。 */
function buildMenuDeps(): AppMenuDeps {
  return {
    getActiveAdapter: () => configStore?.current.activeAdapter ?? 'code',
    setActiveAdapter: (adapter) => {
      // FR-1のアダプタ切替面。実際のAdapter稼働の切替(Code Adapter側)は #9 で接続する。
      configStore?.update((draft) => {
        draft.activeAdapter = adapter;
      });
      // 会話ペインの表示(「Code Adapter・待機中」等)を実体に追従させる。
      broadcastChatConfig();
    },
    getClickThrough: () => configStore?.current.general.clickThrough ?? true,
    setClickThrough: (value) => characterWindow?.setClickThrough(value),
    openControlPanel,
    resetCharacterPosition: () => characterWindow?.resetPosition(),
    quit: () => app.quit(),
  };
}

/** キャラクターウィンドウを生成する。prod はサーバー必須(WebCodecs)のため port が要る。 */
function startCharacterWindow(): void {
  const canLoad = Boolean(rendererUrl) || localServer?.port != null;
  if (!configStore || !canLoad) {
    console.warn(
      '[character] ローカルサーバー未起動のためキャラクターウィンドウを開けません(サーバー復旧後に再起動が必要)',
    );
    return;
  }
  characterWindow = new CharacterWindow({
    configStore,
    rendererUrl,
    serverPort: localServer?.port ?? null,
    preloadPath: join(__dirname, '../preload/index.js'),
    // クリックスルーOFF時の右クリック → メニューバーと同一の共通メニューを表示する(論点3)。
    onContextMenu: (win) => buildAppMenu(buildMenuDeps()).popup({ window: win }),
  });
  characterWindow.create();
}

void app.whenReady().then(async () => {
  initCore();

  try {
    await startLocalServer();
  } catch (err) {
    // ローカルサーバーの起動失敗はコントロールパネルの表示自体はブロックしない(可用性NFR)。
    // hooks受信・状態配信は無効になるため、ログには残す。
    console.error('[local-server] failed to start:', err);
  }

  openControlPanel();
  // Chat Adapter は Control Panel ウィンドウへ実況を送るため、生成後に配線する。
  startChatAdapter();
  startCharacterWindow();
  // メニューバーアイコンは常設(要件定義書 C-19)。クリックスルーONでも操作面を確保する。
  tray = createTray(buildMenuDeps());

  app.on('activate', () => {
    // macOS: Dockアイコン再クリック時。Control Panel を前面に出す。
    openControlPanel();
  });
});

// アプリ終了時にサーバー・EmotionEngine・ウィンドウ・Trayを確実に片付ける。
app.on('will-quit', () => {
  localServer?.stop().catch((err) => console.error('[local-server] stop failed:', err));
  // Chat Adapter は engine より先に片付ける(進行中のstreamをabortし、release('thinking')を
  // 通してから engine を落とすため。逆順だと dispose 済みの engine に触れて例外になる)。
  chatAdapter?.dispose();
  chatAdapter = null;
  unsubscribeEmotion?.();
  unsubscribeEmotion = null;
  ipcMain.removeHandler(IPC.EmotionGet);
  ipcMain.removeHandler(IPC.ChatConfigGet);
  ipcMain.removeAllListeners(IPC.ChatConfigSet);
  engine?.dispose();
  characterWindow?.dispose();
  controlPanelWindow?.dispose();
  controlPanelWindow = null;
  tray?.destroy();
  tray = null;
});

// 対応OSはmacOSのみ(要件定義書 C-01)だが、Electronの慣例に従い明示しておく。
// 常駐アプリのため、全ウィンドウを閉じてもmacOSでは終了しない(メニューバーから操作を続けられる)。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
