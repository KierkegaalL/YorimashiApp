import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC,
  CONTROL_PANEL_COLLAPSED_ARG,
  ONBOARDING_PENDING_ARG,
  type WindowPoint,
} from '../shared/ipc';
import type {
  ChatConfigPatch,
  ChatConfigSnapshot,
  ChatSendAccepted,
  ChatSettingsPatch,
  ChatSettingsSnapshot,
  ChatStreamEvent,
} from '../shared/chat';
import type { CodeSettingsPatch, CodeSettingsSnapshot } from '../shared/code-settings';
import type { RightsSnapshot } from '../shared/rights';
import type { ModelManageSnapshot } from '../shared/model-manage';
import type { BackgroundKeyResult, SpritesetImportPayload } from '../shared/spriteset/import-payload';
import type { EmotionSnapshot } from '../shared/emotions';
import type { DispatchInstallResult, OnboardingSnapshot } from '../shared/onboarding';
import type {
  HookLogClearResult,
  HookLogExportResult,
  HookLogSnapshot,
} from '../shared/hook-log';

/**
 * contextIsolation: true / sandbox: true 前提のpreload(security.md 5章)。
 * レンダラーへはこのAPIオブジェクト経由でのみ機能を公開し、Node APIは直接渡さない。
 *
 * この preload はキャラクターウィンドウ・Control Panel の両方で使われる。character.* は
 * キャラクターウィンドウ専用、controlPanel.* は Control Panel 専用だが、**いずれもMain側で
 * 送信元(webContents)を検証して他ウィンドウからの呼び出しを弾く**ため、両方に公開しても安全
 * (character-window.ts windowForSender / control-panel-window.ts isSender)。
 */

/**
 * 起動引数から初期折りたたみ状態を読む(Mainが additionalArguments で渡す)。
 * preload は初回描画より前に走るため、Renderer は最初のフレームから正しい幅で描ける。
 * キャラクターウィンドウでは引数が無く false になるが、controlPanel.* を使わないため影響しない。
 */
const initialCollapsed =
  process.argv.find((arg) => arg.startsWith(CONTROL_PANEL_COLLAPSED_ARG))?.slice(
    CONTROL_PANEL_COLLAPSED_ARG.length,
  ) === 'true';

/**
 * オンボーディング(FR-14)が未完了か。折りたたみと同じ理由で起動引数から同期的に読む
 * (最初のフレームからオンボーディングを描き、Control Panel の中身を一瞬見せない)。
 * 引数が無い経路(キャラクターウィンドウ・ブラウザでの表示確認)では false = 出さない。
 */
const onboardingPending =
  process.argv.find((arg) => arg.startsWith(ONBOARDING_PENDING_ARG))?.slice(
    ONBOARDING_PENDING_ARG.length,
  ) === 'true';

