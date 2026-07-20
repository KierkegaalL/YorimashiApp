import { app, clipboard, ipcMain, type Tray } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { EmotionEngine } from './emotion-engine';
import { ConfigStore } from './config-store';
import { ensureAuthToken } from './local-server/auth-token';
import { LocalServer } from './local-server/local-server';
import { CharacterWindow, resolveActiveModel } from './character-window';
import { ControlPanelWindow } from './control-panel-window';
import { ChatAdapter } from './chat-adapter/chat-adapter';
import { CodeAdapter } from './code-adapter/code-adapter';
import { writeEndpointFile } from './local-server/endpoint-file';
import { OnboardingService } from './onboarding/onboarding-service';
import { HookEventLog } from './logging/hook-event-log';
import { LogActions } from './logging/log-actions';
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
 * - Code Adapter(FR-2/#9): `POST /hook` で受けたhooksイベントをEmotionEngineへ橋渡しする
 *   (api.md 1.1)。dispatch.sh の配置自体はオンボーディング(#10)が行う。
 * - オンボーディング(FR-14/#10): 初回起動時に Control Panel 上へ4ステップのフローを出す。
 *   Main側は「ネイティブのディレクトリ選択」「dispatch.sh の配置」「hooks設定状況の実測」
 *   だけを担う(onboarding/onboarding-service.ts)。`.claude/settings.json` は**書き換えない**。
 * - ログ管理(FR-11/#11): 受信したhooksイベントを userData/logs/hook-events.jsonl(0600)へ
 *   追記し、retentionDays(既定7日)を過ぎた行を自動削除する。ログタブから仮名化エクスポート・
 *   消去ができる(logging/hook-event-log.ts・logging/log-actions.ts)。
 *
 * 未実装:
 * - CharacterRenderer(FR-5/#5): キャラクターウィンドウ内の実描画(Live2D/スプライトセット)。
 *   現在はプレースホルダーHTMLを表示する。
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
let codeAdapter: CodeAdapter | null = null;
let onboarding: OnboardingService | null = null;
let hookEventLog: HookEventLog | null = null;
let logActions: LogActions | null = null;
let tray: Tray | null = null;
let unsubscribeEmotion: (() => void) | null = null;
/**
 * ログ新着通知(IPC.LogsChanged)のスロットル用タイマー。
 * hooks は連続で飛ぶ(1ツール呼び出しごとに Pre/Post の2件)ため、届くたびに通知すると
 * ログタブが読み直しを繰り返す。**中身は載せず「更新があった」だけを間引いて送る**。
 */
let logsChangedTimer: NodeJS.Timeout | null = null;
const LOGS_CHANGED_THROTTLE_MS = 500;

/**
 * config と EmotionEngine の初期化はローカルサーバー起動から独立させる。サーバーが起動に
 * 失敗しても Control Panel は開けなければならない(可用性NFR)が、その生成には configStore
 * (折りたたみ状態=初期ウィンドウ幅)が、会話ペイン(FR-15)には engine が要るため。
 * サーバーが落ちていても Chat Adapter(mock)と憑坐状態帯は動く。
 */
function initCore(): void {
  configStore = ConfigStore.load(app.getPath('userData'));
  engine = new EmotionEngine(configStore.current.emotionEngine);
  // Code Adapter(FR-2)はローカルサーバーより先に用意する。サーバー起動時に
  // onHookEvent へ渡す必要があり、かつサーバーが落ちていても生成自体は害がないため。
  codeAdapter = new CodeAdapter({ engine, configStore });
  // hooksイベントログ(FR-11)。Code Adapter と同じくサーバーより先に用意する
  // (onHookEvent から呼ぶため)。start() で保持期間(既定7日)の整理を始める。
  hookEventLog = new HookEventLog({
    configStore,
    userDataDir: app.getPath('userData'),
    onAppended: scheduleLogsChanged,
  });
  hookEventLog.start();
  logActions = new LogActions({ log: hookEventLog, getParentWindow: controlPanelBrowserWindow });
  // オンボーディング(FR-14)。config だけに依存するのでここで用意する。
  onboarding = new OnboardingService({
    configStore,
    userDataDir: app.getPath('userData'),
    getParentWindow: controlPanelBrowserWindow,
  });
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
    // Code Adapter(FR-2): hooksイベント→EmotionEngine。handle()は例外を投げず結果を返す
    // ため、ここで握り潰す処理は要らない(可用性NFR: dispatch.shは常にexit 0)。
    onHookEvent: (payload) => {
      const result = codeAdapter?.handle(payload);
      // ログ(FR-11)は**処理結果を見てから**記録する。何を残し何を残さないかの判断と
      // その理由は logging/hook-event-log.ts の冒頭に書いてある(除外プロジェクトの
      // フルパスを残さない等)。record() も例外を投げない。
      if (result) {
        hookEventLog?.record(payload, result);
      }
    },
  });

  const port = await localServer.start();
  // dispatch.sh が接続先を知るための `.port`(競合フォールバック後の実ポート)。
  // JSONを解析できない薄いシェルスクリプトのために平文で置く(endpoint-file.ts)。
  writeEndpointFile(userDataDir, port);
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
 * IPC の送信元が Control Panel ウィンドウか。**全ての invoke/on で必ず通す**
 * (キャラクターウィンドウとは preload を共有しているため、Main側で送信元を検証する。
 * preload/index.ts の注記と対になる)。
 */
function isPanelSender(sender: Electron.WebContents): boolean {
  const win = controlPanelBrowserWindow();
  return win !== null && !win.isDestroyed() && win.webContents === sender;
}

/**
 * オンボーディング(FR-14)のIPCを配線する。
 * 書き込み系(dispatch.sh の配置)を含むため、送信元の検証を欠かさない。
 */
function registerOnboardingIpc(): void {
  ipcMain.handle(IPC.OnboardingGet, (event) => {
    if (!isPanelSender(event.sender) || !onboarding) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return onboarding.getSnapshot();
  });

  ipcMain.handle(IPC.OnboardingChooseProject, async (event) => {
    if (!isPanelSender(event.sender) || !onboarding) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    return onboarding.chooseProject();
  });

  ipcMain.handle(IPC.OnboardingInstallDispatch, (event, payload: unknown) => {
    if (!isPanelSender(event.sender) || !onboarding) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('配置先が指定されていません');
    }
    const { projectPath, overwrite } = payload as { projectPath?: unknown; overwrite?: unknown };
    if (typeof projectPath !== 'string' || projectPath.length === 0) {
      throw new Error('配置先が指定されていません');
    }
    // 任意パスを受け付けないための検証は OnboardingService 側にもある
    // (watchedProjectPaths = ネイティブダイアログで選ばれたパス、に限定する)。
    return onboarding.installDispatchScript(projectPath, overwrite === true);
  });

  ipcMain.handle(IPC.OnboardingCopySnippet, (event) => {
    if (!isPanelSender(event.sender) || !onboarding) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    // 本文はRendererから受け取らず、画面に出しているのと同じ値をMainで作り直す。
    clipboard.writeText(onboarding.getSettingsSnippet());
    return true;
  });

  ipcMain.handle(IPC.OnboardingComplete, (event) => {
    if (!isPanelSender(event.sender) || !onboarding) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    onboarding.complete();
    // モデルが導入済みならここで灯里が「降りてくる」(0体なら開かない。onboarding.md 論点4)。
    startCharacterWindow();
  });
}

/**
 * ログ管理(FR-11)のIPCを配線する。
 * 消去は取り消せず、エクスポートは任意の場所へ書き出すため、送信元の検証を欠かさない。
 */
function registerLogsIpc(): void {
  ipcMain.handle(IPC.LogsGet, (event) => {
    if (!isPanelSender(event.sender) || !hookEventLog) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return hookEventLog.getSnapshot();
  });

  ipcMain.handle(IPC.LogsExport, async (event) => {
    if (!isPanelSender(event.sender) || !logActions) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    // 書き出し先の選択はネイティブの保存ダイアログ。Rendererからパスを受け取らない。
    return logActions.export();
  });

  ipcMain.handle(IPC.LogsClear, async (event) => {
    if (!isPanelSender(event.sender) || !logActions) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const result = await logActions.clear();
    if (result.status === 'cleared') {
      scheduleLogsChanged();
    }
    return result;
  });
}

/** ログの更新をControl Panelへ間引いて通知する(中身は載せない)。 */
function scheduleLogsChanged(): void {
  if (logsChangedTimer !== null) {
    return;
  }
  logsChangedTimer = setTimeout(() => {
    logsChangedTimer = null;
    const win = controlPanelBrowserWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.LogsChanged);
    }
  }, LOGS_CHANGED_THROTTLE_MS);
  logsChangedTimer.unref?.();
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

/**
 * キャラクターウィンドウを生成する。prod はサーバー必須(WebCodecs)のため port が要る。
 *
 * **モデルが解決できないときは開かない**(onboarding.md 論点4)。透過・枠なし・クリックスルーの
 * ウィンドウを中身なしで前面に出すと、操作もできない小さな文字が画面に居座るだけになる。
 * オンボーディング完了時にも呼ばれるため、生成済みなら何もしない。
 *
 * > 補足: onboarding.md はこの判断の理由を「開いても画面上に何も見えない」と書いているが、
 * > #5 の CharacterRenderer 実装で「モデル未導入」の正直な表示が入ったため、現在は
 * > **見えないのではなく、操作できない表示が出続ける**。理由は変わったが結論は同じなので
 * > 正本の決定に従う(モデル追加後に開く導線はオンボーディングとモデル管理タブが持つ)。
 */
function startCharacterWindow(): void {
  if (characterWindow) {
    return;
  }
  const canLoad = Boolean(rendererUrl) || localServer?.port != null;
  if (!configStore || !canLoad) {
    console.warn(
      '[character] ローカルサーバー未起動のためキャラクターウィンドウを開けません(サーバー復旧後に再起動が必要)',
    );
    return;
  }
  if (!resolveActiveModel(configStore.current)) {
    console.log('[character] モデルが未導入のためキャラクターウィンドウは開きません');
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
  registerOnboardingIpc();
  registerLogsIpc();
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
  ipcMain.removeHandler(IPC.OnboardingGet);
  ipcMain.removeHandler(IPC.OnboardingChooseProject);
  ipcMain.removeHandler(IPC.OnboardingInstallDispatch);
  ipcMain.removeHandler(IPC.OnboardingCopySnippet);
  ipcMain.removeHandler(IPC.OnboardingComplete);
  onboarding = null;
  ipcMain.removeHandler(IPC.LogsGet);
  ipcMain.removeHandler(IPC.LogsExport);
  ipcMain.removeHandler(IPC.LogsClear);
  if (logsChangedTimer !== null) {
    clearTimeout(logsChangedTimer);
    logsChangedTimer = null;
  }
  hookEventLog?.dispose();
  hookEventLog = null;
  logActions = null;
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
