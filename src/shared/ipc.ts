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
   * 権利情報タブ(FR-12)。config に由来する動的な値だけを返す(Live2D の利用区分)。
   * OSS 一覧はビルド時生成の shared/oss-licenses.ts を Renderer が直接 import するため IPC を通さない。
   */
  /** invoke: 権利情報のうち config 由来の値(live2dCommercialLicense)。 */
  RightsGet: 'rights:get',

  /**
   * モデル管理タブ(FR-5/FR-7)の**スロット管理**。取り込み(Live2D のフォルダ/zip・スプライトセット
   * 生成)と感情↔モーション対応の編集は、それぞれ別チャンネルとして下記に実装済み。
   *
   * いずれも更新後のスナップショットを返す。**Renderer にファイルパスは渡さない**
   * (表示に不要で、Renderer 由来のパスを信じる経路を作らないため。shared/model-manage.ts)。
   */
  /** invoke: スロット一覧・自動切替・解決済みアクティブモデル。 */
  ModelGet: 'model:get',
  /** invoke: スロットを1件削除する(引数はモデルid。ファイル実体も消す)。 */
  ModelDelete: 'model:delete',
  /** invoke: スロットの表示名を変更する(引数は { id, name }。config のみ変更しファイルは触らない)。 */
  ModelRename: 'model:rename',
  /** invoke: モードによる自動切替の ON/OFF(引数は boolean)。 */
  ModelSetAutoSwitch: 'model:set-auto-switch',
  /** invoke: 自動切替オフ時に使うモデルを選ぶ(引数はモデルid)。 */
  ModelSetActive: 'model:set-active',
  /** invoke: Code / Chat の担当を入れ替える。 */
  ModelSwapAssignment: 'model:swap-assignment',
  /**
   * invoke: Live2D モデルを**フォルダ選択**で取り込む(第2段階a)。ネイティブダイアログで
   * フォルダを選ばせ、列挙・自動マッピング・複製・スロット追加まで行い、更新後のスナップショットを返す。
   * zip 取り込みは `ModelImportLive2dArchive`(下記)。
   */
  ModelImportLive2d: 'model:import-live2d',
  /** Live2D の zip 取り込み(フォルダ取り込みと同じ結果=更新後スナップショットを返す)。 */
  ModelImportLive2dArchive: 'model:import-live2d-archive',

  /**
   * 感情↔モーション/クリップ対応の編集(第3段階 Track A / model-mapping-ui.md)。
   * マッピングの正本は各モデルの manifest.json で、以下はその読み書き。編集後は編集対象が
   * アクティブなら index.ts がキャラクターウィンドウを再読込する(表示と設定を食い違わせない)。
   */
  /** invoke: 指定モデルの現在のマッピング詳細(引数はモデルid)。Live2Dは候補も同梱。 */
  ModelMappingGet: 'model:mapping:get',
  /** invoke: Live2D の1状態の motion/expression を設定(引数は {id, state, patch})。 */
  ModelMappingSetLive2d: 'model:mapping:set-live2d',
  /** invoke: Live2D の1状態を自動検出でやり直す(引数は {id, state})。 */
  ModelMappingAutoRestore: 'model:mapping:auto-restore',
  /** invoke: Live2D の全10状態を自動検出でやり直す(引数はモデルid。確認はUI側)。 */
  ModelMappingAutoRestoreAll: 'model:mapping:auto-restore-all',
  /** invoke: スプライトセットの1クリップを削除=未割当に戻す(引数は {id, state}。idle不可)。 */
  ModelMappingDeleteClip: 'model:mapping:delete-clip',
  /**
   * invoke: スプライトセットの1クリップを差し替え/新規設定する(第3段階 Track B / 論点3「変更」)。
   * 引数は {id, state, clip}(clip は色キー抜き済みPNGフレーム。取り込みと同じ経路)。idle も差し替え可。
   * デコード・色キー抜きは Renderer(Chromium)、WebPエンコードは Main(sharp)という工程分担は取り込みと同じ。
   */
  ModelMappingSetClip: 'model:mapping:set-clip',
  /**
   * invoke: プレビュー描画(第3段階 Track C / 論点1)用に、対象モデルの配信情報を返す(引数はモデルid)。
   * 返り値は {installedDir, mappingFile}(= CharacterBootstrapModel)。Control Panel のプレビュー枠は
   * これと `window.__APP_TOKEN__`(/panel が埋め込む) + `window.location.origin` から assetBaseUrl を組み、
   * キャラクターウィンドウと同じ `/models/*` 経路で manifest/アセットを読む。**プレビュー対象はアクティブ
   * モデルと別に選ぶ**ため /panel には bootstrap を埋め込まず、id 指定のこのIPCで解決する。
   */
  ModelPreviewContext: 'model:preview-context',

  /**
   * スプライトセット生成(第2段階b / spriteset-pipeline.md)。**工程がプロセスをまたぐ**:
   * 動画のデコードと色キー抜きは Chromium にしかできないので Renderer(Control Panel)が行い、
   * アニメーションWebPへのエンコードと保存は sharp を持つ Main が行う。
   */
  /**
   * invoke: 静止画を選ばせ、クロマグリーン合成した `background_key.png` を保存する(手順1-2)。
   * **選択も保存もネイティブダイアログ**で、Renderer からパスを受け取らない。
   * 返り値は {saved, path}(キャンセルは saved=false)。
   */
  SpritesetMakeBackgroundKey: 'spriteset:make-background-key',
  /**
   * invoke: 色キー抜き済みフレーム(感情ごと・PNG)を受け取り、アニメーションWebPへエンコードして
   * モデルとして登録する(手順4後段)。引数は {name, clips}、返り値は更新後のスナップショット。
   *
   * **フレームは Renderer で PNG 化してから渡す**(生RGBAは 800×800×4≒2.5MB/枚 になるため)。
   * canvas の WebP は quality:1 でも可逆ではないと実測したため、可逆な PNG を使う
   * (decode-video.ts 冒頭の訂正を参照)。
   */
  SpritesetImport: 'spriteset:import',

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
