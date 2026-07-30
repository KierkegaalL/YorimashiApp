import { app, clipboard, dialog, ipcMain, net, session, type Tray } from 'electron';
import { basename, extname, join } from 'node:path';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { EmotionEngine } from './emotion-engine';
import { ConfigStore } from './config-store';
import { ensureAuthToken } from './local-server/auth-token';
import { LocalServer } from './local-server/local-server';
import { CharacterWindow, resolveActiveModel } from './character-window';
import { ControlPanelWindow } from './control-panel-window';
import { ChatAdapter } from './chat-adapter/chat-adapter';
import { CodeAdapter } from './code-adapter/code-adapter';
import { CodeAdapterSettings, parseCodeSettingsPatch } from './code-adapter/code-settings';
import { GeneralSettings, parseGeneralSettingsPatch } from './general-settings';
import { ModelService, modelsRootOf, parseModelId, parseRenamePayload } from './model/model-service';
import { ModelImporter } from './model/model-importer';
import { SpritesetImporter, parseSpritesetClip, parseSpritesetImportPayload } from './model/spriteset-importer';
import { makeBackgroundKey } from './model/background-key';
import {
  MappingService,
  parseEmotionState,
  parseLive2dEntryPatch,
} from './model/mapping-service';
import { writeEndpointFile } from './local-server/endpoint-file';
import { OnboardingService } from './onboarding/onboarding-service';
import { HookEventLog } from './logging/hook-event-log';
import { LogActions } from './logging/log-actions';
import { buildAppMenu, createTray, type AppMenuDeps } from './tray-menu';
import { denyAllPermissions } from './window-security';
import type { CharacterBootstrapModel } from '../shared/bootstrap';
import { IPC } from '../shared/ipc';
import type { EmotionSnapshot } from '../shared/emotions';
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  type ChatAttachment,
  type ChatConfigPatch,
  type ChatConfigSnapshot,
  type ChatImageMimeType,
} from '../shared/chat';
import type { RightsSnapshot } from '../shared/rights';
import type { ModelManageSnapshot } from '../shared/model-manage';
import type { ModelMappingDetail } from '../shared/model-mapping';

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
let codeSettings: CodeAdapterSettings | null = null;
let generalSettings: GeneralSettings | null = null;
let modelService: ModelService | null = null;
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

/**
 * モード設定タブ(FR-7)の Code Adapter セクションのIPCを配線する。
 *
 * 監視対象パスの**追加はネイティブダイアログ経由に限る**(dispatch.sh の書き込み先を利用者の
 * 明示選択に限定する不変条件。onboarding-service.ts)。ここでは既存の入口 onboarding.chooseProject を
 * CodeAdapterSettings へ注入して再利用し、Renderer からは任意のパス配列を受け付けない。
 * 書き込み系(config更新)を含むため、送信元の検証を欠かさない。
 */
function registerCodeSettingsIpc(): void {
  if (!configStore || !engine) {
    console.warn('[code-settings] config/EmotionEngine が未初期化のため配線をスキップします');
    return;
  }

  codeSettings = new CodeAdapterSettings({
    configStore,
    engine,
    getActualPort: () => localServer?.port ?? null,
    // watchedProjectPaths への唯一の入口(ダイアログ)を再利用する。オンボーディング完了後も
    // OnboardingService は破棄されない(will-quit まで生存)ため、モード設定タブからも使える。
    addWatchedProject: () => onboarding?.chooseProject() ?? Promise.resolve(null),
  });

  ipcMain.handle(IPC.CodeSettingsGet, (event) => {
    if (!isPanelSender(event.sender) || !codeSettings) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return codeSettings.getSnapshot();
  });

  ipcMain.handle(IPC.CodeSettingsSet, (event, patch: unknown) => {
    if (!isPanelSender(event.sender) || !codeSettings) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    return codeSettings.updateSettings(parseCodeSettingsPatch(patch));
  });

  ipcMain.handle(IPC.CodeSettingsChooseProject, async (event) => {
    if (!isPanelSender(event.sender) || !codeSettings) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    return codeSettings.chooseProject();
  });

  ipcMain.handle(IPC.CodeSettingsRemoveProject, (event, projectPath: unknown) => {
    if (!isPanelSender(event.sender) || !codeSettings) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    if (typeof projectPath !== 'string' || projectPath.length === 0) {
      throw new Error('削除対象のパスが指定されていません');
    }
    return codeSettings.removeProject(projectPath);
  });
}

