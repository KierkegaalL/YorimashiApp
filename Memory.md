# Memory.md — ヨリマシ.app 状況記録

> セッションをまたいだ引き継ぎ用。`TaskCreate`/`TaskUpdate` がセッション内の再開用、本ファイルはセッション間の引き継ぎ用（次回セッション冒頭でも状況を把握できるようにする）。チェックポイント（.claude/rules/build-commands.md）ごとに更新する。

**最終更新**: 2026-07-18

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

## 次の一手

1. **実装着手が可能**（A2完了で実装ブロッカーは解消）。実装フェーズへ移る時点で `develop` を切る（git-workflow.md、決定済み）
2. **FR-15の実装**。入力欄機能（C-23）・論点5案1（C-24）・`controlPanelCollapsed`・折りたたみ時のウィンドウ縮小方式は仕様反映済み。**`docs/mockups/control-panel.jsx`(設計物)への2ペイン+入力欄統合・折りたたみUIは2026-07-18に実装済み**。残るのは`src/renderer/control-panel`(実プロダクトコード)への実装と、Main側`BrowserWindow.setBounds()`によるウィンドウ実リサイズ。chat-pane.md 論点7/実装TODO に沿って進める
3. Cは各機能の実装時に回収。A2派生の**idleグループ存在検証**（model-mapping-ui.md TODO）はモデル取り込み実装時に対応

ハーネス整備は完了（たそがれ日記ベースへの移行 → Obsidian Vault導入 → 対称性フックの差分ベース化）。
A1+B一括Notion更新・A2・FR-15入力欄機能の仕様反映（C-23/C-24）も完了。**実装着手をブロックする未決事項は無い。**

## 技術情報

- **スタック**: Electron 43 / TypeScript 7 / React 19 / Vite 7 / electron-vite 5 / Zod 4
- **Viteは7系に固定**（electron-vite 5のpeerが`^5||^6||^7`。最新のVite 8とは非互換。`--legacy-peer-deps`で潰さない）
- **tsconfigは3分割**: `tsconfig.node.json`（Main/Preload/shared）・`tsconfig.web.json`（Renderer/shared）・`tsconfig.json`（references）
- **導入済み**: `pixi.js@^6.5.10`・`pixi-live2d-display@^0.4.0`（A2）
- **未導入**: `@anthropic-ai/sdk`・`sharp`・`lucide-react`（すべて実装時に追加）。Cubism外部ランタイム（`live2d.min.js`/`live2dcubismcore.js`、npmに無い）も実装時に用意
- **scratchpad**での検証実績: sharp・Anthropic SDK・Electronオフスクリーン。リポジトリには置かない
