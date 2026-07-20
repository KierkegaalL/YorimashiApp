/**
 * MainとRenderer(preload)が共有するIPCチャンネル名。
 * 文字列リテラルを両側に散らすとタイポで沈黙する不具合になるため、ここを単一の情報源にする。
 *
 * キャラクターウィンドウのドラッグ移動(character-window.md 論点3「ドラッグ移動の実装方式」):
 * `-webkit-app-region: drag` は右クリックメニューと衝突するため採用せず、Renderer側で
 * mousedown→mousemove を検知し、算出した絶対座標をMainへ送って win.setPosition() で追従させる。
 */

export const IPC = {
  /** invoke: ドラッグ開始。Mainが現在のウィンドウ左上座標 {x,y} を返す。 */
  CharacterBeginDrag: 'character:begin-drag',
  /** send: ドラッグ中の目標座標 {x,y}(スクリーン座標)。Mainが setPosition する。 */
  CharacterDragMove: 'character:drag-move',
  /** send: ドラッグ終了。Mainが windowPosition をデバウンス保存する。 */
  CharacterEndDrag: 'character:end-drag',
  /** send: クリックスルーOFF時の右クリック。Mainが共通メニューをカーソル位置に表示する。 */
  CharacterContextMenu: 'character:context-menu',

  /**
   * send: 折りたたみの切替要求。Mainが BrowserWindow の幅を 976⇄576 に変更し config へ保存する。
   * **ウィンドウ幅の変更はMainにしかできない**ため、Renderer側でCSS幅を変える実装にはしない
   * (chat-pane.md 論点1「内部レイアウトの再フローではなくウィンドウ自体を縮小する」)。
   */
  ControlPanelSetCollapsed: 'control-panel:set-collapsed',

  /**
   * invoke: 会話ペインからのメッセージ送信(FR-3/FR-15)。Mainが受理して requestId を返し、
   * 以降の実況は ChatStream(Main→Renderer)で流す。**Chat AdapterはMainにしか無い**
   * (APIキーを扱うのはMainのみ。security.md 5章)。
   */
  ChatSend: 'chat:send',
  /** send: 応答の中断(停止ボタン)。中断経路でも release('thinking') を必ず通す。 */
  ChatStop: 'chat:stop',
  /**
   * send: 会話履歴の消去(`/clear`)。**Main側の履歴も消す**。
   * Rendererの表示だけ消すと、画面は空なのにAPIへは過去の文脈が送られ続け、
   * 「消したはずの会話が効いている」という食い違いになる(会話履歴の正本はMain)。
   */
  ChatReset: 'chat:reset',
  /** Main→Renderer: streaming の実況(start/chunk/done/aborted/error)。 */
  ChatStream: 'chat:stream',

  /**
   * invoke: 現在の EmotionSnapshot を取得する(会話ペインの憑坐状態帯の初期表示)。
   * キャラクターウィンドウは**ローカルサーバーのWS**から受け取るが(api.md 3章)、Control Panel は
   * IPCで受け取る。理由: dev では Control Panel を Vite から読むためサーバーがHTMLへ埋め込む
   * トークン(`window.__APP_TOKEN__`)が無く、WSに接続できないため。preloadはdev/prodどちらでも
   * 効くので、パネル側はIPCに寄せる(この非対称は意図的)。
   */
  EmotionGet: 'emotion:get',
  /** Main→Renderer: EmotionSnapshot の変化通知(憑坐状態帯の追従)。 */
  EmotionChanged: 'emotion:changed',

  /**
   * invoke: Rendererが表示・操作するモード類(activeAdapter / chatAdapter.mode)を取得する。
   * **正本は config(Main)**。Renderer側のstateはその写しでしかない。
   */
  ChatConfigGet: 'chat-config:get',
  /**
   * send: モードの変更要求(`/mock`・`/real`・`/code` や「モックモードに切り替える」ボタン)。
   * Rendererのstateだけ変えると「UI上はmockなのに実際はrealへ送る」という食い違いが起きるため、
   * **必ずMainのconfigを更新し、その結果をChatConfigChangedで受け取って反映する**。
   */
  ChatConfigSet: 'chat-config:set',
  /** Main→Renderer: モード類の変化通知(Trayからの activeAdapter 切替にも追従するため)。 */
  ChatConfigChanged: 'chat-config:changed',

  /**
   * モード設定タブ(FR-7)の Chat Adapter セクション。ChatConfigGet/Set が**会話ペイン**の
   * 表示に必要な最小限だけを扱うのに対し、こちらは設定画面がAPIキーまで扱う。
   *
   * **APIキーの値はMain→Rendererの向きには決して流れない**(security.md 5章)。
   * `ChatSettingsGet` が返すのは `hasApiKey` と末尾4文字だけ。
   */
  /** invoke: mode / model / APIキーの設定状況(キー本体は含まない)。 */
  ChatSettingsGet: 'chat-settings:get',
  /** invoke: mode / model / APIキーの更新。更新後のスナップショットを返す。 */
  ChatSettingsSet: 'chat-settings:set',

  /**
   * モード設定タブ(FR-7)の Code Adapter セクション。監視対象パス・ポート番号・
   * 連続失敗しきい値(config.codeAdapter / config.emotionEngine.failStreakThreshold)の表示と変更。
   *
   * **watchedProjectPaths への追加はネイティブダイアログ経由に限る**(CodeSettingsChooseProject)。
   * Renderer から任意のパス配列を書かせない(dispatch.sh の書き込み先を利用者の明示選択に
   * 限定する不変条件。onboarding-service.ts / shared/code-settings.ts)。CodeSettingsSet は
   * ポートとしきい値だけを扱う。削除は監視範囲を狭めるだけで安全なので特定パス指定で受け付ける。
   */
  /** invoke: 監視対象パス・ポート(設定値/実値)・失敗しきい値のスナップショット。 */
  CodeSettingsGet: 'code-settings:get',
  /** invoke: ポート/失敗しきい値の更新。更新後のスナップショットを返す。 */
  CodeSettingsSet: 'code-settings:set',
  /** invoke: 監視対象プロジェクトをネイティブダイアログで1件追加する。更新後のスナップショットを返す。 */
  CodeSettingsChooseProject: 'code-settings:choose-project',
  /** invoke: 監視対象プロジェクトを1件外す(引数は対象パス)。更新後のスナップショットを返す。 */
  CodeSettingsRemoveProject: 'code-settings:remove-project',

  /**
   * オンボーディング(FR-14)。Rendererにできない3つだけをMainへ委譲する:
   * ネイティブのディレクトリ選択・dispatch.shの配置・hooks設定状況の実測
   * (detailed-design/onboarding.md / main/onboarding/onboarding-service.ts)。
   */
  /** invoke: 現在の状態(完了フラグ・モデル数・hooks設定状況・貼り付け用JSON)。 */
  OnboardingGet: 'onboarding:get',
  /** invoke: 監視するプロジェクトをネイティブダイアログで選ぶ。選ばれたパス or null。 */
  OnboardingChooseProject: 'onboarding:choose-project',
  /** invoke: 選んだプロジェクトへ dispatch.sh を配置する({projectPath, overwrite})。 */
  OnboardingInstallDispatch: 'onboarding:install-dispatch',
  /**
   * invoke: hooks設定JSONをクリップボードへコピーする。**本文をRendererから受け取らない**
   * (Mainが生成した同じ文字列をコピーするので、画面の表示とコピー内容が必ず一致する)。
   */
  OnboardingCopySnippet: 'onboarding:copy-snippet',
  /** invoke: 完了として記録する(スキップ経由でも呼ぶ)。 */
  OnboardingComplete: 'onboarding:complete',

  /**
   * ログ管理(FR-11)。**ログの実体はMainのファイル**(userData/logs/hook-events.jsonl、0600)で、
   * Rendererはそれを読む・書き出す・消すよう要求するだけ。Renderer側にファイルパスを渡すのは
   * 画面に表示するためで、Rendererからの書き込み経路は無い。
   */
  /** invoke: 直近のイベント(新しい順・上限あり)と総件数・保持日数・ファイルパス。 */
  LogsGet: 'logs:get',
  /** invoke: 仮名化した共有用JSONLを保存する(ネイティブの保存ダイアログ)。生ログは変更しない。 */
  LogsExport: 'logs:export',
  /** invoke: 確認ダイアログを出してからログを消去する。 */
  LogsClear: 'logs:clear',
  /**
   * Main→Renderer: 新しいイベントを記録した通知(ログタブの自動更新)。
   * **中身は載せない**。受け取った側が LogsGet で取り直す(表示は常にファイルが正)。
   */
  LogsChanged: 'logs:changed',
} as const;