/**
 * 全体設定タブ(FR-7/FR-10)のIPCを配線する。
 *
 * `autostart` は **これまで config フィールドだけが存在してOSへの登録処理が無かった**ため、
 * ここで `app.setLoginItemSettings()` / `app.getLoginItemSettings()` を注入して実際に効かせる
 * (general-settings.ts 冒頭参照)。`app.isPackaged` が false の開発実行では登録しても
 * 意味が無い(実行中バイナリ=node_modules 内の Electron が登録される)ため未対応として扱い、
 * UI 側が断り書きを出す。
 *
 * クリックスルーは Tray と共有する唯一の入口(下記のモジュール関数 `setClickThrough()`)へ委譲する。
 * 変更後は Renderer へ通知して、Tray 経由の変更にも全体設定タブが追従できるようにする。
 */
function registerGeneralSettingsIpc(): void {
  if (!configStore) {
    console.warn('[general-settings] config が未初期化のため配線をスキップします');
    return;
  }

  generalSettings = new GeneralSettings({
    configStore,
    // クリックスルーの唯一の入口(Trayのチェックボックスと共有)。ウィンドウ未生成でも
    // config への保存は必ず行われる(上記 setClickThrough のコメント参照)。
    setClickThrough,
    applyDisplaySize: () => characterWindow?.applyDisplaySize(),
    getLoginItem: () => app.getLoginItemSettings().openAtLogin,
    setLoginItem: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
    isAutostartSupported: () => app.isPackaged,
  });

  // 起動時に config の意思を OS のログイン項目へ揃える(前回が開発実行だった・システム設定から
  // 直接外された等でずれうるため)。
  generalSettings.syncAutostartOnStartup();

  ipcMain.handle(IPC.GeneralSettingsGet, (event) => {
    if (!isPanelSender(event.sender) || !generalSettings) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return generalSettings.getSnapshot();
  });

  ipcMain.handle(IPC.GeneralSettingsSet, (event, patch: unknown) => {
    if (!isPanelSender(event.sender) || !generalSettings) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const next = generalSettings.updateSettings(parseGeneralSettingsPatch(patch));
    // 送信元にも同じスナップショットが戻るが、**購読側(シェルの配色テーマ)にも届ける**必要が
    // あるためブロードキャストする(同一ウィンドウ内の別コンポーネントが購読している)。
    // クリックスルーを含むパッチでは上記 setClickThrough 内でも一度送っており2回になるが、
    // **最後に届くのは必ず更新後の完全なスナップショット**なので害はない(自己修復する)。
    broadcastGeneralSettings();
    return next;
  });
}

/**
 * クリックスルーを切り替える**唯一の入口**(メニューバーのチェックボックスと全体設定タブが共有)。
 *
 * **config への保存を先に、ウィンドウへの適用を後に行う**。適用側(CharacterWindow)は
 * モデル未導入の間はインスタンスすら無く(`startCharacterWindow()` が生成前に return する)、
 * 以前のように `characterWindow?.setClickThrough()` へ保存まで委ねると、その間の操作が
 * 黙って捨てられていた(利用者には保存されたように見えるのに次回起動で戻る)。
 * 保存はウィンドウの有無に関わらず必ず行い、適用はウィンドウがあるときだけ行う。
 * ウィンドウが後から生成されるときは `create()` が config を読んで適用する。
 */
function setClickThrough(value: boolean): void {
  configStore?.update((draft) => {
    draft.general.clickThrough = value;
  });
  characterWindow?.applyClickThroughSetting(value);
  // 全体設定タブのトグルを実体に追従させる(購読しないとTray経由の変更で表示だけ古くなる)。
  broadcastGeneralSettings();
}

