import { app, BrowserWindow, shell, type Tray } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { EmotionEngine } from './emotion-engine';
import { ConfigStore } from './config-store';
import { ensureAuthToken } from './local-server/auth-token';
import { LocalServer } from './local-server/local-server';
import { CharacterWindow, resolveActiveModel } from './character-window';
import { buildAppMenu, createTray, type AppMenuDeps } from './tray-menu';
import type { CharacterBootstrapModel } from '../shared/bootstrap';

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
 * - Rendererの読み込み元をローカルサーバーへ移行(C3): キャラクターウィンドウは
 *   http://127.0.0.1:<port>/character、Control Panel は /panel から読む(prod)。file:// は
 *   secure contextでなくWebCodecsが無効になるため使わない(security.md 7章)。dev は
 *   electron-vite の Vite サーバー(ELECTRON_RENDERER_URL、これもsecure context)。
 *
 * 未実装:
 * - CharacterRenderer(FR-5/#5): キャラクターウィンドウ内の実描画(Live2D/スプライトセット)。
 *   現在はプレースホルダーHTMLを表示する。
 * - Code Adapter(FR-2/#9): onHookEvent → EmotionEngine の接続。
 */

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

let engine: EmotionEngine | null = null;
let localServer: LocalServer | null = null;
let configStore: ConfigStore | null = null;
let characterWindow: CharacterWindow | null = null;
let controlPanelWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

async function startLocalServer(): Promise<void> {
  const userDataDir = app.getPath('userData');

  configStore = ConfigStore.load(userDataDir);
  const config = configStore.current;

  const authToken = ensureAuthToken(userDataDir);
  engine = new EmotionEngine(config.emotionEngine);

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

function createControlPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    title: 'ヨリマシ.app コントロールパネル',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());
  win.on('closed', () => {
    controlPanelWindow = null;
  });

  // レンダラー内のリンクは外部ブラウザで開き、Electronウィンドウを乗っ取らせない
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  loadControlPanel(win);
  return win;
}

/**
 * Control Panel の読み込み(C3)。dev は Vite、prod はローカルサーバー /panel。
 * ただし Control Panel は WebCodecs 不要かつ、サーバー障害でも表示自体はブロックしない
 * (可用性NFR)ため、サーバー未起動時は loadFile へフォールバックする。
 */
function loadControlPanel(win: BrowserWindow): void {
  if (rendererUrl) {
    void win.loadURL(`${rendererUrl}/control-panel/index.html`);
    return;
  }
  const port = localServer?.port;
  if (port != null) {
    void win.loadURL(`http://127.0.0.1:${port}/panel`);
    return;
  }
  void win.loadFile(join(__dirname, '../renderer/control-panel/index.html'));
}

/** Control Panel を開く(既に開いていればフォーカス)。Tray メニュー・activate から呼ぶ。 */
function openControlPanel(): void {
  if (controlPanelWindow && !controlPanelWindow.isDestroyed()) {
    if (controlPanelWindow.isMinimized()) {
      controlPanelWindow.restore();
    }
    controlPanelWindow.focus();
    return;
  }
  controlPanelWindow = createControlPanelWindow();
}

/** メニューバー・右クリック共通メニューの依存。呼び出し時点の config を読む/書く。 */
function buildMenuDeps(): AppMenuDeps {
  return {
    getActiveAdapter: () => configStore?.current.activeAdapter ?? 'code',
    setActiveAdapter: (adapter) => {
      // FR-1のアダプタ切替面。ここでは永続化のみ。実際のAdapter稼働の切替は #8/#9 で接続する。
      configStore?.update((draft) => {
        draft.activeAdapter = adapter;
      });
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
  try {
    await startLocalServer();
  } catch (err) {
    // ローカルサーバーの起動失敗はコントロールパネルの表示自体はブロックしない(可用性NFR)。
    // hooks受信・状態配信は無効になるため、ログには残す。
    console.error('[local-server] failed to start:', err);
  }

  openControlPanel();
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
  engine?.dispose();
  characterWindow?.dispose();
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
