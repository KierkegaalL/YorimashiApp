# Memory.md — ヨリマシ.app 状況記録

> セッションをまたいだ引き継ぎ用。`TaskCreate`/`TaskUpdate` がセッション内の再開用、本ファイルはセッション間の引き継ぎ用（次回セッション冒頭でも状況を把握できるようにする）。チェックポイント（.claude/rules/build-commands.md）ごとに更新する。

**最終更新**: 2026-07-24

## 現在地

**設計フェーズ完了。実装フェーズ開始（2026-07-18）。**

- **`develop`ブランチを作成しpush済み**（`main`から分岐。git-workflow.md「決定済み」の移行手順どおり）。以降のマージ先は常に`develop`（CLAUDE.md原則9・git-workflow.md反映済み）
- 作業ブランチ(`feature/<name>`等)は`develop`から分岐する

- 詳細設計8件すべて確定（`docs/detailed-design/`）
- スキャフォールドのみ実装済み（Electron + TS + React + Vite）
- **FR-8（ブラウザ拡張機能連携）とFR-9（表示排他制御）をボツとして全書類から削除**（要件定義書C-20）。拡張機能を実装しないため、Viewerの排他制御自体が不要になった。番号は欠番のまま維持（詰めない）
  - 影響範囲: Notion(要件定義書・基本設計書)、docs/requirements.md・basic-design.md・data.md・api.md・security.md、detailed-design(chat-adapter-errors.md・model-mapping-ui.md)、config-schema.ts(`distribution.chromeExtensionId`/`chromeStorePublished`削除)、CLAUDE.md・environments.md・features.md、すべて反映済み
- **新規FR-15（会話ペイン）を追加**（要件定義書C-21・C-22）。「取り込んだモデルと会話する画面」が要件レベルで一切存在しなかった欠落への対応。**Control Panelと同一ウィンドウ内の左ペイン**（別ウィンドウにしない）。既定で両方展開、縁のタブでControl Panel(設定画面)側のみ折りたたみ可(2026-07-18に会話ペイン側から反転。下記参照)。**会話履歴はv1では永続化しない**（メモリのみ。保持期間・パーミッション・削除UIが未定義のため）
  - ⚠️ **経緯**: 当初「独立ウィンドウ・独立して開閉可能」としてNotionに書いたが誤りで、ユーザーの意図は「一体化・タブで折りたたみ」だった。Notion・docs・rules すべて訂正済み
- **FR-15に入力欄まわりの機能を追加（2026-07-18・デザイン承認済み、要件定義書C-23/C-24）**。Claude/Claude Code相当の操作: スラッシュコマンド・**@参照（ユーザー明示選択の限定的文脈参照）**・添付(real)・応答モデル選択(real)・停止・メッセージ操作・コンテキスト表示・入力ヒント。**論点5決着=案1**（送信時に`activeAdapter`をChatへ自動切替+明示=C-24）、**折りたたみ状態の保存先決定**（`config.general.controlPanelCollapsed` default false）。Notion（要件定義書・基本設計書）+ docs（requirements/basic-design/data/security）+ detailed-design（chat-pane.md 論点7）+ config-schema.ts に反映済み（reviewer 0件）。**「作業状況を参照＝Code文脈の自動取り込み」はv1不採用（将来検討）**。視覚モックはArtifactで確認、`control-panel.jsx`への2ペイン+入力欄統合は2026-07-18に実装済み（下記参照）
- **仕様変更: 折りたたみ対象を会話ペインからControl Panel側へ反転（2026-07-18・ユーザー指示）**。「中央のタブを押すと閉じるのは会話画面ではなく設定画面側にしてほしい」との指示を受け、C-21を改定。会話ペインは常時表示・折りたためない、Control Panel(6タブ)側が縁のタブで折りたたみ可能に変更。**config-schemaのフィールド名も`chatPaneCollapsed`→`controlPanelCollapsed`に改名**（実装未着手のため破壊的変更なし）。Notion（要件定義書C-21・基本設計書4.1/4.4/6.1）+ docs（requirements/basic-design/data）+ detailed-design（chat-pane.md 論点1・結論表・実装TODO）+ config-schema.ts に反映済み
- **仕様追加: 折りたたみ時はウィンドウ全体を会話ペイン幅まで縮小（2026-07-18・ユーザー指示）**。単に中身を隠すのではなく、Control Panelウィンドウ(Electron `BrowserWindow`)自体の幅を縮める方式に決定。展開976px(会話ペイン560+タブ16+ControlPanel400)⇄折りたたみ576px(会話ペイン560+タブ16)。実装時はMain側で`setBounds()`により幅のみ変更(高さ・x,y固定、右辺のみ動かす)。detailed-design(chat-pane.md 論点1)に反映済み
  - **モックアップを2ペイン構成に書き換え（同日）**: `docs/mockups/control-panel.jsx`の最外殻のみ変更(`Section`/`Row`/`THEMES`は無改変)。会話ペイン(憑坐状態帯・履歴・入力欄)を新設し、入力欄機能(C-23: スラッシュ/@参照/添付/応答モデル選択/停止/コンテキスト表示/メッセージ操作/入力ヒント)を実装。折りたたみトグルで外側コンテナのwidthを976⇄576pxアニメーションさせ、ウィンドウ縮小の見た目を再現
  - **GUI不要の検証を実施**: esbuildでReact+lucide-reactをバンドルしBrowserで実描画・操作確認(折りたたみ往復・送信/mock固定返答/停止トグル・スラッシュメニュー各コマンド・realモード切替時の添付/モデル選択/コンテキストメーター有効化)。**Electronアプリ本体の動作確認ではない**
  - **reviewerチェックループ**: 1周目で指摘3件(Memory.mdの未実施チェックの自己申告・`/model`スラッシュコマンド未配線・ASCII図の`maxWidth`表記陳腐化)。すべて修正し2周目で指摘0件を確認済み
  - **コミット後、ユーザー依頼で改めて実装後チェックループを実行（2026-07-18・本チェックループ自体は未コミット）**: 指摘1件(`control-panel.jsx`の応答モデル循環ロジックが`/model`コマンドと入力欄フッターの2箇所に重複)→`cycleResponseModel()`に共通化して修正。加えて**未決着の論点2件を新規検出**: (1)折りたたみリサイズをmacOSネイティブアニメーション付きにするか(`setBounds()`/`setSize()`とも`animate`引数を取れるが、所要時間はOS依存でモックアップの0.25sと一致するかは未実測)、(2)Control Panelウィンドウの`resizable`/`minimumSize`が未定義(手動リサイズで976/576px前提のレイアウトが崩れうる)。**推測で決めず**、chat-pane.md実装TODOに要決着として追記。ユーザーへ報告済み
- **APIキー取得の案内を追加（2026-07-18・ユーザー指摘）**。「Anthropic APIキーを手動入力させるのは難しいのでは」との懸念に対し、**OAuthサインインは選択肢にならない**(AnthropicはMessages APIへの第三者アプリ向け公開OAuth連携を提供しておらず、Claude Code CLIのアカウントログインは公式ツール専用の内部機構)ことを確認した上で、摩擦を減らす方向で対応。モード設定タブのAPIキー欄に、取得手順(4ステップ)+「console.anthropic.com を開く」ボタンを常設。外部サイトへの遷移は`src/main/index.ts`の既存`setWindowOpenHandler`(`window.open()`を捕まえ`shell.openExternal()`へリダイレクト)に乗せる想定とし、専用IPCは前提としない。`docs/mockups/control-panel.jsx`(`API_KEY_STEPS`)+ detailed-design(chat-adapter-errors.md 論点5)に反映済み。**Notion要件定義書は未変更**(FR-3の既存記述と矛盾しないUI/実装詳細レベルの追加と判断)
  - **reviewerチェックループ**: 1周目で指摘4件。うち重大1件(「Live2D公式サイト・7.3外部動画生成AIサービスへの導線にも共通適用する」という一般化が、7.3の「特定ベンダー非依存」方針・Live2Dランタイムが開発者用ビルド時アセットである実態と矛盾。存在しないボタンを既定路線扱いしていた)、中3件(既存`setWindowOpenHandler`実装を踏まえず専用IPC新設を前提にしていた、論点1の401事後対応との関係が未記載、対応する実装TODO欠落)。**論点5をAPIキーボタンのみに限定**し、7.3・Live2Dへの拡張は「別途検討・勝手に広げない」と明記して修正。すべて修正しTODOにも反映済み
- **未決事項は8件**（A1・A2・B1〜B6は解消済み。**A2は完了**。**C7も2026-07-18に決着**。残りはC0〜C6・C8）
- **A2完了（2026-07-18）**: `dev-assets/live2d/` に pixi-live2d-display 公式サンプルを配置した（`shizuku/`=Cubism2.1 / `haru/`=Cubism4、公式サンプルDLをユーザー承認済み）。整合を確認（moc/moc3マジックバイト、**列挙構造の検証に必要な**定義ファイル＝model3.json/model.json・moc/moc3・motion・expression・texture の実在）。ただし**音声(`Sound`/`sounds/*.mp3`)と`DisplayInfo`(`haru...cdi3.json`)は欠落**（公式サンプル自体が参照だけ持ち実体を同梱せず、Haruは`Sound`が兄弟フォルダ`../shizuku/sounds/`を相対参照する箇所すらある）。**v1は音声機能を使わず、`pixi-live2d-display`も音声失敗を`logger.warn`で握りつぶす**ため実害なし。`dev-assets/`は`.gitignore`対象（`git ls-files`はREADME.mdのみ）
  - **GUI不要の実測を実施し、2つの詳細設計の「未検証」マーカーを解消**（reviewer チェックループ指摘0件で完了）:
    - **model-mapping-ui.md 論点2/列挙元**: Cubism2/4の列挙構造の表を実モデルで確認済みに更新。**実装差分**: 表情の`Name`(cubism2は`name`)はファイル名と不一致（Haru `Name:"f00"→F01.exp3.json`）／モーショングループ名の命名規則は一定でない（公式サンプルはHaru=PascalCase `Idle`・Shizuku=snake_case `tap_body`だったが、これはモデル作者の慣習でCubism仕様がバージョンごとに強制するものではない。n=1×2。ハードコードせず`normalize()`で吸収）
    - **lipsync.md 尽きたときの挙動**: `pixi-live2d-display`バンドルソース読解で確定。①モーション終了時は基底`MotionManager.update()`が**idleグループへ自動フォールバック**（固まらない。要idleグループ）②個々のモーションはループしない（Cubism4は`Meta.Loop:true`無視。Cubism2は外部ランタイムのため未確認）③**帰結: 非idleのReaction持続はEmotionEngine側の再発火で管理。`data.md 2.1`に`loop`を足す必要はない**（スプライトセットの`loop`に対応物をLive2Dへ持たせない=非対称は正当）
    - 派生TODO: モデル取り込み時に**idleグループの存在を検証**する（無いと固まる）。model-mapping-ui.md TODOへ追記済み
  - 生データはVault `開発/計測/` に2件記録（`pixi-live2d-displayはモーション終了時にidleへ自動フォールバックする`・`Cubism2と4で列挙構造とファイル形式が異なる`）
  - **残る実測は2種類（別種の検証）**: (a) ①②の最終確認＝実装時のWebGL実描画で目視。(b) Cubism2の`setIsLoop`相当の有無＝外部ランタイム`live2d.min.js`（Cubism公式サイト取得、npmに無い）の**ソース読解**で判明する話でWebGL描画とは別物。混同しない
  - **PixiJSはv6系で固定**。`pixi-live2d-display`安定版のpeerが`^6`。v8（npm最新）とは別クラス（`instanceof`不一致を実測）。beta(0.5.0-beta)はv7対応だが2023-12以降更新なし。Cubism 2/4はそれぞれ外部ランタイム（`live2d.min.js`/`live2dcubismcore.js`）が必須で、無いとimport時に例外。詳細は`.claude/rules/environments.md`「PixiJSのバージョン方針」
  - **非対称は正当**: `dev-assets/`はLive2D専用（`spriteset/`は無い）。Live2Dは完成済みモデルを**配置**する形式（フォルダ/zipドロップ）だが、スプライトセットは静止画1枚から**アプリ内で生成**する形式（要件定義書4.5・C-17）で、事前配置するモデル資材という概念自体が存在しない。character-window.mdで確認済みの非対称と同じ構造
- **A1+B（B1〜B6）をNotion正本に反映済み**（基本設計書・要件定義書 両方 + docs/data.md・config-schema.ts）。`baseResolution`を形式共通必須化、EmotionEngineに`sustain`/`release`、`chatAdapter`にclassifier等追加、streakしきい値を`emotionEngine`へ移動、Anthropic SDKを技術スタックへ、`cubismVersion`にコメント明示、9章の記述誤り修正
- **副次的に発見した既存バグを修正**: `config-schema.ts`の`createDefaultConfig()`が実際には空値しか返さなかった。Zod v4は`.default(v)`だと入力undefined時に`v`をバリデーションなしで採用し、ネストしたフィールドの`.default()`が補完されない。`.prefault(v)`に変更して解決（実行時に全フィールド正しく補完されることを確認済み）

## 完了済み作業

| 内容 | 成果物 |
|---|---|
| 設計ドキュメントと開発ハーネスの配置 | `docs/`・`CLAUDE.md`・`.claude/` |
| Electronスキャフォールド | `src/{main,preload,shared,renderer}`・`electron.vite.config.ts`・tsconfig 3種 |
| Notion正本の更新（C-19メニューバーアイコン、windowPosition） | Notion 要件定義書・基本設計書 + docs/ ミラー |
| 詳細設計8件の確定 | `docs/detailed-design/*.md` |
| ハーネス整備（たそがれ日記ベースへ移行） | `.claude/rules/`・`agents/`・`commands/`・`Memory.md` |

### 詳細設計で実測して確定した主な事項

推測ではなく実測に基づく。**実装時にこれを覆さないこと。**