/** 全体設定の現在値を Control Panel へ通知する(Tray からのクリックスルー変更でも呼ぶ)。 */
function broadcastGeneralSettings(): void {
  const win = controlPanelBrowserWindow();
  if (win && !win.isDestroyed() && generalSettings) {
    win.webContents.send(IPC.GeneralSettingsChanged, generalSettings.getSnapshot());
  }
}

/**
 * 権利情報タブ(FR-12)のIPCを配線する。config 由来の値(Live2D の利用区分)だけを返す
 * (OSS 一覧はビルド時生成の shared/oss-licenses.ts を Renderer が直接 import する)。
 * 読み取り専用だが、他のIPCと同様に送信元の検証を通す。
 */
/**
 * モデル管理タブ(FR-5)のIPCを配線する。
 * 削除はファイル実体を消す不可逆操作を含むため、送信元の検証を欠かさない。
 *
 * 各操作のあとに `syncCharacterModel()` を通し、**解決結果が変わったらキャラクターウィンドウへ
 * 反映する**(反映しないと「使用中」表示と実際に出ている絵が食い違う=嘘になる)。
 */
function registerModelIpc(): void {
  if (!configStore) {
    console.warn('[model] config 未初期化のため配線をスキップします');
    return;
  }
  modelService = new ModelService({
    configStore,
    modelsRoot: modelsRootOf(app.getPath('userData')),
  });

  /** 操作 → スナップショット返却の共通処理(送信元検証と反映をまとめる)。 */
  const handle = (
    channel: string,
    run: (service: ModelService, payload: unknown) => ModelManageSnapshot,
  ): void => {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!isPanelSender(event.sender) || !modelService) {
        throw new Error('この送信元からの操作は許可されていません');
      }
      const snapshot = run(modelService, payload);
      syncCharacterModel();
      return snapshot;
    });
  };

  handle(IPC.ModelGet, (service) => service.getSnapshot());
  handle(IPC.ModelDelete, (service, payload) => service.deleteModel(parseModelId(payload)));
  handle(IPC.ModelRename, (service, payload) => {
    const { id, name } = parseRenamePayload(payload);
    return service.renameModel(id, name);
  });
  handle(IPC.ModelSetAutoSwitch, (service, payload) => {
    if (typeof payload !== 'boolean') {
      throw new Error('自動切替の指定が不正です。');
    }
    return service.setAutoSwitch(payload);
  });
  handle(IPC.ModelSetActive, (service, payload) => service.setManualActive(parseModelId(payload)));
  handle(IPC.ModelSwapAssignment, (service) => service.swapAssignment());

  // 取り込み(Live2D フォルダ)。ダイアログ→複製→スロット追加は非同期のため handle() の
  // 同期版とは別に配線する。取り込み後は syncCharacterModel() で 0→1 体化に追従する。
  const importer = new ModelImporter({
    configStore,
    modelsRoot: modelsRootOf(app.getPath('userData')),
    chooseModelFolder: () => chooseModelFolder(),
    chooseModelArchive: () => chooseModelArchive(),
  });
  ipcMain.handle(IPC.ModelImportLive2d, async (event) => {
    if (!isPanelSender(event.sender) || !modelService) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const result = await importer.importLive2dFromDialog();
    if (result.imported) {
      syncCharacterModel();
    }
    return modelService.getSnapshot(result.warning);
  });
  // zip 取り込み。フォルダ取り込みと**同じ後処理**(反映+スナップショット)にする。
  // 展開・検証は ModelImporter 側で完結し、Renderer へパスを渡さない点も同じ。
  ipcMain.handle(IPC.ModelImportLive2dArchive, async (event) => {
    if (!isPanelSender(event.sender) || !modelService) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const result = await importer.importLive2dFromArchiveDialog();
    if (result.imported) {
      syncCharacterModel();
    }
    return modelService.getSnapshot(result.warning);
  });

  // スプライトセット生成(第2段階b)。手順1-2(合成)と手順4後段(エンコード+登録)がMain側。
  // デコードと色キー抜きは Chromium にしかできないため Renderer が済ませてから呼ぶ。
  ipcMain.handle(IPC.SpritesetMakeBackgroundKey, async (event) => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    return makeBackgroundKey({ chooseImage: chooseSourceImage, chooseSavePath: chooseBackgroundKeyPath });
  });

  const spritesetImporter = new SpritesetImporter({
    configStore,
    modelsRoot: modelsRootOf(app.getPath('userData')),
  });
  ipcMain.handle(IPC.SpritesetImport, async (event, payload: unknown) => {
    if (!isPanelSender(event.sender) || !modelService) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const { name, inputs } = parseSpritesetImportPayload(payload);
    const result = await spritesetImporter.importSpriteset(name, inputs);
    if (result.imported) {
      syncCharacterModel();
    }
    return modelService.getSnapshot(result.warning);
  });

  // 感情↔モーション/クリップ対応の編集(第3段階 Track A / model-mapping-ui.md)。
  // マッピングの正本は manifest.json で、編集後にそのモデルがアクティブなら**再読込して反映する**
  // (id は変わらないので syncCharacterModel の差分判定では拾えない。reloadIfApplied を使う)。
  const mappingService = new MappingService({
    configStore,
    modelsRoot: modelsRootOf(app.getPath('userData')),
  });
  /** 編集系(引数の id を検証し、実行後にアクティブなら再読込する)の共通処理。 */
  const mapEdit = (
    channel: string,
    run: (service: MappingService, id: string, payload: unknown) => ModelMappingDetail,
  ): void => {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!isPanelSender(event.sender)) {
        throw new Error('この送信元からの操作は許可されていません');
      }
      const { id, rest } = splitMappingPayload(payload);
      const detail = run(mappingService, id, rest);
      characterWindow?.reloadIfApplied(id);
      return detail;
    });
  };

  // 読み取り(get)は再読込不要。引数はモデルid そのもの。
  ipcMain.handle(IPC.ModelMappingGet, (event, payload: unknown) => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return mappingService.getDetail(parseModelId(payload));
  });
  mapEdit(IPC.ModelMappingSetLive2d, (service, id, rest) => {
    const { state, patch } = rest as { state?: unknown; patch?: unknown };
    return service.setLive2dEntry(id, parseEmotionState(state), parseLive2dEntryPatch(patch));
  });
  mapEdit(IPC.ModelMappingAutoRestore, (service, id, rest) => {
    const { state } = rest as { state?: unknown };
    return service.autoRestoreState(id, parseEmotionState(state));
  });
  // AutoRestoreAll の引数はモデルid そのもの(state を持たない)。
  ipcMain.handle(IPC.ModelMappingAutoRestoreAll, (event, payload: unknown) => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const id = parseModelId(payload);
    const detail = mappingService.autoRestoreAll(id);
    characterWindow?.reloadIfApplied(id);
    return detail;
  });
  mapEdit(IPC.ModelMappingDeleteClip, (service, id, rest) => {
    const { state } = rest as { state?: unknown };
    return service.deleteSpritesetClip(id, parseEmotionState(state));
  });

  // クリップ差し替え(Track B)は WebP エンコード(sharp)を挟むため**非同期**。同期版の mapEdit では
  // 扱えないので SpritesetImport と同じく個別に配線する(検証→実行→アクティブなら再読込は同じ)。
  // Live2D 側の対応物は setLive2dEntry(モーション/表情の割り当て)で、そちらは同期のため mapEdit に乗る。
  // この同期/非同期の差はエンコード工程の有無に由来する正当な非対称(Live2Dはフォルダ内の既存ファイルを
  // 指すだけで、差し替え時にエンコードしない)。
  ipcMain.handle(IPC.ModelMappingSetClip, async (event, payload: unknown) => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    const { id, rest } = splitMappingPayload(payload);
    const { state, clip } = rest as { state?: unknown; clip?: unknown };
    const emotionState = parseEmotionState(state);
    const input = parseSpritesetClip(clip, emotionState);
    const detail = await mappingService.setSpritesetClip(id, emotionState, input);
    characterWindow?.reloadIfApplied(id);
    return detail;
  });

  // プレビュー描画(Track C / 論点1)用の配信情報を id で返す。トークンは /panel が HTML に埋め込む
  // (window.__APP_TOKEN__)ので Main→Renderer では渡さず、ここは installedDir/mappingFile だけ返す。
  // installedDir の露出はキャラクターウィンドウの bootstrap と同じ(描画に要る最小情報。model-manage の
  // 「スナップショットにパスを載せない」= Renderer 由来のパスを信じる経路を作らない、とは別の話)。
  // slot 検索・存在検証・パス検証は MappingService.getPreviewContext に一本化する(他のマッピング系と同じ経路)。
  ipcMain.handle(IPC.ModelPreviewContext, (event, payload: unknown) => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return mappingService.getPreviewContext(parseModelId(payload));
  });
}

