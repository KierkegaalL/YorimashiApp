# Memory.md — ヨリマシ.app 状況記録

> セッションをまたいだ引き継ぎ用。`TaskCreate`/`TaskUpdate` がセッション内の再開用、本ファイルはセッション間の引き継ぎ用（次回セッション冒頭でも状況を把握できるようにする）。チェックポイント（.claude/rules/build-commands.md）ごとに更新する。

**最終更新**: 2026-07-19

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
  - **TODO化(Code Adapter実装#9へ持ち越し)**: `Stop`イベント(basic-design.md 7.1「Moodのみidle寄りに重心移動」)に対応する専用APIは未実装。`onToolResult()`のJSDocにTODO明記済み
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
- **次**: Phase 1完了。Phase 2へ → #6(FR-15会話ペインをmockup(control-panel.jsx)から実プロダクトコードへ移植)。#7(折りたたみリサイズ)・#8(Chat Adapter mock)と連動

ハーネス整備は完了（たそがれ日記ベースへの移行 → Obsidian Vault導入 → 対称性フックの差分ベース化）。
A1+B一括Notion更新・A2・FR-15入力欄機能の仕様反映（C-23/C-24）も完了。**実装着手をブロックする未決事項は無い。**

## 技術情報

- **スタック**: Electron 43 / TypeScript 7 / React 19 / Vite 7 / electron-vite 5 / Zod 4
- **Viteは7系に固定**（electron-vite 5のpeerが`^5||^6||^7`。最新のVite 8とは非互換。`--legacy-peer-deps`で潰さない）
- **tsconfigは3分割**: `tsconfig.node.json`（Main/Preload/shared）・`tsconfig.web.json`（Renderer/shared）・`tsconfig.json`（references）
- **導入済み**: `pixi.js@^6.5.10`・`pixi-live2d-display@^0.4.0`（A2）
- **未導入**: `@anthropic-ai/sdk`・`sharp`・`lucide-react`（すべて実装時に追加）。Cubism外部ランタイム（`live2d.min.js`/`live2dcubismcore.js`、npmに無い）も実装時に用意
- **scratchpad**での検証実績: sharp・Anthropic SDK・Electronオフスクリーン。リポジトリには置かない