- **sharp** を採用（Node-APIのためElectronで再ビルド不要）。`join`でフレーム配列からアニメーションWebPを生成でき、アルファも保持。**ffmpeg同梱は不要**（Electron内蔵ChromiumがH.264/VP8/VP9/AV1をデコードできる）。**jimpはWebPコーデックを持たず、しかも31MBでsharp(18MB)より重い**
- **WebCodecsはsecure contextでのみ有効**。`http://localhost`なら可、`data:`は不可。security.md 7章の「localhostから読み込む」方針と連動している
- **macOSは画面外座標を補正しない**。`setBounds({x:99999,y:99999})`がそのまま通る。自前クランプが必須
- **`setAlwaysOnTop(true, 'normal')`は最前面を無効化する**（`isAlwaysOnTop()`がfalse）。`'floating'`を使う
- **Anthropic SDKの`timeout`は凍ったstreamに効かない**。`AbortSignal`による無通信ウォッチドッグが必須。既定は600000ms(10分)でリトライ対象のため最悪30分ハングする
- **SDKは429で`retry-after`を尊重して自動リトライする**（実測1.01s間隔）。自前でバックオフを書かない
- **`navigator.onLine`はElectron Mainで`undefined`**（`navigator`自体は存在するのでガードを通過してしまう）
- **感情分類は否定表現の打ち消しが必須**。ただし「申し訳ありません」は語自体が「ません」を含むため除外指定が要る

## Obsidian Vault（ハーネスの知識置き場）

`~/Documents/Obsidian Vault/開発/` に**実測の生データ・越境知識・セッションの経緯**を置いている（`.claude/rules/constraints.md` 参照）。

- **Vaultは正本ではない。** 境界は「cloneした他人が実装に必要か」。必要ならrepo、無くても実装できるならVault
- `開発/計測/` に本セッションの実測8件（下記「実測して確定した主な事項」の生データと再現手順）
- Obsidian MCP（`mcp-obsidian`）は本プロジェクトに `local` スコープで接続済み。**Obsidianアプリ起動中のみ有効**
- **⚠️ ハーネスのObsidian ≠ アプリの `config.obsidian`**（未決事項C0）

## 未決事項（8件）

A1・A2・B1〜B6は解消済み（**A2は2026-07-18に完了**、上記参照）。残るのはC0〜C6・C8（**C7は2026-07-18に決着**＝C-24採用・`controlPanelCollapsed`追加、上記参照）。**実装着手をブロックする未決事項は無くなった**。

### 優先度C — 該当機能の実装時に併せて

| # | 内容 | 契機 |
|---|---|---|
| C0 | **`config.obsidian`（`vaultPath`/`syncMode`）と `config.notion` に対応するFRが無い**。configにだけ存在し、FR-1〜FR-15のどれにも紐づいていない。要件側の定義が要る | 要Notion確認 |
| C1 | 権利情報タブのOSS一覧に`sharp`/`libvips`追加（libvipsはLGPL-3.0で既存のMIT/ISCと種別が違う） | FR-12 |
| C2 | フォントをGoogle Fontsの`@import`からローカル同梱へ（CSP・オフライン・外部リクエスト） | ローカルサーバー |
| C3 | Rendererの読み込み元を`http://localhost:8765`へ移行（security.md 7章。**WebCodecsの有効化条件**） | 同上 |
| C4 | api.md 6章「直叩き」→ SDK採用に記述更新 | Chat Adapter |
| C5 | オンボーディング完了フラグの保存先（config未定義） | FR-14 |
| C6 | `displaySize`の範囲（モックアップ20-100% vs スキーマ0.1-2.0）。**UIから届かない範囲がスキーマ側にある** | FR-7 |
| C8 | モックアップの`maxWidth: 400`(model-mapping-ui.md論点2の結論根拠)は**元々「Chrome拡張のサイドパネルに収まるため」という理由だった**。FR-8削除でこの理由は無効化。値自体は変えず事実ベースの記述に差し替えていたが、**2026-07-18にモックアップ最外殻を2ペイン構成へ書き換え済み**(会話ペインflex:1 + タブ16px + Control Panel`width:400`固定 = 展開976px/折りたたみ576px)。「600px分が空白」だった不整合はこの書き換えで解消。**残る論点は`chat-pane.md`実装TODOに一本化**(ウィンドウ既定値1000×720とコンテンツ976/576pxの差を実機でどう埋めるか) | chat-pane.md 実装TODO参照。実装時に解消 |

### 次回セッションで棚卸しすべきこと

- **`chat-adapter-errors.md`・`emotion-classification.md`・`lipsync.md`の「要決着」マーカーが古いまま。** 3ファイルとも「Notion正本の変更が必要」とTODOに書かれているが、実際にはA1+B一括更新で全て解決・反映済み（`sustain`/`release`・`classifier`・streakしきい値の移動等）。実装者が二重に変更提案しないよう、次のチェックポイントで一括棚卸しする

## 実装フェーズの進捗（タスク化・2026-07-18）

実装優先度をPhase 0〜3(全14項目)に整理し`TaskCreate`でタスク化済み(セッション内の進捗はタスクリストを参照)。

- **完了 #1: EmotionEngine本体(FR-4)** — `src/main/emotion-engine.ts`新規実装。basic-design.md 5.2・lipsync.md(sustain/release)・emotion-classification.md(cooldown/優先度の役割分担)に基づく。GUI不要のfake scheduler検証(42ケース)で優先度調停・cooldown・sustain/release・streak遷移・sleepy・emit抑制を実データ確認。reviewerチェックループ2周(1周目6件指摘→修正→2周目0件)で完了
  - **1周目で検出した実バグ**: 無操作タイマー(sleepy用)が、sleepyより高優先なReactionにブロックされて`trigger('sleepy',...)`が失敗すると恒久的に再武装されない不具合。`settleToIdle()`ヘルパーに集約し、Reactionがnullへ戻る全経路(自然タイムアウト・release)で必ず`armIdleTimer()`を呼ぶよう修正
  - **正本に無い判断を明記**: sleepyは優先度チェーン(basic-design.md 5.2)に無いため、Reaction内で最下位(idle系の直上)とコードコメントで明記
  - **TODO化 → #9で解消済み**: `Stop`イベント(basic-design.md 7.1「Moodのみidle寄りに重心移動」)に対応する専用API。#9で`onSessionStop()`(両streakの切り捨て半減)として実装した
  - **実装時のGUI確認事項(reviewer2周目の参考コメント)**: `registerActivity()`がsleepy解除で`release('sleepy')`を呼んだ直後、新Reactionの`trigger()`が同一tick内で2回emitする経路がある(実害なしと判断、修正見送り)。Live2D/spriteset両形式のCharacterRenderer実装時、一瞬の中間遷移が視覚的に見えないかを確認する(対称性チェック対象ではなく両形式共通の挙動)
  - `EmotionSnapshot`型は#2で`src/shared/emotions.ts`へ移動した(Main/Renderer共有契約。WS配信で両者が同じ型を参照するため)。`emotion-engine.ts`は`export type { EmotionSnapshot }`で再エクスポートのみ