/** {id, ...} 形のマッピング編集ペイロードから id を取り出し検証する(残りは各ハンドラが解釈)。 */
function splitMappingPayload(payload: unknown): { id: string; rest: unknown } {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('操作の指定が不正です。');
  }
  const { id } = payload as { id?: unknown };
  return { id: parseModelId(id), rest: payload };
}

/** スプライトセットの元になる静止画をネイティブダイアログで選ばせる(キャンセルは null)。 */
async function chooseSourceImage(): Promise<string | null> {
  const parent = controlPanelBrowserWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'スプライトセットの元になる画像を選ぶ',
    message: '透過PNGを推奨します(背景は自動でクロマグリーンに合成されます)。',
    filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** background_key.png の保存先をネイティブダイアログで選ばせる(キャンセルは null)。 */
async function chooseBackgroundKeyPath(defaultName: string): Promise<string | null> {
  const parent = controlPanelBrowserWindow();
  const options: Electron.SaveDialogOptions = {
    title: '外部AIへ渡す画像を保存する',
    defaultPath: join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PNG', extensions: ['png'] }],
  };
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled ? null : (result.filePath ?? null);
}

/**
 * Live2D モデルフォルダをネイティブダイアログで選ばせる(キャンセルは null)。
 * dialog は onboarding の chooseProject と同じく Control Panel を親にして表示する。
 */
async function chooseModelFolder(): Promise<string | null> {
  const parent = controlPanelBrowserWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Live2D モデルのフォルダを選ぶ',
    message: 'model3.json(Cubism 4/5)または model.json(Cubism 2)を含むフォルダを選んでください。',
    properties: ['openDirectory'],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * Live2D モデルの zip を選ばせる(要件定義書「フォルダ/zipドロップで取り込み(zip-slip対策あり)」)。
 * ここで得るのはパスだけで、展開と検証は ModelImporter / zip-archive.ts が行う
 * (zip-slip・シンボリックリンクの拒否。security.md 6章)。
 */
async function chooseModelArchive(): Promise<string | null> {
  const parent = controlPanelBrowserWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Live2D モデルの zip を選ぶ',
    message: 'model3.json(Cubism 4/5)または model.json(Cubism 2)を含む zip を選んでください。',
    properties: ['openFile'],
    filters: [{ name: 'zip アーカイブ', extensions: ['zip'] }],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/**
 * 会話ペインの添付(C-23。real時のみUIから呼ばれる)。ネイティブダイアログで画像を選ばせ、
 * **その場でMainが読み込んで`ChatAttachment`(dataUrl込み)を返す**。Rendererへファイルパスは
 * 一切渡さない(security.md 6章「添付はダイアログで選んだファイルに限定」と同じ不変条件。
 * model-importer.tsのフォルダ/zip取り込みと同じ姿勢)。
 *
 * 添付はMainの`parseAttachments`(chat-adapter.ts)でも再検証される(Rendererを信用しない)ため、
 * ここでの検証はUXのための早期チェックという位置づけ。
 */
async function chooseChatAttachment(): Promise<ChatAttachment | null> {
  const parent = controlPanelBrowserWindow();
  const options: Electron.OpenDialogOptions = {
    title: '添付する画像を選ぶ',
    message: 'png / jpg / jpeg / gif / webp のいずれかを選んでください。',
    properties: ['openFile'],
    filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  const filePath = result.canceled ? undefined : result.filePaths[0];
  if (filePath === undefined) {
    return null;
  }
  const mimeType = chatAttachmentMimeType(filePath);
  if (mimeType === null) {
    throw new Error('対応していない画像形式です(png/jpg/jpeg/gif/webpのみ)。');
  }
  const size = statSync(filePath).size;
  if (size > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error(
      `添付できる画像は最大${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024 / 1024)}MBまでです。`,
    );
  }
  const buffer = readFileSync(filePath);
  return {
    id: randomUUID(),
    name: basename(filePath),
    mimeType,
    sizeBytes: size,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  };
}

/** 拡張子からMIMEタイプを決める。対応外は null(推測で決め打ちしない)。 */
function chatAttachmentMimeType(filePath: string): ChatImageMimeType | null {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return null;
  }
}

/**
 * アクティブモデルの解決結果をキャラクターウィンドウへ反映する。
 *
 * モデル管理タブの操作だけでなく、**アダプタ切替(Tray / 会話ペイン / C-24の自動切替)**からも呼ぶ。
 * `autoSwitchByMode` がONのときはアダプタが変わるだけで描画すべきモデルが変わるため
 * (character-window.ts resolveActiveModel の3)。
 * モデルが無くなればウィンドウを閉じ、逆に**閉じたあとモデルが戻れば開き直す**
 * (取り込み経路が入ったときにそのまま効くよう、復帰側もここで面倒を見る)。
 */
function syncCharacterModel(): void {
  if (!characterWindow) {
    startCharacterWindow();
    return;
  }
  // 戻り値は「アクティブモデルが在るか」。在るのに実ウィンドウが無い(= 以前 close した)なら開き直す。
  const hasActiveModel = characterWindow.applyActiveModel();
  if (hasActiveModel && characterWindow.browserWindow === null) {
    startCharacterWindow();
  }
}

function registerRightsIpc(): void {
  ipcMain.handle(IPC.RightsGet, (event): RightsSnapshot => {
    if (!isPanelSender(event.sender) || !configStore) {
      throw new Error('この送信元からの取得は許可されていません');
    }
    return { live2dCommercialLicense: configStore.current.distribution.live2dCommercialLicense };
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
    // real の通信断エラーの**文言を出し分けるためだけ**に渡す(接続可否の事前判定には使わない。
    // chat-adapter-errors.md 論点2)。ChatAdapter/real-responder を Electron非依存に保つため、
    // Electron API はここで関数として注入する。
    isOnline: () => net.isOnline(),
    // @参照(C-23)の「作業ログ」用。hookEventLogはモジュール変数のため呼び出し時点で解決する
    // (initCore()で先に生成されるが、型はnullableなので念のため関数越しに読む)。
    getLogSnapshot: (limit) => hookEventLog?.getSnapshot(limit) ?? null,
  });

  // 添付(C-23)。ChatAdapterの内部状態を使わないため、クラス外のIPCとして配線する
  // (model importの chooseModelArchive 等と同じ扱い)。
  ipcMain.handle(IPC.ChatChooseAttachment, async (event): Promise<ChatAttachment | null> => {
    if (!isPanelSender(event.sender)) {
      throw new Error('この送信元からの操作は許可されていません');
    }
    return chooseChatAttachment();
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
  // **アダプタが変わると描画すべきモデルも変わりうる**(autoSwitchByMode がONのとき。
  // character-window.ts resolveActiveModel の3)。ここは Tray・会話ペイン・C-24の自動切替の
  // すべてが通る唯一の合流点なので、モデル反映もここに集約する。解決結果が変わっていなければ
  // applyActiveModel() が何もしないため、モード変更のたびに再読込が走ることはない。
  syncCharacterModel();
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
    setClickThrough,
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
  // **実ウィンドウの有無で判定する**(インスタンスの有無ではない)。モデルを全部消すと
  // applyActiveModel() が close() でウィンドウだけ破棄し、characterWindow(インスタンス)は
  // 残る。インスタンスで判定すると、その後モデルが戻っても二度と開けなくなる。
  if (characterWindow?.browserWindow) {
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
  // 破棄後の再オープンではインスタンスを使い回す(close() は listeners/IPC を teardown 済みで、
  // create() が張り直すため二重登録にならない。character-window.ts teardownListeners 参照)。
  characterWindow ??= new CharacterWindow({
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
  // Web 権限要求(カメラ/マイク/位置情報/通知等)を一律拒否する(FR-13 / security.md 対策8)。
  // 両ウィンドウが読み込まれる前に、共有する既定セッションへ設定しておく。
  denyAllPermissions(session.defaultSession);

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
  registerCodeSettingsIpc();
  registerGeneralSettingsIpc();
  registerRightsIpc();
  registerModelIpc();
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
  // Chat Adapter は engine より先に片付ける。dispose() は進行中のstreamをabortするが、
  // `disposed`フラグを先に立てるため release('thinking') 自体は呼ばない(この直後に engine
  // ごと破棄するので、Reactionを個別に戻す意味が無いため。reviewer #12 1周目 指摘6で
  // 誤解を招く記述だったコメントを修正)。engineより先に片付けるのは、逆順だと
  // dispose 済みの engine に触れて例外になるため。
  chatAdapter?.dispose();
  chatAdapter = null;
  unsubscribeEmotion?.();
  unsubscribeEmotion = null;
  ipcMain.removeHandler(IPC.EmotionGet);
  ipcMain.removeHandler(IPC.ChatConfigGet);
  ipcMain.removeAllListeners(IPC.ChatConfigSet);
  ipcMain.removeHandler(IPC.ChatChooseAttachment);
  ipcMain.removeHandler(IPC.OnboardingGet);
  ipcMain.removeHandler(IPC.OnboardingChooseProject);
  ipcMain.removeHandler(IPC.OnboardingInstallDispatch);
  ipcMain.removeHandler(IPC.OnboardingCopySnippet);
  ipcMain.removeHandler(IPC.OnboardingComplete);
  onboarding = null;
  ipcMain.removeHandler(IPC.LogsGet);
  ipcMain.removeHandler(IPC.LogsExport);
  ipcMain.removeHandler(IPC.LogsClear);
  ipcMain.removeHandler(IPC.CodeSettingsGet);
  ipcMain.removeHandler(IPC.CodeSettingsSet);
  ipcMain.removeHandler(IPC.CodeSettingsChooseProject);
  ipcMain.removeHandler(IPC.CodeSettingsRemoveProject);
  codeSettings = null;
  ipcMain.removeHandler(IPC.GeneralSettingsGet);
  ipcMain.removeHandler(IPC.GeneralSettingsSet);
  generalSettings = null;
  ipcMain.removeHandler(IPC.RightsGet);
  ipcMain.removeHandler(IPC.ModelGet);
  ipcMain.removeHandler(IPC.ModelDelete);
  ipcMain.removeHandler(IPC.ModelRename);
  ipcMain.removeHandler(IPC.ModelSetAutoSwitch);
  ipcMain.removeHandler(IPC.ModelSetActive);
  ipcMain.removeHandler(IPC.ModelSwapAssignment);
  ipcMain.removeHandler(IPC.ModelImportLive2d);
  ipcMain.removeHandler(IPC.ModelImportLive2dArchive);
  ipcMain.removeHandler(IPC.SpritesetMakeBackgroundKey);
  ipcMain.removeHandler(IPC.SpritesetImport);
  ipcMain.removeHandler(IPC.ModelMappingGet);
  ipcMain.removeHandler(IPC.ModelMappingSetLive2d);
  ipcMain.removeHandler(IPC.ModelMappingAutoRestore);
  ipcMain.removeHandler(IPC.ModelMappingAutoRestoreAll);
  ipcMain.removeHandler(IPC.ModelMappingDeleteClip);
  ipcMain.removeHandler(IPC.ModelMappingSetClip);
  ipcMain.removeHandler(IPC.ModelPreviewContext);
  modelService = null;
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