const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** キャラクターウィンドウのドラッグ移動・右クリックメニュー(character-window.md 論点3)。 */
  character: {
    /** ドラッグ開始。現在のウィンドウ左上座標を得る(以降の move はこれを基準に算出する)。 */
    beginDrag: (): Promise<WindowPoint | null> => ipcRenderer.invoke(IPC.CharacterBeginDrag),
    /** ドラッグ中の目標スクリーン座標を送る。 */
    dragMove: (point: WindowPoint): void => ipcRenderer.send(IPC.CharacterDragMove, point),
    /** ドラッグ終了(Mainが windowPosition をデバウンス保存する)。 */
    endDrag: (): void => ipcRenderer.send(IPC.CharacterEndDrag),
    /** クリックスルーOFF時の右クリックで共通メニューを表示するよう要求する。 */
    requestContextMenu: (): void => ipcRenderer.send(IPC.CharacterContextMenu),
  },
  /**
   * Control Panel の折りたたみ(FR-15/C-21)。折りたたみは BrowserWindow の幅そのものを
   * 976⇄576px に変えるため、Renderer だけでは完結せず Main へ委譲する(chat-pane.md 論点1)。
   */
  controlPanel: {
    /**
     * 保存済みの折りたたみ状態(config.general.controlPanelCollapsed)。**同期的に読める**。
     * Mainは既にこの値どおりの幅でウィンドウを生成しているため、Rendererもこれで初期化する。
     */
    initialCollapsed,
    /** 折りたたみを切り替える(Mainがウィンドウ幅を変更し config へ保存する)。 */
    setCollapsed: (collapsed: boolean): void =>
      ipcRenderer.send(IPC.ControlPanelSetCollapsed, collapsed),
  },
  /**
   * Chat Adapter(FR-3)。**APIキー・SDKクライアントはMainにしか無い**(security.md 5章)ので、
   * Rendererは本文の送信と実況の購読だけを行う。
   */
  chat: {
    /** 送信。受理されると requestId を返し、本文は onStream で流れてくる。 */
    send: (text: string, isRetry = false): Promise<ChatSendAccepted> =>
      ipcRenderer.invoke(IPC.ChatSend, text, isRetry),
    /** 応答の中断(停止ボタン)。 */
    stop: (): void => ipcRenderer.send(IPC.ChatStop),
    /** `/clear`。**Main側の会話履歴も消す**(表示だけ消すとAPIへは古い文脈が送られ続ける)。 */
    reset: (): void => ipcRenderer.send(IPC.ChatReset),
    /** streaming実況の購読。戻り値の関数で解除する。 */
    onStream: (listener: (event: ChatStreamEvent) => void): (() => void) => {
      const handler = (_e: unknown, payload: ChatStreamEvent): void => listener(payload);
      ipcRenderer.on(IPC.ChatStream, handler);
      return () => ipcRenderer.removeListener(IPC.ChatStream, handler);
    },
    /**
     * モード類(activeAdapter / chatAdapter.mode / model)の取得・変更・購読。
     * **正本は config(Main)**。Renderer側で完結させると「UI上はmockなのに実際はrealへ送る」
     * という食い違いが起きるため、変更も必ずMainを経由する。
     */
    getConfig: (): Promise<ChatConfigSnapshot> => ipcRenderer.invoke(IPC.ChatConfigGet),
    setConfig: (patch: ChatConfigPatch): void => ipcRenderer.send(IPC.ChatConfigSet, patch),
    onConfigChanged: (listener: (snapshot: ChatConfigSnapshot) => void): (() => void) => {
      const handler = (_e: unknown, payload: ChatConfigSnapshot): void => listener(payload);
      ipcRenderer.on(IPC.ChatConfigChanged, handler);
      return () => ipcRenderer.removeListener(IPC.ChatConfigChanged, handler);
    },
    /**
     * モード設定タブ(FR-7)用。APIキーまで扱うが、**キー本体はMainからこちらへ流れない**
     * (取得できるのは hasApiKey と末尾4文字だけ。security.md 5章)。
     */
    getSettings: (): Promise<ChatSettingsSnapshot> => ipcRenderer.invoke(IPC.ChatSettingsGet),
    setSettings: (patch: ChatSettingsPatch): Promise<ChatSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.ChatSettingsSet, patch),
  },
  /**
   * Code Adapter(FR-2)の設定。モード設定タブの Code Adapter セクション用。
   * **watchedProjectPaths への追加はネイティブダイアログ経由(chooseProject)に限る**
   * (dispatch.sh の書き込み先を利用者の明示選択に限定する不変条件。shared/code-settings.ts)。
   * setSettings はポートとしきい値だけを扱い、削除は特定パス指定で受け付ける。
   */
  codeAdapter: {
    /** 監視対象パス・ポート(設定値/実値)・失敗しきい値のスナップショット。 */
    getSettings: (): Promise<CodeSettingsSnapshot> => ipcRenderer.invoke(IPC.CodeSettingsGet),
    /** ポート/失敗しきい値の更新(更新後のスナップショットを返す)。 */
    setSettings: (patch: CodeSettingsPatch): Promise<CodeSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.CodeSettingsSet, patch),
    /** 監視対象プロジェクトをネイティブダイアログで1件追加する。 */
    chooseProject: (): Promise<CodeSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.CodeSettingsChooseProject),
    /** 監視対象プロジェクトを1件外す。 */
    removeProject: (projectPath: string): Promise<CodeSettingsSnapshot> =>
      ipcRenderer.invoke(IPC.CodeSettingsRemoveProject, projectPath),
  },
  /**
   * 権利情報タブ(FR-12)。config 由来の値(Live2D の利用区分)だけを取る。
   * OSS 一覧はビルド時生成の shared/oss-licenses.ts を Renderer が直接 import する。
   */
  rights: {
    get: (): Promise<RightsSnapshot> => ipcRenderer.invoke(IPC.RightsGet),
  },
  /**
   * モデル管理(FR-5)のスロット操作 + 取り込み。**Live2Dのフォルダ取り込み(importLive2d)と
   * スプライトセット生成(makeBackgroundKey / importSpriteset)は実装済み**(第2段階a/b)。
   * zip取り込み・感情↔モーション編集は後続タスク。いずれも更新後のスナップショットを返す
   * (makeBackgroundKey だけは保存結果を返す)。
   */
  models: {
    get: (): Promise<ModelManageSnapshot> => ipcRenderer.invoke(IPC.ModelGet),
    /** スロットを1件削除する(モデルファイルの実体も消える)。 */
    delete: (id: string): Promise<ModelManageSnapshot> => ipcRenderer.invoke(IPC.ModelDelete, id),
    /** モードによる自動切替の ON/OFF。 */
    setAutoSwitch: (enabled: boolean): Promise<ModelManageSnapshot> =>
      ipcRenderer.invoke(IPC.ModelSetAutoSwitch, enabled),
    /** 自動切替オフ時に使うモデルを選ぶ。 */
    setActive: (id: string): Promise<ModelManageSnapshot> =>
      ipcRenderer.invoke(IPC.ModelSetActive, id),
    /** Code / Chat の担当を入れ替える。 */
    swapAssignment: (): Promise<ModelManageSnapshot> =>
      ipcRenderer.invoke(IPC.ModelSwapAssignment),
    /** Live2D モデルをフォルダ選択で取り込む(ネイティブダイアログ→列挙→自動マッピング→複製→登録)。 */
    importLive2d: (): Promise<ModelManageSnapshot> =>
      ipcRenderer.invoke(IPC.ModelImportLive2d),
    /**
     * 静止画を選ばせ、クロマグリーン合成した background_key.png を保存する(手順1-2)。
     * 選択も保存もネイティブダイアログで、Renderer からパスを渡さない。
     */
    makeBackgroundKey: (): Promise<BackgroundKeyResult> =>
      ipcRenderer.invoke(IPC.SpritesetMakeBackgroundKey),
    /**
     * 色キー抜き済みフレーム(感情ごと・PNG)からスプライトセットモデルを登録する(手順4後段)。
     * デコードと色キー抜きは Renderer 側(decode-video.ts)で終えてから呼ぶ。
     */
    importSpriteset: (payload: SpritesetImportPayload): Promise<ModelManageSnapshot> =>
      ipcRenderer.invoke(IPC.SpritesetImport, payload),
  },
  /**
   * オンボーディング(FR-14)。**Rendererにできないことだけ**をMainへ委譲する
   * (ネイティブのディレクトリ選択・dispatch.shの配置・hooks設定状況の実測)。
   * 画面遷移やステップ管理はRenderer側に閉じている。
   */
  onboarding: {
    /**
     * 初回起動フローを出すべきか(config.onboarding.completed の否定)。**同期的に読める**。
     * IPCで読むと Control Panel の中身が一瞬描かれてから被さるため、起動引数から取る。
     */
    pending: onboardingPending,
    /** 現在の状態(完了フラグ・モデル数・hooks設定状況・貼り付け用JSON)。 */
    get: (): Promise<OnboardingSnapshot> => ipcRenderer.invoke(IPC.OnboardingGet),
    /** 監視するプロジェクトをネイティブダイアログで選ぶ(キャンセルは null)。 */
    chooseProject: (): Promise<string | null> => ipcRenderer.invoke(IPC.OnboardingChooseProject),
    /**
     * dispatch.sh を配置する。既存の内容が異なる場合は書き込まず `exists-differs` が返るので、
     * 利用者の確認を得てから overwrite: true で呼び直す(手を入れたファイルを黙って潰さない)。
     */
    installDispatchScript: (
      projectPath: string,
      overwrite = false,
    ): Promise<DispatchInstallResult> =>
      ipcRenderer.invoke(IPC.OnboardingInstallDispatch, { projectPath, overwrite }),
    /** hooks設定JSONをクリップボードへコピーする(本文はMainが持つ。表示と必ず一致する)。 */
    copySettingsSnippet: (): Promise<boolean> => ipcRenderer.invoke(IPC.OnboardingCopySnippet),
    /** 完了として記録する(スキップ経由でも呼ぶ)。 */
    complete: (): Promise<void> => ipcRenderer.invoke(IPC.OnboardingComplete),
  },
  /**
   * ログ管理(FR-11)。**ファイルを触るのはMainだけ**で、Rendererは要求と表示のみを行う。
   * エクスポート先の選択・消去の確認はネイティブダイアログ(Main)が担う。
   */
  logs: {
    /** 直近のイベント(新しい順)と総件数・保持日数・ファイルパス。 */
    get: (): Promise<HookLogSnapshot> => ipcRenderer.invoke(IPC.LogsGet),
    /** 仮名化した共有用JSONLを保存する(生ログは変更しない)。 */
    export: (): Promise<HookLogExportResult> => ipcRenderer.invoke(IPC.LogsExport),
    /** 確認ダイアログを経てログを消去する。 */
    clear: (): Promise<HookLogClearResult> => ipcRenderer.invoke(IPC.LogsClear),
    /** 新着通知の購読。中身は載らないので、受け取ったら get() で取り直す。 */
    onChanged: (listener: () => void): (() => void) => {
      const handler = (): void => listener();
      ipcRenderer.on(IPC.LogsChanged, handler);
      return () => ipcRenderer.removeListener(IPC.LogsChanged, handler);
    },
  },
  /**
   * EmotionEngine の状態(FR-4)。憑坐状態帯の表示に使う。
   * キャラクターウィンドウはローカルサーバーのWSから受け取るが、Control Panel は dev だと
   * Vite から読まれてトークンが埋め込まれないためIPCで受け取る(ipc.ts の EmotionGet 参照)。
   */
  emotion: {
    get: (): Promise<EmotionSnapshot> => ipcRenderer.invoke(IPC.EmotionGet),
    onChanged: (listener: (snapshot: EmotionSnapshot) => void): (() => void) => {
      const handler = (_e: unknown, payload: EmotionSnapshot): void => listener(payload);
      ipcRenderer.on(IPC.EmotionChanged, handler);
      return () => ipcRenderer.removeListener(IPC.EmotionChanged, handler);
    },
  },
} as const;

export type YorimashiApi = typeof api;

contextBridge.exposeInMainWorld('yorimashi', api);
