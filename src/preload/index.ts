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
  ChatStreamEvent,
} from '../shared/chat';
import type { EmotionSnapshot } from '../shared/emotions';
import type { DispatchInstallResult, OnboardingSnapshot } from '../shared/onboarding';

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
    send: (text: string): Promise<ChatSendAccepted> => ipcRenderer.invoke(IPC.ChatSend, text),
    /** 応答の中断(停止ボタン)。 */
    stop: (): void => ipcRenderer.send(IPC.ChatStop),
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