- **完了 #2: ローカルサーバー(FR-2/FR-13)** — `src/main/local-server/`(local-server.ts本体・auth-token.ts・safe-path.ts)+`src/shared/ws-messages.ts`を新規実装。security.md・api.md準拠: 127.0.0.1限定バインド、ポート8765競合時フォールバック(解決ポートは`start()`が返す)、X-App-Token認証(定数時間比較)、`/panel`・`/character`(認証不要+CSP`frame-ancestors 'self'`+トークンHTML埋め込み`window.__APP_TOKEN__`)、POST /hook(認証+ボディ上限+onHookEventコールバック)、GET /models/*(認証+パストラバーサル対策)、WS /ws?token=(トークン検証+EmotionEngineスナップショット配信)。`ws`パッケージ追加(main bundleで外部化確認)。`src/main/index.ts`でサーバー起動を配線(token生成・EmotionEngine生成・start)。GUI不要のオフスクリーン検証34ケース全通過(実サーバー起動しhttp/wsで叩く)。reviewerチェックループ2周(1周目5件→修正→2周目0件)で完了
  - **スコープ判断**: Rendererの実ウィンドウ読み込み元をサーバー(`loadURL('http://127.0.0.1:<port>/panel')`)へ移す移行(C3)は、**キャラクターウィンドウ生成(#4)と対で行う**ため#2に含めず。サーバー本体(`/panel`・`/character`のHTML配信+トークン埋め込み+CSP)は完成済みで、window loadURL接続のみ#4送り。`index.ts`にTODO明記
  - **#3へ持ち越したTODO**(index.tsに明記): (1)永続化config.jsonのロード(現状は`createDefaultConfig()`既定値で起動)、(2)競合フォールバックで解決したポートを`config.codeAdapter.serverPort`へ保存(dispatch.sh等が参照するため)
  - **onHookEvent未接続**: POST /hook受信→EmotionEngineマッピング(api.md 1.1)はCode Adapter(#9)で接続する。サーバーは認証+パース+コールバック呼び出しまで
  - ビルド出力確認: Renderer資産は`out/renderer/assets/`に配置され、`/panel`の相対参照`../assets/`はURL正規化で`/assets/`へ解決→静的配信で解決可能(reviewer実測)
- **完了 #3: config.json永続化(FR-10)** — `src/main/config-store.ts`新規実装(`ConfigStore`)。userData/config.jsonのロード/保存を担う。正本は`src/shared/config-schema.ts`(=docs/data.md 1章)、本モジュールはディスク↔検証済みAppConfigの入出力のみ。`src/main/index.ts`で#2の持ち越しTODO2件を接続(起動時`ConfigStore.load()`、解決ポートを`config.codeAdapter.serverPort`へ書き戻し)。GUI不要のオフスクリーン検証29ケース全通過。reviewerチェックループ2周(1周目4件→修正→2周目0件)で完了
  - **設計**: (1)ロードは`JSON.parse`→`migrate`→`Zod.parse`の順(欠けたフィールドはスキーマの`.prefault`/`.default`が補完)。(2)ファイル無し→既定値を書き出して起動。(3)破損(パース不能・検証不能・未知schemaVersion)→元ファイルを`config.json.corrupt-<ts>`へ退避し既定値で復旧+警告ログ(constraints.md「嘘をつかない」=黙ってフォールバックせず退避先を明示)。(4)書き込みはtmp+renameでアトミック。(5)パーミッション0600(real時`chatAdapter.anthropicApiKey`を保持しうるため。`.token`・logsと同格)
  - **マイグレーション枠**: `CURRENT_SCHEMA_VERSION=1`(schema側`z.literal(1)`と手動同期。コメント明記)。段階migration配列は現状空(v1が最初)。未来バージョン(version>CURRENT)は破損扱いで退避=古いアプリが新configを黙って上書きしデータを失わせない
  - **1周目で検出した実バグ(重大)**: `load()`の正規化書き戻し(persist)がparse/validateと同じtryブロック内にあり、**一過性のI/Oエラー(ENOSPC等)で書き戻しが失敗すると有効なconfigが「破損」誤判定→`.corrupt-*`退避+既定値リセットでAPIキー等が消失**する不具合。parse/validateだけをtryに閉じ込め、書き戻しはtry外の独立try(失敗してもログのみ・退避しない)へ分離して修正。回帰検証追加済み
  - **同(中)**: `update()`がpersist前に`this.config`を確定させており、persist失敗でメモリ/ディスクが乖離。`previous`退避→失敗時ロールバック+再throwで修正。回帰検証追加済み
  - **副次改善**: `tryChmod600`を`src/main/fs-permissions.ts`へ抽出し`config-store.ts`・`auth-token.ts`の重複を解消。`docs/data.md`のディレクトリツリーにconfig.jsonの0600注記を追記(実装判断を正本へ反映)
  - **スコープ外(意図的)**: onboarding完了フラグ(onboarding.md未決)・windowPositionのデバウンス保存(#4/character-window.md)は含めない。`ConfigStore.update()`は用途非依存の汎用APIとして提供
- **完了 #4: キャラクター表示ウィンドウ(FR-6)+ C3** — 透過・枠なし・最前面・クリックスルーのウィンドウ生成、位置解決/永続化、メニューバーアイコン(Tray)、Rendererのサーバー読込移行を実装。reviewerチェックループ2周(1周目3件→修正→2周目0件「問題なし」)で完了
  - **新規**: `src/main/window-position.ts`(位置解決の純粋関数・Electron非依存)、`src/main/character-window.ts`(BrowserWindow統合)、`src/main/tray-menu.ts`(メニューバー+右クリック共通ビルダー)、`src/shared/ipc.ts`(IPCチャンネル定義)、`src/renderer/character/src/useCharacterWindowControls.ts`(ドラッグ/右クリックのRenderer側)。**変更**: `index.ts`(配線)、`preload/index.ts`(character IPCブリッジ)、`character/src/App.tsx`(フック呼び出し)
  - **位置解決**(character-window.md 論点1・2): `screen`非依存の純粋関数に切り出し、DisplayEnvを引数注入。**doc の実測8ケース表をオフスクリーンで13/13再現**(逆算で実機2画面構成を再構成)。見失った時だけクランプ(MIN_VISIBLE=80)、初期配置はプライマリworkArea右下(マージン24)、windowPositionはドラッグ終了時500msデバウンス保存
  - **FR-6機構**(実測どおり): `transparent/frame:false/hasShadow:false/resizable:false/skipTaskbar`、`setAlwaysOnTop(true,'floating')`(`'normal'`は最前面無効なので不可)、`setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`、クリックスルーは`setIgnoreMouseEvents(true,{forward:true})`(既定ON)
  - **ウィンドウサイズ=案2決着の実装**: `resolveWindowSize`=アクティブモデルの`baseResolution × displaySize`。モデル未導入時は`FALLBACK_BASE_RESOLUTION`(400×400)。`resolveActiveModel`は暫定(manualActiveId一致→先頭→null。本格選択は#5)
  - **Tray/メニュー**(論点3): 鳥居シルエットの単色テンプレート画像(16+@2x)を**手続き生成→nativeImageで読込検証→base64埋め込み**(scaleFactors=[1,2]/isTemplate=true)。メニューバーと右クリックは`buildAppMenu`共通ビルダー(項目: Control Panel/モード2/クリックスルー/位置リセット/終了)。表示のたびに再構築しradio・checkboxを現在config値と同期。ドラッグは`-webkit-app-region:drag`不採用でmousedown→mousemove→IPC(`win.setPosition`)。IPCは送信元webContents検証で他ウィンドウを弾く
  - **C3**: キャラウィンドウはprod=`http://127.0.0.1:<実ポート>/character`、dev=`ELECTRON_RENDERER_URL`(Viteもsecure context)。`file://`回避=WebCodecs有効化(security.md 7章)。Control Panelもサーバー読込へ移行、ただしサーバー障害時は`loadFile`フォールバック(可用性NFR)。prodはサーバー必須のためcharacterウィンドウ生成はport確定時のみ
  - **reviewer指摘3件と対応**: (重大)ドラッグ競合=`beginDrag()`Promise解決前にmouseupすると離した後もdragging残存で暴走→`buttonDown`フラグで解決時に再確認。(中)character-window.md/constraints.md が案2を「未決着」のまま=正本を実装済みに更新、既知の非対称表からbaseResolution行削除。(軽微)フォーカス中Cmd+Wで復帰不能=`quitting`フラグ+`before-quit`で`close`をpreventDefault(`destroy()`は'close'非発火なのでdispose不阻害)、`clearSaveTimer`をdispose/handleClosed両方から呼ぶよう統一
  - **検証**: typecheck/build通過。Electronオフスクリーン スモーク18/18(透過のみElectron 43にランタイムgetter無しで未アサート=仕様)。位置ロジック13/13
  - **スコープ外(意図的・#5送り)**: キャラウィンドウ内の実描画(CharacterRenderer Live2D/spriteset)は未実装=現在プレースホルダーHTML。透過部分のアルファ判定(hitTest)・app.dock.hide()・MIN_VISIBLEチューニング・キャラ一時非表示メニューは将来検討(character-window.md TODOに明記)
- **完了 #5: CharacterRenderer(Live2D/スプライトセット両対応 FR-5)** — 描画抽象(mount/setState/destroy)+両実装+WS感情購読+manifestロードを実装。reviewerチェックループ2周(1周目3件→修正→2周目0件「問題なし」)で完了
  - **新規**: `src/shared/manifest.ts`(manifest.jsonのZodスキーマ+resolve helpers。両形式)、`src/shared/bootstrap.ts`(character HTML埋め込み契約)、`src/renderer/character/renderer/`(CharacterRenderer.ts=抽象+共通、SpriteSetRenderer.ts、Live2DRenderer.ts、cubism-runtime.ts、createRenderer.ts、emotionSocket.ts、bootstrap.ts、loadManifest.ts)、`src/renderer/character/src/useCharacterScene.ts`。**変更**: `App.tsx`(シーン描画+状態表示)、`local-server.ts`(/characterへbootstrap注入)、`index.ts`(getCharacterBootstrap配線)
  - **抽象**(basic-design 5.1): `CharacterRenderer`(mount/setState/destroy)+`createRenderer(manifest,ctx)`。EmotionEngineはsetState(key)を呼ぶだけで形式非依存。**createRendererはasync**(Live2Dはランタイム確認後に動的import。理由はbasic-design 5.1脚注に追記)
  - **manifest正本**(C-18): idle必須をZod superRefineで両形式強制。**z.record(enum,X)はzod v4で全キー必須になる罠→z.partialRecordに修正**(idle以外省略可、欠落→idleフォールバック)。両方null(panic例)もidleへフォールバック(model-mapping-ui.md論点2)
  - **SpriteSetRenderer**: 2レイヤーWebP crossfade。`/models/*`はヘッダ認証のため`<img>`直付け不可→**fetch(ヘッダ)→Blob→オブジェクトURL**でトークンをURLに載せず読む。取得キャッシュ+loadSeq競合防止+destroyでrevoke。loopは素材の再生方法(取り込み時に焼き込み)でRendererは制御しない=lipsync.md直交
  - **Live2DRenderer**: pixi-live2d-display v6。**Cubism外部ランタイム(window.Live2DCubismCore/Live2D)がnpmに無く未同梱→実描画は実行不能**。ランタイム検知は`cubism-runtime.ts`(pixiをimportしない)に分離しcreateRendererが確認後に動的import(import時例外を避ける)。持続中の再発火(lipsync.md要決着)は#5では未実装=setStateは1回発火のみ。motion/expressionの.catchは非致命ログ(SpriteSetの致命onErrorと正当な非対称・明記)
  - **bootstrap**: サーバーが/characterに`window.__APP_TOKEN__`+`window.__YORIMASHI_MODEL__`を注入(jsonForScriptで`</script>`・U+2028/2029エスケープ)。/panelにはアクティブモデルを注入しない。Rendererが読んでmanifest取得→createRenderer→mount→WS購読→setState
  - **検証**: typecheck/build通過(Live2DRendererは動的importで別チャンク分離=character本体はpixiをeagerロードしない)。オフスクリーン: manifest schema/resolve/factory/bootstrap/EmotionSocket(モックWS往復・再接続・close) 19/19、サーバーbootstrap注入+XSSエスケープ+/panel非注入+CSP維持 8/8
  - **スコープ外/未解決(実機・後続タスク)**: Live2D実描画・モーション駆動・アセットのヘッダ認証注入(pixiローダ)は**実機検証待ち**(推測でローダ差し替えを書かない)。実描画確認にはCubismランタイム同梱+モデル導入(#10オンボーディング/取り込み)が前提。spriteset生成パイプライン(sharp/WebCodecs)は取り込み側で#5対象外
- **コミット済み(develop直接・1コミット)**: #1〜#5をまとめて develop へ直接コミット(ユーザー指示「#5完了後に一括」)。以降は都度コミット方針に戻す想定
- **完了 #6: FR-15会話ペイン移植(mockup→実プロダクトコード)** — Control Panelレンダラーを2ペイン構成へ。会話ペイン(FR-15)を実装。reviewerチェックループ2周(1周目4件[重大0/中1/軽微3]→修正→2周目コード指摘0件)で完了。**実装フェーズのためreviewer修正もOpus 4.8継続**([[feedback_impl-phase-model-policy]])
  - **新規**: `src/renderer/control-panel/src/`配下に `theme.ts`(THEMES/ThemeProvider/useTheme。`moods`は`Record<MoodState>`でshared/emotions.tsと対称強制)、`catalog.ts`(TABS/SLASH_COMMANDS/AT_REFERENCES/RESPONSE_MODELS)、`types.ts`(AdapterMode/ChatMode/ChatMessage)、`ConversationPane.tsx`(憑坐状態帯+履歴+入力欄)、`ControlPanelTabs.tsx`(FR-7タブバー骨組み+プレースホルダ)。**変更**: `App.tsx`(2ペインのシェル)。**依存追加**: `lucide-react`(1.25.0。UI正が前提、権利タブにもISC記載。React19対応・使用28アイコン全存在を確認。criticalはpixi由来のgh-pagesのみで無追加)
  - **スコープ境界(#6=FR-15のみ)**: Control Panel(FR-7の6タブ)の**中身は各機能タスクで移植**(モード=#8/ログ=#11/権利=#13)。右ペインはタブバー骨組み+正直なプレースホルダに留め、**偽のモデル一覧・ログ・生成ウィザードを捏造しない**。根拠は本ファイル「次:#6=FR-15会話ペイン移植」+ タスク#8/#11/#13の存在。tab状態はApp保持=折りたたみでリセットされない(モックアップ準拠)
  - **意図的な差分(理由をコード冒頭docstringに明記)**: (1)モックアップの中央寄せ976px固定カード+幅アニメは**ブラウザpageデモの都合**→実アプリはレンダラーがBrowserWindowを占めるためviewport全体(100vw×100vh)、総幅はウィンドウ側(#7)が決める。(2)Google Fonts `@import`は**持ち込まない**(外部通信=プライバシー方針違反。ローカル同梱は既知未決C2)。font-family指定は残しフォールバック。(3)会話履歴の**初期シードを置かない**(C-22永続化しない)。(4)送信で**偽の応答本文を生成しない**(応答配線は#8)。(5)テーマ手動切替はFR-7設定タブ機能→#6範囲外、当面OS追従のみ
  - **C-23入力欄機能**: スラッシュ(/clear・/mock・/real・/code・/panel・/model)・@参照・添付(real時のみ)・応答モデル選択(real時のみ)・停止・コンテキスト表示(real時のみ・実測値は#12まで—表示)・入力ヒント。real専用コントロールはmock時disabled(「嘘をつかない」)
  - **後続タスクへTODO明記**: 送信→Main(Chat Adapter)→擬似streaming受信・release('thinking')全経路保証・案1(C-24)activeAdapter自動切替+明示=#8 / @参照文脈組立・添付ファイル読出・コンテキスト実測=#8・#12 / ウィンドウ実縮小(976⇄576px setBounds)・config.general.controlPanelCollapsed保存=#7
  - **対称性**: 会話ペインはLive2D/スプライトセット非依存(キャラ描画を持たずEmotionEngineへのtrigger/releaseのみ。chat-pane.md「形式による分岐について」)。形式依存の分岐をこの移植に持ち込んでいない(reviewer grep確認済み)
  - **検証**: typecheck/build通過(control-panel 41KB、lucideツリーシェイク済)。**#6固有のオフスクリーンSSR検証19件**(`renderToStaticMarkup`。#5の19件[manifest/EmotionSocket]とは別物): App例外なしレンダリング / 憑坐状態帯キャラ名・Moodラベル・空状態(シードなし)・入力ヒント・入力placeholder存在 / 偽会話履歴を持ち込まない / 6タブラベル全表示・タブ中身プレースホルダ / Google Fonts非取り込み / mock時[応答モデルチップdisabled・コンテキストメーター非表示] / real時[コンテキスト領域出現・偽42%非表示]
- **完了 #7: Control Panelウィンドウの折りたたみ実縮小(976⇄576px)** — chat-pane.md 論点1をMainへ実装し、**残っていた要決着2件を実測で決着**。reviewerチェックループ1周目4件(重大1/中1/軽微2)→修正
  - **新規**: `src/main/control-panel-window.ts`(`ControlPanelWindow`。幅定数・生成・折りたたみ・IPC・dispose)。**変更**: `index.ts`(旧createControlPanelWindow/loadControlPanel/openControlPanelを置換、`loadConfig()`をサーバー起動から分離)、`ipc.ts`(`ControlPanelSetCollapsed`+`CONTROL_PANEL_COLLAPSED_ARG`)、`preload/index.ts`(`controlPanel.initialCollapsed`/`setCollapsed`)、`App.tsx`(折りたたみをMain委譲)、`docs/detailed-design/chat-pane.md`
  - **決着1(アニメーション)**: **瞬時切替(`animate`省略)を採用**。`show:false`のオフスクリーンでは`animate:true`でも`getBounds()`が即目標値を返し(0〜3ms)**所要時間を実測できない**ため。設計の指示は「実測してから合わせるか瞬時で割り切るかを決める(推測で決めない)」であり、推測でモックの`0.25s`に合わせない
  - **決着2(resizable/minimumSize)**: **幅は固定(min=max)・高さは可変(下限480)**。`resizable:false`は採らない。守りたいのは「976/576の固定2値」という**幅**の前提(会話ペインflex:1 + Control Panel 400固定が崩れる)で、高さには同種の前提が無く、会話履歴を読む主画面で高さ固定は不便
  - **実測(Electron 43.1.1/macOS・オフスクリーン)**: (1)`resizable:false`でも`setBounds()`は効く(`isResizable()`はfalseのまま) (2)**min/maxSizeは`setBounds()`をクランプする**→幅ロックを**付け替えてから**setBoundsする順序が必須(逆だと黙って無視) (3)幅min=maxロックで高さのみ可変が成立 (4)`setMaximumSize`に`Number.MAX_SAFE_INTEGER`は渡せない(int変換失敗で例外)→`MAX_HEIGHT=100000`
  - **初期状態は起動引数で同期的に渡す**: `webPreferences.additionalArguments`の`--yorimashi-collapsed=`をpreloadが`process.argv`から読む(sandbox:trueでも読めることを実測)。IPC(非同期)だと**Mainが576pxで生成した窓に展開レイアウトが一瞬描かれる**ため。これによりget系IPCは廃止
  - **reviewer指摘と修正**: (重大)`loadFile()`に`URL.pathname`(パーセントエンコード済み)を渡していた→配布名「ヨリマシ.app」が非ASCIIで実在しないパスになり、**サーバー障害時の可用性フォールバックが最も必要な時に壊れる**→`join()`へ差し戻し / (中)Memory.md未更新 / (軽微)preloadコメントに`controlPanel.*`の送信元検証を明記 / (軽微)初期状態のIPC非同期→上記の起動引数方式へ
  - **対称性**: Control Panelウィンドウは形式非依存(幅はUIレイアウト由来で`baseResolution`を参照しない。参照するのはキャラウィンドウのみ)。理由をdocstringに明記。フックは`webPreferences`の`webP`で誤検知(grep確認済み)
  - **reviewer 2周目の指摘と修正**: (中)**展開時に右辺が+400px伸びて画面外へ出る**(macOSは画面外座標を補正しない=character-window.mdの実測と同じ土俵)→`clampXForWidth()`を追加し、はみ出す場合のみ左へ寄せる(収まるならユーザーの置いた位置を動かさない。折りたたみ方向は縮むだけなので不要) / (軽微)起動引数方式がchat-pane.mdに未反映→追記 / (軽微)`env.d.ts`が`yorimashi`を必須宣言する一方App.tsxは`?.`で防御=型と実装の前提が不一致→**`yorimashi?:`へ変更**(`/panel`・`/character`はブラウザからも開けpreloadが走らない=environments.md)。あわせて`useCharacterWindowControls`もpreload不在なら何もしないガードを追加(従来は例外になっていた)
  - **検証**: typecheck/build通過。オフスクリーン**37/37**(定数・生成幅・折りたたみ往復・x,y/高さ保持・config永続化・幅固定/高さ可変・次回起動時の生成幅・**はみ出しクランプ(サブディスプレイ含む)**・IPC送信元/型検証・dispose)、**実preload(ビルド成果物)の起動引数解析8/8**、起動引数がsandbox preloadへ届くことの実測1件
  - **チェックループ**: 4周(1周目4件[重大1/中1/軽微2]→2周目3件[中1/軽微2]→3周目2件[軽微・陳腐化docstring]→**4周目0件「問題なし」**)。**実装フェーズのためreviewer修正もOpus 4.8継続**([[feedback_impl-phase-model-policy]])
  - **追記(同日・ユーザー指示による仕様変更)**: (1)**幅も可変に変更**。「幅固定(min=max)・高さ可変」から「幅・高さともに可変、下限のみモード基準幅(展開976/折りたたみ576)」へ。会話ペインflex:1が広げた分を受け取るためControl Panelの400px列は崩れない。**折りたたみ切替は手動リサイズの有無に関わらず厳密に976/576へスナップ**(広げた幅は記憶しない。configは真偽値のみ保持)。`applyWidthLock()`→`applySizeConstraints()`に改名し、`setCollapsed()`はスナップ時のみ上限を一時的に絞り、スナップ後に開放する2段階の実装。(2)**ウィンドウタイトルを「ヨリマシ.app コントロールパネル」→「ヨリマシ.app」のみに変更**。`BrowserWindow.title`と`control-panel/index.html`の`<title>`の両方(Electronは読み込み後にdocument.titleで上書きするため両方必要)
  - **検証**: typecheck/build通過。オフスクリーン**43/43**(広げる/下限クランプ/スナップで記憶しないこと/タイトル、を追加)
  - **追記2(同日・ユーザー指示による下限引き下げ)**: 「会話ペインを、憑坐状態帯の『霊力状態 ── {Moodラベル}』が折り返さない幅+全角1.5文字ぶんまで縮められるようにしたい(設定画面は現状で固定)」という指示を受け、**実Chrome(claude-in-chrome)で実測**して決定。「霊力状態 ── 静穏(せいおん)」(3Mood中最大)=252.59px(`'Zen Antique', serif` 19px)、全角1文字=19px→1.5文字=28.5px。憑坐状態帯のレイアウト(padding36+border1+avatar60+gap14)を加算し `MIN_CONVERSATION_PANE_WIDTH=393px` を導出(392.09→切り上げ)。**折りたたみタブでの既定スナップ値(976/576)とは別に**、手動リサイズの下限として`minWindowWidthForCollapsed(collapsed)`(展開809px=393+16+400 / 折りたたみ409px=393+16)を新設。Control Panel(400px)は指示どおり不変。スナップは常に976/576へ厳密に戻る(手動で広げても記憶しない)仕様を維持
  - **計測手順の記録**: `Claude Browser`は`localhost`への遷移をポリシーでブロックするため、`claude-in-chrome`(実Chrome)で計測用HTMLをローカルHTTPサーバー越しに開き、`Range.getBoundingClientRect()`で実測(block要素の幅取得には`display:inline-block`または`Range`が必要。`div`のまま測ると親要素いっぱいの幅を返す落とし穴に一度ハマった)
  - **検証**: typecheck/build通過。オフスクリーン**49/49**(新定数393/809/409・809/409ちょうどまでの縮小・809/409未満のクランプ・スナップ後も976/576へ戻ることを追加)
  - **reviewer指摘と追加検証**: 「実測は`'Zen Antique', serif`で行ったが、本番はGoogle Fonts未同梱のためserifへフォールバックする(C2未解決)。実測条件と本番描画条件が一致する保証がドキュメントに無い」との指摘(中〜高)。**追加検証で解消**: 計測機に`Zen Antique`のフォントファイルが存在しないことを確認(`find /System/Library/Fonts /Library/Fonts ~/Library/Fonts`)した上で、`'Zen Antique', serif`と実在しないダミーフォント名`'Definitely-Not-Installed-XYZ', serif`の幅を比較したところ**完全に同一(252.59375px)**だった。これは実測が最初から`serif`フォールバックで行われていた証拠であり、本番の描画条件と一致することを確認できた(偶然ではなく実証)。control-panel-window.ts・chat-pane.md双方に根拠を追記
  - **end-to-end検証(追試で完了)**: 実preload + 実ウィンドウで `--yorimashi-collapsed=true→initialCollapsed=true` / `false→false` を実取得。**当初「環境にブロックされて完走できない」と報告したが、切り分けの結果それは誤りだった**
  - **【重要・検証環境の知見】`webPreferences.sandbox: true` のレンダラーはこの環境で起動できない**(ページロードが `ERR_FAILED`)。**Bashツールのサンドボックスは無関係**(有効/無効どちらでも同じ。有効時は `mach_port_rendezvous: Permission denied` が併記されるためそちらを原因と誤認しやすい)。`--no-sandbox` フラグも効かない(`webPreferences.sandbox:true` が個別に再有効化するため)。**検証ハーネス側で `sandbox: false` にすれば通る**(実証済み)。**本番コードは `sandbox: true` のまま変えない**(security.md 5章)。なお `sandbox:true` でも**preload自体は走る**(navigation前に実行されるため。probe実測でIPC送信が届いた)ので、sandbox環境固有の挙動は個別に確認できる。**実画面の目視確認は引き続きユーザー側で必要**
- **完了 #8: Chat Adapter(mock)(FR-3)** — 会話ペインからの送信をMainのChat Adapterへ実接続。**擬似streaming・thinking(sustain)→release・感情分類**が実際に動く
  - **新規**: `src/shared/emotion-classification.ts`(キーワード分類器。辞書・重み・否定スキャン・同点決着をemotion-classification.mdどおり)、`src/shared/chat.ts`(Main↔Renderer契約)、`src/main/chat-adapter/mock-responder.ts`(固定返答+擬似streaming)、`src/main/chat-adapter/chat-adapter.ts`(本体)。**変更**: `emotions.ts`(REACTION_PRIORITYを移設)、`emotion-engine.ts`(import化)、`ipc.ts`、`preload/index.ts`、`index.ts`(initCore化・配線)、`types.ts`、`ConversationPane.tsx`、`App.tsx`
  - **release('thinking')の全経路保証(最重要)**: `runStream()`をtry/catch/finallyで包み、**finallyでrelease+終端イベント送出**。成功(done)・中断(aborted)・エラー(error)・**送信先ウィンドウ消失**・dispose のすべてで固着しないことを実EmotionEngineで確認
  - **REACTION_PRIORITYを`shared/emotions.ts`へ移設**: EmotionEngineの調停と分類器の同点決着が同じ順序を使う必要があるため単一の情報源化(片方だけ書き換えると判断が食い違う)
  - **嘘をつかない設計の徹底**: (1)real選択時は**mockで代替せず**`not-implemented`エラーを返す(表情はpanicでなくworried=設定ミス相当。設計表に無い区分のため理由をコードに明記) (2)mock応答に`origin='mock'`バッジ+本文でも名乗る(Claudeの回答に見せない) (3)憑坐状態帯のMoodを`mood="idle"`固定からEmotionEngineのIPC追従へ変更(固定値は嘘) (4)mock時はコンテキスト使用量メーター自体を出さない
  - **モードの正本をconfig(Main)へ一本化**(reviewer指摘・中): Renderer側stateは写しにすぎず、`/mock`・`/real`・`/code`・「モックモードに切り替える」も必ずMainのconfigを更新→`ChatConfigChanged`で反映。**Trayからのactiveadapter切替にも会話ペインが追従**。これが無いと「UI上はmockなのに実際はrealへ送る」食い違いが起きる
  - **reviewer指摘6件すべて対応**: (中)モード非同期→上記 / (中)**エラー終端で部分受信済み吹き出しのstreamingフラグが解除されず▍が残る**(#12のreal接続で確実に顕在化)→解除+中断注記 / (低)モックアップ未反映→意図的差分として理由を明記 / (低)入力欄のmaxLength追加 / (低)再生成でユーザー発話が重複→`echoUser=false`を追加 / (低)多重送信のstale closure→`sendingRef`で同一ティックも遮断
  - **reviewer 2周目(4件・すべて低)も対応**: 型の二重定義(`AdapterMode`/`ChatMode`)→`ChatConfigSnapshot`からの導出に変更(「片方だけ直す」事故の予防) / retry・再生成が`sendingRef`でガードされていない→**送信口を`sendText`1箇所に統一しガードを集約** / 中断で空吹き出しが残る非対称→エラーと同じ後始末に揃え、1文字も受信していない中断は system で事実を残す / types.tsのdocstring陳腐化
  - **reviewer 3周目(2件)も対応**: (中)**`error`終端でも`aborted:true`を立てており、ユーザーが押していない停止を「(ここで中断しました)」と表示していた**(realの無通信タイムアウトで日常的に踏む)→`aborted:boolean`を`truncated:'stopped'|'error'`へ変え、原因別に「中断しました」/「応答が途切れました」を出し分け / (低)エラーの「再送する」ボタンに無効表示が無い→disabled+opacityを追加。あわせて**「startは必ず最初に届く」という不変条件をshared/chat.tsに明文化**(Renderer実装が依存しているため)
  - **自分で作り込んだバグを検出・修正**: 上記の空判定を`setChatMessages`のupdater内で行い直後に読んでいた。**updaterは同期実行されない**ため必ず初期値のままになり分岐を誤る → `streamingHasText` ref で同期的に持つよう修正
  - **検証**: typecheck/build通過。**分類器17/17**(設計の検証表11件を再現。既知NG「否定がスキャン窓の外」も設計どおりであることを含む)、**Chat Adapter 34/34**(実EmotionEngine/実ConfigStore使用。sustain→release→分類、中断、real=not-implementedでmock混入なし、入力バリデーション、多重送信拒否、C-24の自動切替と通知、dispose、送信先消失)、**会話ペインSSR 15/15**(空状態・Mood/アダプタ追従・real専用コントロール・捏造パーセント非表示)
  - **チェックループ**: 4周(1周目6件[中2/低4]→2周目4件[低]→3周目2件[中1/低1]→**4周目0件「問題なし」**)
  - **未実装(意図的・#12)**: real接続/APIキー導線/無通信ウォッチドッグ/@参照の文脈組立/添付/コンテキスト実測/Haiku分類
- **完了 #9: Code Adapter(hooks受信)(FR-2)** — 利用者側Claude Codeのhooksイベントを`POST /hook`で受け、EmotionEngineを駆動する。#2で用意した`onHookEvent`の接続先が埋まった
  - **新規**: `src/shared/hook-events.ts`(イベント名の単一の情報源+`resolveHookEventName`)、`src/main/code-adapter/code-adapter.ts`(本体)、`src/main/code-adapter/dispatch-script.ts`(配置用dispatch.shの正本)、`src/main/local-server/endpoint-file.ts`(`.port`書き出し)。**変更**: `emotion-engine.ts`(`onSessionStop()`追加・`applyMoodFromStreaks()`切り出し・#1のTODO解消)、`index.ts`(配線)、`local-server.ts`(`HookEventPayload`を共有型へ一本化)、`docs/api.md`・`docs/data.md`・`.claude/rules/environments.md`
  - **⚠️ 実測で自分の思い込みを訂正**: 「Claude Codeに`PostToolUseFailure`は存在しない(PostToolUseの`tool_response`で判定するはず)」と考え、正本(api.md/requirements.md)が誤っていると疑ったが、**Claude Code 2.1.205のバイナリを実測して実在を確認**した(`| PostToolUseFailure | Tool name | Run after tool fails |`・`executePostToolUseFailureHooks`)。同じ表で`PostToolUse`は「Run after **successful** tool」。**正本が正しく、私の記憶が誤りだった**。推測でドキュメントを「修正」しなくてよかった事例
  - **`Stop`のMood緩和を決定(#1からの持ち越しTODO)**: **両streakを切り捨て半減**(`onSessionStop()`)。0リセットだとMoodが実質「1ターン限りの状態」になり閾値ちょうどのconfident/tiredがターン終了で必ず消える。半減なら閾値ちょうど(3)は`3→1`でidleへ戻り、積み上げた確信(6)は`3`が残り維持=**強い傾きほど長く残る**。減算(-1)は「1回でどれだけ寄るか」がstreakの大きさに依らず鈍いため不採用。**Reactionには一切触れない**(正本の「Reactionには影響しない」)
  - **Code側のthinkingはsustainしない(Chat側との意図的な非対称)**: PreToolUseに対応する「終わり」はPostToolUse(Failure)だが、ツール中断・クラッシュでどちらも来ない経路があり、sustainだとthinkingが永久固着する。正本(api.md 1.1)も`trigger('thinking')`とだけ書きsustainを指定していない
  - **正本に無い判断を明記(黙って決めない)**: (1)`activeAdapter !== 'code'`の間は受信して204を返すが**適用しない**(Chat AdapterのsustainされたthinkingがPreToolUseに割り込まれる取り合いを防ぐ) (2)`watchedProjectPaths`の**空配列(既定)=絞り込み無し・全受理**(空を「全拒否」と読むと、hooksだけ手で設定した利用者にアプリが完全無反応になる) (3)判定は前方一致でなく**ディレクトリ境界での包含**(`/work/app`が`/work/app-backup`に一致しないように)。3点ともapi.md 1.1へ反映済み
  - **dispatch.shの決定(api.md 1.3へ反映)**: (1)**jqを必須にしない** — jqはmacOS標準ではなく、jq前提のままだと未導入環境で全イベントが黙って捨てられ「アプリが無反応」になる。素通しでも**Claude Code自身が`hook_event_name`を含める**ため、受信側が`hookEventName`/`hook_event_name`両方を解釈すれば成立する (2)**トークンをスクリプトに埋め込まない** — 埋め込むと利用者のプロジェクト(gitに入りうる場所)へ認証情報を書くことになる。実行時に`<userData>/.token`(0600)を読む (3)ポートは**`.port`(平文1行)**を`cat`で読む(競合フォールバック後の実ポートに追従。薄いスクリプトではconfig.jsonを解析できない) (4)スクリプトの正本は**TS内の文字列**(`dispatch-script.ts`)。ファイルにするとelectron-builderの同梱設定が要り「開発では動くが配布物に入っていない」事故になる
  - **自分で作り込んだバグを検出・修正**: データディレクトリの埋め込みが**二重引用符文脈**なのに、エスケープは**シングルクォート用**(`'\''`)を書いていた。パスに`$`や空白を含むと展開・分割される。`if [ -z ... ]; then VAR='...'; fi`のシングルクォート文脈に直して整合させた
  - **検証**: typecheck/build通過。**オフスクリーン53/53**(実EmotionEngine/実ConfigStore/実LocalServer使用)。イベント名解決、api.md 1.1の対応表全6種、thinkingが一過性で自然消滅すること、Stop半減(3→idle / 6→confident維持→idle)、StopがReactionを消さないこと、**UserPromptSubmitの短縮クールダウンが既定値なら抑制される時刻で受理されること(判別力のある検証に作り直した)**、ゲート2種(app-backup誤一致の否定を含む)、不正ペイロード・dispose後でも例外を投げないこと、`POST /hook`のE2E(401では感情が動かない)、そして**dispatch.shを実際にbashで実行**(exit 0・空stdin・アプリ未起動・サーバー停止中(<3s)・不正`.port`・空白と`'`を含むパス)
  - **チェックループ**: reviewer 1周目で0件。ただし1周目0件は疑い、生成される`dispatch.sh`の実物を目視確認した
  - **未実装(意図的)**: dispatch.shの**配置**とhooks設定の案内はオンボーディング(#10)、イベントログ記録は#11(`HookHandleResult`を返す形にしてあるので配線するだけ)
- **完了 #10: オンボーディング(FR-14)** — 初回起動時に Control Panel 全面へ4ステップ(ようこそ→モデル→モード→完了)のオーバーレイを出す。**別ウィンドウにしない**(完了時にホームタブへ遷移する決定=onboarding.md 論点4 が同一ウィンドウを前提にしている)
  - **新規**: `src/shared/onboarding.ts`(Main↔Renderer共有型)、`src/main/onboarding/onboarding-service.ts`(Main側)、`src/main/code-adapter/hooks-settings.ts`(settings.jsonテンプレート生成)、`src/renderer/control-panel/src/Onboarding.tsx`(画面)。**変更**: `config-schema.ts`(`onboarding`節)、`ipc.ts`・`preload/index.ts`・`main/index.ts`・`control-panel-window.ts`・`App.tsx`、`docs/api.md`・`docs/data.md`・`docs/basic-design.md`・`docs/detailed-design/onboarding.md`、**Notion基本設計書6.1**
  - **完了フラグの保存先を決定(onboarding.md の実装時TODO)**: **`config.onboarding.completed` / `completedAt` を新設**。状態から推測しないのは、モデル0体・hooks未設定・mockが**いずれも正当な完了状態**であり、未通過と区別できないため。`schemaVersion`は**1のまま**(既存configにこの節が無くても`.prefault({})`+`.default()`が補完する。節を削ったv1 configがそのまま読めることを実測で確認)。Notion → docs → 実装 の順で反映した
  - **アプリが書き込むのは`dispatch.sh`だけ**: `.claude/settings.json`は利用者の既存ファイルで既にhooksが入りうるため、**クリップボードへのコピー提示に留める**(正本の決定)。テンプレートは手書きせず`HOOK_EVENT_NAMES`から生成(`Record<HookEventName,…>`なのでイベントを増やすと型エラーになり、受信側だけ実装して案内に出し忘れる事故を防ぐ)
  - **書き込み先を利用者の明示選択に限定**: `installDispatchScript()`は**`watchedProjectPaths`に登録済みのパスにしか書かない**。同リストの入口はネイティブのディレクトリ選択ダイアログだけ。Rendererから任意パスを渡されても書き込まない(このリポジトリ自身の`.claude/`を含む)。既存の`dispatch.sh`の内容が異なる場合も`exists-differs`を返して**書き込まず**、上書きは明示的な再要求のみ(利用者が手を入れている可能性)
  - **完了画面は実測だけを根拠にする**: 「hooks設定済み」と言えるのは**dispatch.shの配置と`settings.json`の参照が両方確認できたときのみ**。`settings.json`が壊れて判定できないときは`probeError`で「確認できなかった」と示し、**`false`(未設定)と断定しない**。実行権の落ちた`dispatch.sh`も「配置済み」と言わない(Claude Codeが実行できないため)
  - **既存挙動の変更(理由を明記)**: モデル0体のときキャラクターウィンドウを**開かない**ようにした(onboarding.md 論点4)。正本はその理由を「開いても何も見えない」と書いているが、#5で「モデル未導入」の正直な表示が入ったため**現在は見えないのではなく、操作できない表示が出続ける**。理由は変わったが結論は同じなので正本に従った。完了時に`startCharacterWindow()`を呼び、モデルがあればそこで灯里が現れる
  - **正本との差分(明記)**: 完了演出の呪紋リングは、正本が指す「憑坐状態帯のリング」ではなく**完了画面自身に置いたリング**を回す。オンボーディングは全面オーバーレイで、その間は憑坐状態帯が見えないため。`keyframes`(`seal-spin`/`breathe`)は既存のものをそのまま使い、新規アセットは作っていない。メニューバーアイコンの図示も画像ではなく**インラインSVG**(配布物を増やさず配色テーマに追従する)
  - **起動引数で未完了を渡す**: `ONBOARDING_PENDING_ARG`。IPC(非同期)で読むと**Control Panelの中身が一瞬描かれてからオンボーディングが被さる**。折りたたみ状態(#7)と同じ理由・同じ手口
  - **検証**: typecheck/build通過。**オフスクリーン46/46**(実ConfigStore/実OnboardingService)。テンプレートの6イベント全数とmatcherの有無・commandパス、`onboarding`節を削ったv1 configが読めること、**未登録パスへは書き込まないこと(ファイルが作られないことまで確認)**、配置の冪等性、手を加えた既存ファイルを潰さないこと、probeの各分岐(未配置/settings無し/hooks無し/壊れたJSON/実行権なし)、完了フラグのディスク永続化、そして**配置された`dispatch.sh`をshebang+実行権だけで直接実行**(exit 0)
  - **⚠️ reviewer 1周目が実バグを検出(重大)**: 「スキップ」と「いま『モデル』タブを開く」が**完了画面を経由せずに即 `completed=true` を確定**していた。正本(論点1)は「**スキップは完了画面へ直行する**」と明記しており、完了画面の最重要の役割はメニューバーアイコンの告知(既定`clickThrough:true`の唯一の逃げ道)。この経路を通ると、**操作できないキャラクターと逃げ道を知らないユーザーが生まれ、オンボーディングは二度と出ない**。修正: `finish()`(=`complete()`を呼んで閉じる)の呼び出しを**完了画面の2つのボタンだけ**に限定し、他の経路は`setStep('done')`にした。モデルタブへの導線は正本どおり完了画面側に置く(モデルステップからは直行させない)
  - **reviewer が挙げたその他2件も修正**: (1)アダプタ選択が`snapshot`だけを見ており、`setConfig`が fire-and-forget かつこの画面は`onConfigChanged`未購読のため**押しても選択枠が動かなかった** → 楽観的stateを持たせ、configが追いついたら正本へ収束させる (2)クリップボードコピーが`getSnapshot()`経由で監視対象すべてに同期I/Oのプローブを走らせていた → `getSettingsSnippet()`を分離
  - **チェックループ**: 2周(1周目4件[重大1/中1/軽微1/情報1] → 修正 → **2周目コード面0件**)。1周目の修正直後にセッション利用枠へ到達して2周目を起動できず、一度 Memory.md に「未完了」と記録して中断したうえで、次セッション冒頭に2周目を実行して閉じた
    - 2周目の唯一の指摘は Memory.md の記述矛盾(「#10は未完了」と書きながら直後に「次: #11」と書いていた)。この記述自体を修正して解消した
  - **未実装(意図的)**: モデル管理タブ本体(#未定)へ送るところまでがこの画面の役割。real接続の案内は#12、権利表示は#13
- **完了 #11: ログ管理(FR-11)** — 受信したhooksイベントを`userData/logs/hook-events.jsonl`(0600)へ追記し、`retentionDays`(既定7日)超過分を自動削除。ログタブから仮名化エクスポート・消去ができる
  - **新規**: `src/shared/hook-log.ts`(共有型)、`src/main/logging/hook-event-log.ts`(記録・保持・仮名化・消去。**Electron非依存**)、`src/main/logging/log-actions.ts`(保存/確認ダイアログ。Electron依存はここだけ)、`src/renderer/control-panel/src/panel-ui.tsx`(Section/Row/全幅ボタン。**他タブで複製されないよう最初のタブ移植時に切り出した**)、`src/renderer/control-panel/src/LogsTab.tsx`。**変更**: `ipc.ts`・`preload/index.ts`・`main/index.ts`・`ControlPanelTabs.tsx`・`code-adapter.ts`・`docs/data.md` 4章
  - **記録対象を決定(正本に明記が無いため決めて書き足した)**: `applied` と `ignored-inactive-adapter` のみ。後者を残すのは、ログが「灯里の反応の記録」ではなく**利用者の作業の記録**だから。`ignored-unwatched-path` は**記録しない**(利用者自身が除外したプロジェクトのフルパスを7日残すのは除外意図に反する)。`ignored-unknown-event` はイベント名が閉じたunionに無いため記録しない
  - **`exit_code`は実測に基づき「無ければ付けない」**: Claude Code 2.1.205 のhooksドキュメントが示す stdin JSON は`session_id`/`tool_name`/`tool_input`/`tool_response`のみで、**`exit_code`は定義されていない**(バイナリ内ヘルプを実測)。成否の判定は`PostToolUseFailure`というイベント名そのものが担う。`filePath`は`tool_input.file_path`優先→無ければ`cwd`(同ドキュメントの例と、本リポジトリの開発用hookが同じ位置を読んでいることで確認)
  - **仮名化の規則**: `watchedProjectPaths`を既知ルートとして`project-a`/`project-b`…へ置換(長いパスから照合するので入れ子は深い方が勝つ)。どのルートにも属さないパスは`project-unknown/<ファイル名>`にしディレクトリを全部落とす。**プロジェクトの境界を知らないので推測で分類しない**(別プロジェクトが同じ仮名に潰れるのは欠落であって漏洩ではない)。生ログは非マスクのまま(要件4.11)
  - **正本(モックアップ)との意図的な差分**: モックアップは全行に「成功/失敗」の2値バッジを出すが、そのまま実装すると嘘になる(`Notification`/`Stop`に成否は無く、モックアップは Notification を「成功」と描いている。`PreToolUse`はまだ成否未定)。**バッジの形・位置・配色はモックアップのまま**、文言と色をイベントごとに正しくした(成功=mint/失敗=朱/その他=中間色)。理由は`LogsTab.tsx`冒頭に明記
  - **⚠️ reviewer 1周目が実バグを検出**: `CodeAdapter.handle()`が`activeAdapter !== 'code'`を監視パス判定より**先に**returnしていたため、`activeAdapter`が`chat`(**既定値**)の間は`watchedProjectPaths`の判定に到達せず、**利用者が除外したプロジェクトのフルパスがログに残っていた**。上記の記録対象の判断が前提を失っていた。修正: 監視パス判定を先に移し、順序が意味を持つ理由を`code-adapter.ts`・`hook-event-log.ts`・`docs/data.md`の3箇所に明記。感情駆動(FR-1/FR-4)の挙動は不変(どちらの順でも適用しないため)
  - **検証**: typecheck通過。**オフスクリーン55/55**(実ConfigStore/実HookEventLog/実CodeAdapter)。記録対象の取捨、フィールド抽出(file_path優先・cwdフォールバック・exit_code有無)、0600/0700、保持期間の削除と**消す行が無ければ書き換えないこと**、日付を解釈できない行を残すこと、上限200件、仮名化(入れ子ルート・未知パス・生ログ非改変)、`hookEventLogPath`がuserData外を指す場合のフォールバックと**外側にファイルを作らないこと**、消去、書き込み不能でも例外を投げないこと、そして**追記58µs/件**(同期`appendFileSync`で十分という判断の根拠)
  - **チェックループ**: 2周(1周目1件[重大] → 修正 → 2周目0件)
  - **未実装(意図的)**: 会話ペインの`@作業ログ`参照(C-23)はこのログを読むが、@参照自体は会話ペイン側の機能で別タスク
- **完了 #12: Chat Adapter real化 + APIキー導線(FR-3)** — real接続(`@anthropic-ai/sdk` 0.112.3)・会話履歴のMain保持・モード設定タブ(AdapterTabのChat Adapterセクション)・コンテキスト使用量の実測表示を実装
  - **新規**: `src/main/chat-adapter/real-responder.ts`(**Electron非依存**。無通信ウォッチドッグ・エラー分類・`net.isOnline()`は関数注入)、`src/renderer/control-panel/src/AdapterTab.tsx`(モード設定タブ)。**変更**: `chat-adapter.ts`(real分岐・会話履歴・reset・設定IPC)、`shared/chat.ts`(`ChatUsage`/`ChatTurn`/`ChatSettingsSnapshot`/`ChatSettingsPatch`)、`shared/ipc.ts`(`ChatReset`/`ChatSettingsGet`/`ChatSettingsSet`)、`preload/index.ts`、`main/index.ts`(`isOnline`注入)、`ConversationPane.tsx`・`App.tsx`(応答モデルのconfig同期)、`panel-ui.tsx`(Switch/TextInput追加)、`catalog.ts`(APIキー取得手順)、`ControlPanelTabs.tsx`、`package.json`
  - **無通信ウォッチドッグが最重要**(chat-adapter-errors.md 論点3): SDKの`timeout`は凍ったstreamに効かないため`AbortSignal`による自前ウォッチドッグを実装。実測(実SDK+実HTTP+実SSE)でしきい値2秒に対し凍ったstreamは2012msで中断、遅いが生きているstream(合計4015ms)は完走することを確認(壁時計方式ではないことの実証)
  - **会話履歴の正本をMainへ**: realは文脈を渡さないと毎ターン記憶喪失になるため、`ChatAdapter`がメモリ上に`turns`を保持(C-22どおり永続化しない)。Rendererには送らせない(表示専用行をAPIへ送らない・画面とAPI送信内容の経路を分けない)
  - **APIキーはMainのみ**(security.md 5章): モード設定タブへ返すのは`hasApiKey`と末尾4文字のみ。キー本体を編集はできず、入れ替えるか消すかのみ
  - **正本に無い判断を明記**: システムプロンプトを付けない(要件が灯里のロールプレイを要求していない)・`max_tokens`はコード内定数4096(configスキーマを汚さない)・コンテキスト表示はパーセンテージを出さず実トークン数のみ(分母=モデルのコンテキストウィンドウ長がAPI応答に含まれず、ハードコードは実測に見える推測値になるため)
  - **チェックループ4周**(1周目7件[重大2/中2/軽微3]→2周目3件[中〜重大1/軽微2]→3周目1件[軽微]→**4周目0件**)。主な指摘: 応答モデル選択がconfigと非同期だった、`/clear`と進行中streamの競合でMessages APIの先頭user要求に反する履歴になりうるバグ(`turnsAtStart`参照比較で解消・回帰検証追加)、モード設定タブが会話ペイン側の変更を購読しておらず表示が古くなる(`onConfigChanged`購読を追加)
  - **検証**: typecheck/build通過。オフスクリーン: real-responder 38件(実SDK 0.112.3+実HTTP+実SSE)、chat-adapter 37件(実EmotionEngine/実ConfigStore、reset競合の回帰含む)、AdapterTab SSR 4件
  - **未実装(意図的)**: @参照の文脈組立・添付(real)は次タスクへ。Code Adapterセクション(監視対象パス等)の編集はモード設定タブの別タスクへ
- **完了 #13: モード設定タブ Code Adapterセクション(FR-7/FR-2)** — 監視対象パス・ポート番号・連続失敗しきい値の表示/編集を実装。モデル管理タブは規模が大きく基盤未実装のため**別トラックに分解**(下記)、今回はCode Adapterセクションのみ着手(ユーザー選択「Code Adapter先行 + モデルは分解」)
  - **新規**: `src/shared/code-settings.ts`(共有型`CodeSettingsSnapshot`/`CodeSettingsPatch`・検証`isValidPort`/`isValidFailStreak`・範囲定数)、`src/main/code-adapter/code-settings.ts`(`CodeAdapterSettings`サービス + `parseCodeSettingsPatch`。**Electron非依存**=ダイアログ・実ポート取得は関数注入)。**変更**: `emotion-engine.ts`(`updateConfig()`追加)、`ipc.ts`(`CodeSettingsGet/Set/ChooseProject/RemoveProject`)、`preload/index.ts`(`codeAdapter`名前空間)、`main/index.ts`(`registerCodeSettingsIpc()`+will-quit片付け)、`AdapterTab.tsx`(Code Adapterセクション実装。既存Chat部分は`ChatAdapterSection`へ分離し**独立読み込み**化)
  - **watchedProjectPathsの入口を限定(不変条件)**: onboarding-service.ts「このダイアログだけが watchedProjectPaths の入口」= dispatch.shの書き込み先を利用者の明示選択に限定する根拠。**Rendererから任意パス配列を書かせない**。追加は`CodeSettingsChooseProject`(onboarding.chooseProjectへ委譲)経由のみ、`CodeSettingsPatch`/`parseCodeSettingsPatch`はport/threshold限定、削除は監視範囲を狭めるだけで安全なので特定パス指定で許可
  - **反映タイミングを正直に扱う(嘘をつかない)**: (1)ポートは起動時バインドのため変更は**再起動後に反映**。UIは実ポート(`actualPort`)を併記し「再起動後に反映」と明示。(2)`failStreakThreshold`は**EmotionEngineが構築時スナップショットを握る**ため、`configStore.update()`(新オブジェクトを作る)だけでは伝播しない → `EmotionEngine.updateConfig()`を新設しlive更新で即時反映(idleTimeoutMs変更時のみ無操作タイマー張り直し)
  - **検証はMain境界**: `config-schema.ts`はserverPort/failStreakThresholdに範囲を持たないため`CodeAdapterSettings`/`parseCodeSettingsPatch`で範囲外を弾き例外(config未更新)。スキーマ側へ範囲を足すとdata.md/basic-design.md同期が必要でスコープ外
  - **モックアップ差分(明記)**: モック(L1183-1193)は監視対象パスを単一Row+ChevronRightの静的表示だが、`watchedProjectPaths`は配列(空=絞り込みなし)なので**リスト+追加/削除UIへ拡張**(理由をAdapterTab.tsxにコメント明記)
  - **検証**: typecheck/build通過。**オフスクリーン20件**(validators境界・parseがwatchedProjectPathsを落とすこと・getSnapshotの配列コピー・updateSettings valid/invalid・threshold live反映(engine挙動で確認)・removeProject resolve一致・chooseProject委譲・updateConfigのidle再武装/dispose後throw)。AdapterTab SSRスモーク(初期ローディング・非クラッシュ)
  - **チェックループ**: 2周(1周目軽微2件[モック拡張の理由コメント欠落・commit時の入力欄正規化非対称]→修正→**2周目0件**)
- **モデル管理タブ(FR-5)を別トラックへ分解(2026-07-21・ユーザー承認)**: モックアップ(805-1179行)の裏にある基盤がほぼ未実装で規模が桁違い。**Main側インフラを先に作らないとUIだけ置いても動かない**:
  - 必要な基盤: モデル一覧/削除/自動切替のIPC(`config.model.slots`はあるが専用IPCなし)、取り込みパイプライン(Live2D=Cubism2/4列挙+自動マッピング / spriteset=画像→AI生成→mp4取込→色キー抜き→WebP変換=spriteset-pipeline.md丸ごと)、感情↔モーション編集UI、Control Panel内プレビュー枠(`CharacterRenderer` mount)
  - 進め方(推奨): まずMain側インフラ(スロット一覧/削除/自動切替IPC)→取り込みパイプライン→マッピング編集、の順。新規ファイルが多い工程はOpus 4.8で着手。model-mapping-ui.md / spriteset-pipeline.md が正本
- **完了 権利情報タブ(FR-12)** — Live2D利用区分/外部AIサービス注意/OSSライセンス一覧/フォント/持ち込みモデル/Anthropic APIの6区分を表示
  - **新規**: `scripts/generate-oss-licenses.mjs`(OSS一覧のビルド時自動生成)、`src/shared/oss-licenses.ts`(**自動生成物・コミット対象・手編集禁止**)、`src/shared/rights.ts`(`RightsSnapshot`)、`src/renderer/control-panel/src/RightsTab.tsx`。**変更**: `package.json`(`generate:licenses`/`predev`/`prebuild`)、`ipc.ts`(`RightsGet`)、`preload/index.ts`(`rights.get`)、`main/index.ts`(`registerRightsIpc`+will-quit片付け)、`ControlPanelTabs.tsx`、`docs/detailed-design/model-mapping-ui.md`(不整合3へ追記)
  - **OSS一覧は実際にビルド時自動生成**(要件4.12/9章)。`dependencies`を**推移的にBFS走査**+`electron`を葉として1件(そのnpm依存=インストール時ツールは辿らない)。ビルドツール(vite/typescript等devDeps)は配布物でないため除外。手書きにせず`sharp`等は導入時に自動反映。**スコープ外**=同梱Electronランタイム自身の第三者ライセンス(Chromium/Node)とネイティブlibvips(package.jsonを持たず走査不可)は配布NOTICE段階で対応(generate-oss-licenses.mjs・model-mapping-ui.md不整合3に明記)
  - **gh-pagesを除外**(reviewer 2周目指摘): `pixi-live2d-display`が誤って`dependencies`に含む`gh-pages`は、environments.md「distバンドルには痕跡がなくランタイムには使われない」と確定済み。除外ルートにし、そこ経由でしか到達しない依存(計42件)を落とす(他経路でも到達する`object-assign`等は保持)。121→**79件**
  - **嘘をつかないための意図的逸脱(モックアップから)**: (1)Live2D利用区分は`config.distribution.live2dCommercialLicense`を`RightsGet` IPCで反映(ハードコードで断定しない。読めない経路は「確認できません」)。(2)**外部AIサービスの「現在の利用区分: 個人利用(無償枠)」バッジは削除**(アプリは利用者がPika/Canva等をどの料金枠で使ったか知り得ないため断定しない。注意喚起に置換)。理由をRightsTab.tsx冒頭に明記
  - **対称性(正当な非対称)**: Live2D利用区分はLive2D形式のみ、外部AIはスプライトセット生成のみに関係(要件9章)。**両形式ぶんのセクションを対で用意**しているため対称は保たれる。symmetry-reminderフックが実装中に何度も反応したが、いずれもこの正当な非対称/パッケージ名の「live2d」文字列への誤検知
  - **検証**: typecheck/build(prebuildで生成実行)通過。オフスクリーン: 生成スクリプト8件(推移走査・electron葉扱い・インストール時ツール除外・重複なし・スコープ注記)+gh-pages除外4件、RightsTab SSR 15件(6セクション・OSS実体描画・利用区分の断定回避・外部AI誤ステータス不在)
  - **チェックループ**: 3周(1周目3件[高:推移的依存の未走査/低:libvips注記・モックにないsub]→2周目1件[中:gh-pages依存43件混入]→**3周目0件**)
- **完了 モデル管理タブ 第1段階: スロット管理(FR-5/FR-7)** — 一覧・削除・アクティブ選択・モードによる自動切替。**取り込みとマッピング編集は第2/第3段階**(UI上は正直なプレースホルダ)
  - **新規**: `src/shared/model-manage.ts`(共有型+`MAX_MODEL_SLOTS`)、`src/main/model/active-model.ts`(`resolveActiveModel`。**Electron非依存**)、`src/main/model/model-service.ts`(`ModelService`。Electron非依存)、`src/renderer/control-panel/src/ModelTab.tsx`。**変更**: `character-window.ts`(`applyActiveModel`/`close`/`appliedModelId`追加、resolveActiveModelを移動+再export)、`config-schema.ts`(`.max(MAX_MODEL_SLOTS)`)、`ipc.ts`(Model* 5チャンネル)、`preload/index.ts`、`main/index.ts`、`ControlPanelTabs.tsx`
  - **⚠️ 既存の欠落を修正(今回の中核)**: `resolveActiveModel`が`manualActiveId`しか見ておらず**`autoSwitchByMode`/`assignedAdapter`を無視していた**。UIだけ作ると「自動切替をONにしても切り替わらない」嘘になるため実装。解決順は 0体→null / 1体→常にそれ / 2体+autoSwitch→`assignedAdapter===activeAdapter` / それ以外→manualActiveId→先頭(モックアップL809-811と一致)
  - **実ウィンドウへの反映**: `applyActiveModel()`が解決結果の変化時のみ`setSize`+`loadURL`(bootstrapはHTML埋め込みなので再読込が要る)。0体になれば閉じ、モデルが戻れば開き直す。**`broadcastChatConfig()`に`syncCharacterModel()`を入れて Tray/会話ペイン/C-24自動切替のすべてのアダプタ変更を拾う**(autoSwitch ON時はアダプタ変更だけで描画モデルが変わるため)
  - **削除の安全性**: `resolveWithinBase(modelsRoot, installedDir)`を通してから`fs.rmSync`。models配下外なら消さない。**消せなかった場合は`snapshot.warning`でUIに申告**(Mainのconsoleだけだと利用者には「消えた」ようにしか見えない)
  - **⚠️ reviewer 2周目が実測でバンドル肥大化を検出**: `MAX_MODEL_SLOTS`の単一情報源化を`config-schema.ts`側に置いて`model-manage.ts`から値re-exportしたところ、**Rendererが定数1つのためにZodスキーマ一式(schemas chunk 698.83kB)を取り込んでいた**(control-panel/index.htmlがmodulepreloadしていた)。依存の向きを逆にして解消(定数はzod非依存の`model-manage.ts`に置き、config-schemaがimportする)。両ファイルに理由を明記
  - **検証**: typecheck/build通過。**バンドル実測**(schemasチャンク消失・control-panel 148.55→143.83kB)。オフスクリーン28件(resolveActiveModel 9件[0/1/2体・autoSwitch両モード・フォールバック]、ModelService 13件[**models外を指すinstalledDirで外部ファイルを消さないこと**含む]、parseModelId 2件、修正確認4件[warning/autoSwitch解除])。ModelTab SSR 3件。active-model/model-serviceのバンドルでelectron参照0件
  - **チェックループ**: 3周(1周目6件[中2:再オープン経路の破綻・削除失敗が伝わらない / 低2 / 軽微2]→2周目1件[高:上記バンドル肥大化]→**3周目0件**)
  - **次段階(未着手)**: 第2段階=取り込みパイプライン(Live2D=Cubism2/4列挙+自動マッピング / spriteset=spriteset-pipeline.md)、第3段階=感情↔モーション編集UI+プレビュー枠。**取り込みが入るまで実機ではスロットが増えないため、モデルタブは通常「空きスロット」表示になる**
- **完了 モデル管理タブ 第2段階a: Live2D取り込み(FR-5)** — フォルダ選択→Cubism2/4列挙→自動マッピング→複製→スロット登録。第2段階b(スプライトセット生成)は別タスク(ユーザー選択で2a先行)
  - **新規**: `src/main/model/live2d-import.ts`(列挙`enumerateLive2d`・自動マッピング`autoMapLive2d`/`SYNONYMS`/`normalizeName`/`scoreCandidate`・manifest生成・パス検証`assertPathsWithin`。**Electron非依存**)、`src/main/model/model-importer.ts`(`ModelImporter`。ダイアログ→複製→config登録。**Electron非依存**でダイアログ注入)。**変更**: `ipc.ts`(`ModelImportLive2d`)、`preload/index.ts`(`models.importLive2d`)、`main/index.ts`(handler+`chooseModelFolder`+will-quit)、`ModelTab.tsx`(モデルの追加セクションにLive2D取り込みボタン+importing状態)
  - **自動マッピングは正本(model-mapping-ui.md 論点4)を厳密に実装**: normalize+SYNONYMS+score(完全一致1000/同義語長)+同点先勝ち+スコア0未割当。**docの実測結果表(exp_smile_soft→confident / exp_smile→happy 等)と全10状態一致をオフスクリーンで確認**(オラクル検証)
  - **パス検証(A2セキュリティ)**: レンダリング必須アセット(moc/textures/physics/pose/expressions/motions)のフォルダ外逸脱を`resolveWithinBase`で拒否。**Sound/DisplayInfo/UserDataは検証対象外**(v1で使わず、公式Haruが正当に`../shizuku/sounds/`を参照するため。逸脱Soundはsrc外なので複製されず実行時warn)。理由をコード冒頭に明記
  - **⚠️ 発見した設計上の齟齬(実測)**: character-window.md案2(確定・実装済み)は「Live2DのbaseResolutionを取り込み時にmodel3.jsonから読む」としていたが、**model3.jsonにキャンバス寸法が無く、moc3から読むにはCubism Coreが要る**ことが判明(推測でmoc3オフセット決め打ちしない)。当面`LIVE2D_IMPORT_FALLBACK_BASE_RESOLUTION`(400×400)を入れ、**正本3箇所(config-schema.ts/data.md/character-window.md)を訂正**。案2の結論(baseResolution形式共通・必須)は維持、Live2Dで正確なサイズをどう得るか(Cubism Core導入 or Renderer実測後の書き戻し)は**未決**。basic-design 6.1は「形式共通・必須」のみで取得方法は述べないため変更不要
  - **idle必須(C-18)**: `autoMapLive2d`がidleを必ずemotionMapに含める。idleモーション欠落時は`idleMotionMissing`警告をUIへ返す(取り込み自体は通す)。生成manifestは`ManifestSchema.parse`で検証してから書き出す
  - **検証**: typecheck/build通過。electron参照0件(live2d-import/model-importer両方)。オフスクリーン20件(コア9=normalize/自動マッピングがdoc実測表と全10状態一致/実モデル列挙Haru・Shizuku/manifest生成、オーケストレーション8=フルインポート複製+manifest+スロット/cubism2/上限チェックでコピー前拒否/**逸脱モデル拒否・Haruは通す**/キャンセル/snapshot、ModelTab SSR 3)
  - **チェックループ**: 2周(1周目7件[高1:正本齟齬(baseResolution前提の訂正)/中3:陳腐化コメント・同一タブ内メッセージ矛盾/低3:TODOチェック漏れ・冗長条件・定数二重化]→2周目0件)
  - **未実装(意図的)**: zip取り込み・スプライトセット生成(第2段階b)・感情↔モーション編集UI+プレビュー枠(第3段階)。**取り込みが1形式入ったので実機ではLive2Dフォルダを選べばモデルが増える**
- **完了 モデル管理タブ 第2段階b-1: スプライトセット生成のMain側コア(FR-5)** — spriteset-pipeline.md 手順2/手順4中段・後段のコア。ユーザー選択で「Main側の生成コアを先行」(RendererのWebCodecs+取り込みUIはb-2に分離)
  - **重要な訂正(引き継ぎメモが古かった)**: 前回まで「ローカルサーバー未実装」と記録していたが、**実際には`src/main/local-server/local-server.ts`が実装済み**で、character-windowはprodで`http://127.0.0.1:<port>/character`(secure context)から読む。よって**WebCodecsの前提(secure context)は満たされており、b-2はブロックされていない**
  - **新規(すべてElectron非依存・0件確認)**: `src/shared/spriteset/color-key.ts`(境界連結フラッドフィル`keyOutBackground`+1px膨張。**内部の緑の島を保護**。純粋関数でRendererがImageData上で使う)、`src/shared/spriteset/video-codec.ts`(`classifyVideoCodec`。実測表に基づくH.265弾きの事前フィルタ。最終判断は実行時の`VideoDecoder.isConfigSupported`=b-2)、`src/main/model/spriteset-encode.ts`(`compositeOnChromaGreen`=手順2 sharp合成/`encodeAnimatedWebp`=手順4後段 sharp join。loop:false→sharp loop:1)、`src/main/model/spriteset-importer.ts`(`SpritesetImporter`。キー抜き済みフレーム→感情ごとエンコード→`<emotion>.webp`書き出し→manifest生成・検証→スロット登録。`CLIP_DEFAULTS`はdata.md 2.2のloop/returnTo表)
  - **sharp導入(0.35.3/libvips 8.18.3)**: 実測でN-APIプリビルド=Electron再ビルド不要を再確認。**Rendererへ漏れない**(`require("sharp")`/`libvips-cpp`=0件。RightsTabに出る`@img/sharp`はライセンス名の文字列データ)。Main側は**まだindex.tsへ未接続=未バンドル**(IPC配線はb-2。正当)
  - **FR-12ライセンス自動収集を修正(実測に基づく訂正)**: `scripts/generate-oss-licenses.mjs`が**インストール済み`optionalDependencies`も辿る**ようにした。旧コメントは「libvipsはnpm package.jsonを持たず拾えない」としていたが誤りで、**`@img/sharp-libvips-darwin-arm64`はpackage.jsonでLGPL-3.0-or-laterを宣言**している。79→85件(sharp/@img/sharp-darwin-arm64=Apache-2.0/@img/sharp-libvips-darwin-arm64=**LGPL-3.0-or-later**/@img/colour/detect-libc/semver)。未インストールの他プラットフォームバイナリは自動的に落ちる。libvips**本体**のソース開示/全文表示は配布NOTICE段階
  - **検証**: typecheck/build通過、electron参照0件×4モジュール。**オフスクリーン39件**(color-key 7=背景抜き/被写体保護/内部の緑島保護/1px膨張/短配列例外、codec 8、composite 2、encode 6=pages/loop/delay/アルファ保持/例外、importer 16=書き出し/baseResolution/loop&returnTo表/cubismVersion非付与/idle必須例外/寸法不一致例外/上限例外/生成webpがアニメーションWebP)
  - **正当な非対称(明記済み)**: 生成パイプラインはスプライトセット専用でLive2Dに対応物なし(Live2Dは完成モデルをフォルダ取り込み=model-importer.ts)。上限チェック・スロット登録・manifest検証の**形式共通部は両importerで対称**(grep確認)。symmetry-reminderは実装中何度も反応したがいずれもこの正当な非対称
  - **未実装(b-2で残す)**: WebCodecsデコード(手順4前段)・ImageDataへのkeyOutBackground適用+可逆圧縮IPC転送・静止画→background_key.png導線・動画取り込みUI+`importSpriteset`へのIPC配線・preload公開・ModelTab「準備中」置き換え。**asarUnpack**は配布フェーズ(electron-builder設定自体が未整備)、閾値/膨張量のチューニングは実素材で残タスク
- **完了 モデル管理タブ 第2段階b-2: スプライトセット生成のRenderer/UI(FR-5)** — 下絵→background_key.png→感情ごとに動画取り込み(デコード+色キー抜き)→登録までが通した状態で動く
  - **⚠️ 実測で正本(spriteset-pipeline.md 論点3)の3点を訂正**(いずれもElectron 43.1.1/macOS arm64のオフスクリーン実測。結論「Chromium内蔵コーデックで賄いffmpegを同梱しない」は維持):
    1. **`VideoDecoder`(WebCodecs)は単体では使えない**。コンテナのデムックスをしないため生ファイルを渡すと `An EncodedVideoChunk was marked as type 'key' but wasn't a key frame`。→ **`HTMLVideoElement` + シーク方式**(`currentTime`→`seeked`を待ち1枚ずつ)を採用。実測で6点サンプルすべて要求時刻どおり。再生+rVFCでも取れるが**PNG化が非同期でcanvas使い回しが競合**するため不採用
    2. **H.265は「非対応」ではなかった**(`isConfigSupported`/`canPlayType`とも対応。Apple SiliconのHEVCハードデコードをChromiumが露出)。→ **コーデック名のハードコード拒否リストを撤去**(実際に再生できるものを拒否=嘘をつくことになる)。判定は実地の読み込み結果のみ
    3. **canvasのWebPは`quality:1`でも可逆ではない**(往復で画素が変化)。**PNGは往復でアルファ厳密一致**。→ IPCへ渡すフレーム形式は**PNG**
  - **新規**: `shared/spriteset/clip-prompts.ts`(全10感情のラベル+外部AI用プロンプト。**モックアップ正本の写し**)、`shared/spriteset/import-payload.ts`(Renderer→Mainの契約+`BackgroundKeyResult`。preloadがmain/を参照しないようshared配置)、`main/model/background-key.ts`(下絵選択→合成→保存。**ダイアログ注入でElectron非依存**)、`renderer/control-panel/src/spriteset/decode-video.ts`(シーク方式デコード+`keyOutBackground`+PNG化)、`renderer/.../spriteset/SpritesetAddFlow.tsx`(3段フローUI)
  - **変更**: `ipc.ts`(`SpritesetMakeBackgroundKey`/`SpritesetImport`)、`preload/index.ts`(`makeBackgroundKey`/`importSpriteset`)、`main/index.ts`(ハンドラ2件+`chooseSourceImage`/`chooseBackgroundKeyPath`+will-quit)、`spriteset-importer.ts`(`parseSpritesetImportPayload`を**index.tsではなくここに**置きオフスクリーン検証可能に。既存の`parseCodeSettingsPatch`/`parseModelId`と同じパターン)、`video-codec.ts`(訂正②で拒否リスト撤去)、`ModelTab.tsx`(**モックアップL931-1080どおり「追加するモデルの形式」セレクタ**+形式別フロー。「準備中」を置き換え)
  - **検証42件**: Node 22(background-keyのキャンセル/壊れ画像で保存先を聞かない等 + ペイロード検証7ケース)、**ブラウザ実機12(オフスクリーンElectron・secure context)**=クロマグリーン動画を生成→デコード→**背景が透過・被写体が残る・内部の緑の島が保護される(境界連結判定が実動画で効く)**・PNGシグネチャ・壊れ動画で正直にエラー、SSR 8(**全10プロンプトがモックアップ正本と一致**)
  - **依存の分離**: sharpはRendererに漏れず(`require("sharp")`/`libvips`=0件)、preloadの`sharp`一致は自分が書いたコメント文字列のみ。Main側は今回配線されバンドルに入った
  - **チェックループ**: 2周(1周目4件[中〜高1: `waitForMetadata`にタイムアウトが無く無期限ハングしうる実バグ / 中1: ペイロード検証が緩い(delayのNaN・文字列・0以下、framesが非ArrayBuffer) / 低〜中1: 「保存」ボタンのラベルと実挙動の乖離 / 低1: 段1の到達不能な隠しinput]→2周目0件)
  - **申し送り(任意・第3段階着手時に検討)**: 「外部サービスへ渡す画像」右のボタンを、モックアップの**「保存」から「選び直す」へ意図的に変更**した(実挙動が「元画像を選び直して合成・保存をやり直す」ため。モックアップ側はonClickを持たない静的モック)。理由はコード内コメントに残してあるが、**モックアップ正本側へ同期するか否かは未判断**
  - **未実装(意図的)**: Live2Dのzip取り込み、**取り込み後の感情↔クリップ再割り当て編集**(第3段階)、モデル名の変更(モックアップどおり既定名`新しいモデル`で登録)
- **完了 モデル管理タブ 第3段階 Track A: マッピング編集(Main基盤 + UI)(FR-5)** — 「感情とモーションの対応」の準備中を実マッピング編集に置換。Live2Dはモーション/表情の割り当て+自動、スプライトセットはクリップ削除。**第3段階はユーザー承認で3トラックに分解**(A=マッピング編集<今回> / B=スプライトセットのクリップ差し替え「変更」=decode-video.ts再利用 / C=プレビュー枠。Live2DプレビューはPixiJS同梱+Cubismランタイム必須で描画がサンドボックス検証不可・メモリ実測TODO未決のためCを後回しにしAを先行)
  - **新規**: `src/shared/model-mapping.ts`(契約: Live2d/SpritesetMappingDetail・Live2dEntryPatch。zod非依存)、`src/main/model/mapping-service.ts`(`MappingService`。**Electron非依存**。getDetail/setLive2dEntry/autoRestoreState/autoRestoreAll/deleteSpritesetClip + parseEmotionState/parseLive2dEntryPatch)、`src/renderer/control-panel/src/MappingEditor.tsx`(UI。Live2dRows/SpritesetRowsはSSR検証のためexport)。**変更**: `live2d-import.ts`(`autoMapLive2dState`=1状態だけ再検出。pickBest再利用で一括と食い違わない)、`ipc.ts`(ModelMapping* 5チャンネル)、`preload/index.ts`(models名前空間拡張)、`character-window.ts`(`reloadIfApplied`)、`index.ts`(registerModelIpc内に配線)、`ModelTab.tsx`(準備中→MappingEditor)
  - **マッピングの正本はmanifest.json**(CLAUDE.md原則3): 編集はすべて`userData/models/<installedDir>/manifest.json`の読み書きで完結。config.jsonに複製しない。**書き込み前にManifestSchema.parse+tmp+renameで原子的**(既存の有効manifestを上書きするため。ConfigStoreと同方針)
  - **嘘をつかない/セキュリティ**: (1)setLive2dEntryは`enumerateLive2d`の実列挙結果と突合してから書く(Renderer由来のmotion/expression名を候補に無くても信じない) (2)パス検証`resolveWithinBase`をmodelDir解決・manifest解決・クリップ削除の3箇所に通す (3)**idle削除拒否**(C-18。全状態のフォールバック先) (4)全ハンドラ`isPanelSender`+parseXxx検証
  - **Live2Dの未割当**: 両方nullかつidle以外→emotionMapからキーごと外す(実行時idleフォールバック)。**idleは両方nullでもキーを残す**(C-18)。**自動マッピングはLive2Dのみ**(論点4。スプライトセットは生成フローがクリップを感情ごとに1:1で作るため候補・自動の概念が無い=正当な非対称)
  - **キャラウィンドウ反映**: マッピング編集はmanifest書き換えのみで解決モデルidが変わらず`applyActiveModel`(id差分判定)では拾えない→`reloadIfApplied(id)`を新設。characterはbootstrapでinstalledDir/mappingFileだけ受けmanifestを毎回fetchするので同URL再読込で新manifestを読み直す
  - **意図的に未実装(正直に後続表記)**: スプライトセットのクリップ**差し替え(「変更」)=Track B**(→**下記で完了**)、**プレビュー枠(論点1)=Track C**。偽ボタンを置かない
  - **検証**: typecheck/build通過(control-panelにzod漏れ無し=schemasチャンク不在・0件確認)。**オフスクリーン Main 40件**(実ConfigStore/実Haruモデル使用: 列挙・手動設定・未割当復帰・存在しない候補拒否・idle空でも有効・autoRestoreStateがautoMapLive2dStateと一致・autoRestoreAll上書き・原子的書き込み・パス逸脱拒否・spriteset削除/idle削除拒否/冪等/未知returnToをnullに畳む/形式違い操作拒否・ペイロード検証)+**SSR 20件**(0体空状態・読込中・対象タブ・候補select・要設定・必須・削除確認・差し替え後続明記)
  - **チェックループ**: reviewer 2周(1周目軽微1件[returnToを検証なしにEmotionStateへキャスト]→`toEmotionStateOrNull`で修正→2周目0件)。**実装フェーズのためreviewer修正もOpus 4.8継続**([[feedback_impl-phase-model-policy]])
- **完了 モデル管理タブ 第3段階 Track B: スプライトセットのクリップ差し替え/設定「変更」(FR-5)** — Track Aの「差し替えは後続」プレースホルダを実機能に置換。取り込み(SpritesetAddFlow)と同じ`decodeAndKeyVideo`(Rendererでデコード+色キー抜き)→`setClip` IPC→Mainで`encodeAnimatedWebp`(sharp)。**idle=変更のみ(削除不可・C-18)/割当済み非idle=変更+削除/未割当=設定**(「要設定」の行き止まりを解消)
  - **変更**: `spriteset-importer.ts`(`parseSpritesetClip(clip,state)`を切り出し取り込みと共有・`CLIP_DEFAULTS` export)、`mapping-service.ts`(`async setSpritesetClip`。deps に`encode?`注入)、`ipc.ts`(`ModelMappingSetClip`)、`preload/index.ts`(`models.setClip`)、`index.ts`(**非同期**ハンドラ配線=エンコードを挟むためmapEditの同期版に乗らない)、`MappingEditor.tsx`(変更/設定ボタン+file input+decode進捗)
  - **書き込み順序の非対称(正当・明記済み)**: 設定=**先にファイル→後でmanifest**(manifest書込失敗時は孤児ファイル=無害) / 削除=**先にmanifest→後でファイル**(逆順)。どちらも「manifest参照に実体が伴わない状態を作らない」ため。`loop`/`returnTo`は状態の性質(CLIP_DEFAULTS)で、差し替え時は既存を保ち新規はデフォルト。**寸法はbaseResolutionと一致必須**(単一baseResolution前提。別解像度は作り直し)
  - **設計訂正(reviewer指摘1)**: `model-mapping-ui.md`論点3の当初案「dialog.showOpenDialog+行へのドロップ両対応」を`<input type=file>`のみへ**訂正記録**(decode-video.mdのWebCodecs訂正と同構図)。理由=デコードはChromiumのみでFileが要る/showOpenDialogはMain側パス文字列を返し`<video>`に読ませられない/追加フローも`<input>`で揃う/パスをRendererに渡さない不変条件
  - **レース修正(reviewer指摘2)**: モデル切替pillに`disabled={busy||decoding!==null}`。実行中(decodingはデコード開始〜setClip完了まで非null維持)は切替を封じ、runEditのsetDetailが常に現在の対象へ反映される
  - **検証**: typecheck/build通過。**オフスクリーン Main +24件**(未割当→設定でmapped化・CLIP_DEFAULTS付与・差し替えでloop/returnTo維持・エンコードloop値・ファイル上書き/孤児回避・idle差し替え可・寸法不一致拒否・パス逸脱拒否・Live2Dへの形式ガード・parseSpritesetClip検証。encodeはフェイク注入)+**SSR +7件**(変更/設定/削除/idle必須理由/未割当設定/デコード進捗)。reviewer 2周(指摘2件→修正→**0件確定**)
- **完了 モデル管理タブ 第3段階 Track C: プレビュー枠(FR-5 / 論点1)** — 「感情とモーションの対応」Section先頭に120×120程度のプレビュー枠。**両形式とも`CharacterRenderer`を通す**(本番=キャラウィンドウと同一経路。プレビュー専用の別描画を作らない)。各感情行に▶を置き`setState(state)`で再生。これで第3段階(A/B/C)完了
  - **新規**: `src/renderer/control-panel/src/ModelPreview.tsx`(forwardRef+useImperativeHandleで`setState`公開。status=unavailable/loading/ready/error を正直表示)。**変更**: `ipc.ts`(`ModelPreviewContext`)、`preload`(`getPreviewContext`)、`index.ts`(ハンドラ)、`mapping-service.ts`(`getPreviewContext(id)`=resolveModelDir経由でslot検索一本化)、`MappingEditor.tsx`(Section先頭に`<ModelPreview>`・各行に▶`PreviewButton`・`previewReady`活性制御・runEdit成功で`reloadNonce++`)
  - **プレビューのコンテキスト取得**: トークンは`/panel`がHTMLに埋め込む(`window.__APP_TOKEN__`)+オリジンは`window.location.origin`(readBootstrapがまとめ読み)。**installedDir/mappingFileは`getPreviewContext(id)`で取る**(/panelにはbootstrapを埋め込まない=プレビュー対象はアクティブと別選択のため)。installedDir露出はキャラウィンドウのbootstrapと同じ最小情報で、model-manageの「スナップショットにパスを載せない」とは別問題
  - **編集の反映(嘘をつかない)**: 編集はmanifestを書き換えるので、`runEdit`成功で`reloadNonce`を増やしプレビューを最新manifestで作り直す(古い対応を映さない)。遅延マウント/destroyはeffectクリーンアップ(MappingEditorのマウント/アンマウントに追従)
  - **⚠️ zod漏れ回帰を1度踏んで修正(reviewer指摘1・[[Memory.md:246]]と同型)**: 当初`createRenderer`/`loadManifest`/`readBootstrap`を**静的import**したため、zod入り`createRenderer`チャンク(709KB)がcontrol-panel起動時に**modulepreloadで先読み**されていた(モデルタブを開かなくても)。**修正**: これらをeffect内`await import()`の**動的import**へ、型のみ`import type`。ビルドで`control-panel/index.html`のmodulepreloadが`preload-helper`のみ・`createRenderer`チャンク709KB→5.15KBを確認。**教訓: 「遅延マウント」(実行時mount/destroy)とバンドル分割(いつコードを読むか)は別問題。エントリチャンク差分だけ見て「+6.7kB」と誤申告した→modulepreloadまで実測すること**
  - **未検証(正直に後続/ユーザー確認)**: 実描画(WebGL/Cubismランタイム/PixiJS)と**遅延マウント/destroyのメモリ実測(200MB目安=論点1のTODO)はサンドボックス/devで検証不可**。dev(Vite)はトークン未注入で`unavailable`表示=配信ビルドでのみ描画。model-mapping-ui.md 実装TODOの「プレビューのメモリ実測」は未チェックのまま残す
  - **検証**: typecheck/build通過。**SSR 35件**(Track A/B分岐+▶活性/非活性+ModelPreviewのSSRスモーク=import健全性)。reviewer 2周(指摘3件[modulepreload回帰・slot検索重複・docコメント]→修正→**0件確定**)
- **完了 セキュリティ仕上げ(FR-13)** — ローカルサーバーの本体対策(127.0.0.1限定/トークン認証/WS認証/CSP `frame-ancestors 'self'`/`resolveWithinBase`パス検証/両ウィンドウ`contextIsolation`+`nodeIntegration:false`+`sandbox:true`)は**既に実装済み**だったことを監査で確認(security.md 9章チェックリスト1〜4=充足)。「仕上げ」として**チェックリストに漏れていた5章の延長=ナビゲーション/新規ウィンドウ/Web権限要求の抑止**を追加した(security.md 対策8として明文化)
  - **新規**: `src/main/window-security.ts`(`guardNavigation`=自オリジン外の`will-navigate`/`will-redirect`拒否・**初回loadURL未確定時(getURL()空/about:blank)は許可**・`denyWindowOpen`・`openExternalHttpOnly`=http/https限定で外部起動しElectron子ウィンドウは常に拒否・`denyAllPermissions`=session権限要求/チェックを一律false)
  - **変更**: `character-window.ts`(生成直後に`setWindowOpenHandler(denyWindowOpen)`+`guardNavigation`。**control-panelにあってcharacterに無かった`setWindowOpenHandler`の非対称を解消**)、`control-panel-window.ts`(インラインの`shell.openExternal`ハンドラを`openExternalHttpOnly`へ置換=スキーム限定に強化+`guardNavigation`。`shell` import除去)、`index.ts`(app.whenReady先頭で`denyAllPermissions(session.defaultSession)`。両ウィンドウは既定セッション共有=1回で足りる)、`docs/security.md`(対策8+チェックリスト項目5、見出しを9/10へ繰り下げ)
  - **新規ウィンドウの扱いは意図的に非対称(明記済み)**: character=一律deny(リンク導線なし=多層防御)/panel=http/https外部起動(権利タブ等の正当リンク)。ウィンドウ単位の変更でLive2D/スプライトセット形式分岐とは無関係=その意味の対称性チェック対象外(コメント明記)
  - **`will-navigate`はアプリ起点`loadURL()`では発火しない**ためモデル切替(`applyActiveModel`)/マッピング反映(`reloadIfApplied`)の再読込を妨げない。同一オリジン(dev HMRの`location.reload`)は許可。`denyAllPermissions`はWebCodecs(動画デコード=権限不要)・Main側clipboardを壊さない(reviewer実測確認)
  - **⚠️ reviewer実測で重大バグ1件を検出・修正**: 初回`block()`が`getURL()`(初回loadURL中は`''`)で同一オリジン判定→`new URL('')`例外で`will-redirect`を誤ってpreventDefault→**302を挟む初回ロードでウィンドウが無言でハング**(実Electronで再現)。修正=未確定(空/about:blank)時はブロックせず許可。読み込み先はアプリが決めたlocalhost/Vite/fileのみなので安全。コミット後の別オリジン拒否は維持(実Electronで再確認)
  - **basic-design.md 8章は据え置き**(要点抜粋方針。対策7=ログ0600も元々未記載の既存粒度差。詳細はsecurity.md。Notion要件変更ではないため原則2の対象外)→**ユーザー指示によりNotion正本8章へ昇格済み(2026-07-24)**: Notion(`39fcd5c5312e811b938ff35e04246436`)8章に「ナビゲーション・新規ウィンドウ・権限要求の抑止」1文を追記、更新日を07-24へ。docs/basic-design.mdミラーも同時反映(原則2: Notion→ミラーの順)
  - **検証**: typecheck/build通過(`createRenderer`5.15KB=回帰なし)。オフスクリーン検証23件(electronをstub化した純Node: guard同一/別オリジン・will-redirect・初回未確定許可・about:blank・deny・openExternal http/https/file/js/不正URL・権限拒否)。reviewer 2周(1周目 高1[初回redirectハング・実測]+低1[見出し番号]+情報1→修正→**2周目0件**、実Electronでハング解消を再確認)
- **次**: **第3段階(Track A/B/C)+ FR-13完了(PR #9マージ済み)。FR-13対策8のNotion正本8章への昇格も完了**。残る主な実装候補(2026-07-24 reviewer棚卸しで再整理): Live2Dのzip取り込み、モデル名変更UI、会話ペインの@参照文脈組立/添付読み出し(real・FR-15/C-23。real接続導線自体は#12で実装済み、@参照/添付だけが未接続)、Live2D持続中Reactionの再発火メカニズム(lipsync.md論点③=未決着のまま残す。EmotionEngine側かLive2DRendererか要設計)、Live2Dプレビュー含む実描画のユーザー確認(Cubismランタイム未同梱で検証不可)+メモリ実測(200MB目安)、`displaySize`範囲の不一致解消(未決事項C6)、Google Fonts同梱化(未決事項C2)。着手時のモデル方針は依頼内容で判断(新規=Opus/既存修整=Sonnet)
- **正本同期の棚卸し実施(2026-07-24)**: reviewer調査で、`emotion-classification.md`(classifier schema)・`lipsync.md`(sustain/release)の「要決着」マーカーが**実装・Notion反映済みにもかかわらず未チェックのまま**だったことが判明→両ドキュメントを「決着済み」に更新。`chat-adapter-errors.md`の権利情報タブOSS一覧チェックボックスも、`generate-oss-licenses.mjs`の自動走査で実際には反映済みと確認し更新。**本行(「次」節)自体も陳腐化していた**(real接続を「#12未実装」と誤記、FR-13完了後も更新されていなかった)ため合わせて修正

**CI整備を実施（2026-07-21・ユーザー依頼）**: それまでCI/CDが一切存在しなかった（`.github/`なし）。`.github/workflows/ci.yml`を新設し、`develop`/`main`へのPR・pushでtypecheck・build・OSSライセンス生成物（`src/shared/oss-licenses.ts`）の鮮度チェックを実行する。ランナーは`macos-latest`固定（対応OSがmacOSのみ=C-01であることに加え、OSSライセンス生成が実インストール依存を走査するため別OSだと結果がずれる）。Node版数は`.nvmrc`（26・メジャーのみ固定）を単一の情報源にした。**CD（パッケージング/リリース）は意図的に未整備のまま**（electron-builderの配布設定・署名/notarizeが未決のため、動かないCDを置かない判断）。
  - **reviewerチェックループ2周実施**（1周目5件[permissions/persist-credentials未指定・npm installスクリプトの記述が実測と不一致だった等]→修正→**2周目0件**）。npmの`allow-scripts`警告を「installスクリプトがブロックされる」と誤って書いていたが、実測（`ignore-scripts`/`strict-allow-scripts`がいずれも`false`、esbuildのpostinstallバイナリが実在）で訂正した
  - `.claude/rules/build-commands.md`「CI（GitHub Actions）」節・`git-workflow.md`「CIとの関係」節・CLAUDE.mdディレクトリ構成ツリーに反映済み
  - Obsidian Vaultに計測1件・知見1件を追加（プロジェクト索引ノート`ヨリマシ.app.md`から参照。詳細はVault側、正本はリポジトリの上記rules）

ハーネス整備は完了（たそがれ日記ベースへの移行 → Obsidian Vault導入 → 対称性フックの差分ベース化 → CI整備）。
A1+B一括Notion更新・A2・FR-15入力欄機能の仕様反映（C-23/C-24）も完了。**実装着手をブロックする未決事項は無い。**

## 技術情報

- **スタック**: Electron 43 / TypeScript 7 / React 19 / Vite 7 / electron-vite 5 / Zod 4
- **Viteは7系に固定**（electron-vite 5のpeerが`^5||^6||^7`。最新のVite 8とは非互換。`--legacy-peer-deps`で潰さない）
- **tsconfigは3分割**: `tsconfig.node.json`（Main/Preload/shared）・`tsconfig.web.json`（Renderer/shared）・`tsconfig.json`（references）
- **導入済み**: `pixi.js@^6.5.10`・`pixi-live2d-display@^0.4.0`（A2）・`@anthropic-ai/sdk@^0.112.3`（#12）・`lucide-react@^1.25.0`（#6以降のUI移植で追加）
- **未導入**: `sharp`（spriteset-pipeline実装時に追加）。Cubism外部ランタイム（`live2d.min.js`/`live2dcubismcore.js`、npmに無い）も実装時に用意
- **scratchpad**での検証実績: sharp・Anthropic SDK・Electronオフスクリーン。リポジトリには置かない