/**
 * Control Panel の初期折りたたみ状態を Main → preload へ**同期的に**渡すための起動引数
 * (`webPreferences.additionalArguments`)。`--yorimashi-collapsed=true|false` の形で入る。
 *
 * IPC(非同期)で読むと、Mainが保存値どおりの幅(576px)で生成したウィンドウに、応答が届くまで
 * 展開レイアウト(Control Panel 400px + タブ16px)が一瞬描画されうる。preload は初回描画より前に
 * 走るため、起動引数なら**最初のフレームから正しい状態**で描ける。
 * sandbox:true のpreloadでも `process.argv` から読めることは実測で確認済み。
 */
export const CONTROL_PANEL_COLLAPSED_ARG = '--yorimashi-collapsed=';

/**
 * オンボーディング(FR-14)が未完了かどうかを Main → preload へ**同期的に**渡す起動引数
 * (`--yorimashi-onboarding-pending=true|false`)。
 *
 * 折りたたみ状態(上)と同じ理由で起動引数にする。IPC(非同期)で読むと、初回起動時に
 * **Control Panel の中身が一瞬描かれてからオンボーディングが被さる**。preload は初回描画より
 * 前に走るため、起動引数なら最初のフレームからオンボーディングを描ける。
 */
export const ONBOARDING_PENDING_ARG = '--yorimashi-onboarding-pending=';

/** character:drag-move / character:begin-drag(戻り値)で運ぶ座標。 */
export interface WindowPoint {
  x: number;
  y: number;
}
