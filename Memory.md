# Memory.md — ヨリマシ.app 状況記録

> セッションをまたいだ引き継ぎ用。`TaskCreate`/`TaskUpdate` がセッション内の再開用、本ファイルはセッション間の引き継ぎ用（次回セッション冒頭でも状況を把握できるようにする）。チェックポイント（.claude/rules/build-commands.md）ごとに更新する。

**最終更新**: 2026-07-18

## 現在地

**設計フェーズ完了。実装は未着手。**

- 詳細設計8件すべて確定（`docs/detailed-design/`）
- スキャフォールドのみ実装済み（Electron + TS + React + Vite）
- **FR-8（ブラウザ拡張機能連携）とFR-9（表示排他制御）をボツとして全書類から削除**（要件定義書C-20）。拡張機能を実装しないため、Viewerの排他制御自体が不要になった。番号は欠番のまま維持（詰めない）
  - 影響範囲: Notion(要件定義書・基本設計書)、docs/requirements.md・basic-design.md・data.md・api.md・security.md、detailed-design(chat-adapter-errors.md・model-mapping-ui.md)、config-schema.ts(`distribution.chromeExtensionId`/`chromeStorePublished`削除)、CLAUDE.md・environments.md・features.md、すべて反映済み
- **新規FR-15（会話ペイン）を追加**（要件定義書C-21・C-22）。「取り込んだモデルと会話する画面」が要件レベルで一切存在しなかった欠落への対応。**Control Panelと同一ウィンドウ内の左ペイン**（別ウィンドウにしない）。既定で両方展開、縁のタブで会話ペインのみ折りたたみ可。**会話履歴はv1では永続化しない**（メモリのみ。保持期間・パーミッション・削除UIが未定義のため）
  - ⚠️ **経緯**: 当初「独立ウィンドウ・独立して開閉可能」としてNotionに書いたが誤りで、ユーザーの意図は「一体化・タブで折りたたみ」だった。Notion・docs・rules すべて訂正済み
- **未決事項は9件**（A1・A2・B1〜B6は解消済み。**A2は完了**。残りはC0〜C8）
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

## 未決事項（9件）

A1・A2・B1〜B6は解消済み（**A2は2026-07-18に完了**、上記参照）。残るのはC0〜C8。**実装着手をブロックする未決事項は無くなった**。

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
| C7 | **会話ペイン(FR-15)の`activeAdapter`との関係が未決着**。`activeAdapter==='code'`のまま会話ペインから送信すると、Code実況とChat応答が同一のEmotionEngineに流れ込み、灯里の表情がどちら由来か区別できなくなる。送信時に`'chat'`へ自動切替+明示する案を推奨するが**FR-1「手動で切替」の変更にあたる**。あわせて**折りたたみ状態の保存先**(`config.general`に`chatPaneCollapsed`相当が無い)も要決着 | **FR-15実装前**。chat-pane.md 論点5 |
| C8 | モックアップの`maxWidth: 400`(model-mapping-ui.md論点2の結論根拠)は**元々「Chrome拡張のサイドパネルに収まるため」という理由だった**。FR-8削除でこの理由は無効化。値自体は変えず事実ベースの記述に差し替えたが、**左に会話ペインが並ぶ構成でこの幅・この中央寄せが適切かは未検討**。関連して**Control Panelのウィンドウは1000×720なのにモックアップは`maxWidth:400`を中央寄せしており、600px分が空白**という不整合もある(会話ペインが左に入るなら1000pxは辻褄が合う) | FR-15/FR-7実装時 |

### 次回セッションで棚卸しすべきこと

- **`chat-adapter-errors.md`・`emotion-classification.md`・`lipsync.md`の「要決着」マーカーが古いまま。** 3ファイルとも「Notion正本の変更が必要」とTODOに書かれているが、実際にはA1+B一括更新で全て解決・反映済み（`sustain`/`release`・`classifier`・streakしきい値の移動等）。実装者が二重に変更提案しないよう、次のチェックポイントで一括棚卸しする

## 次の一手

1. **実装着手が可能**（A2完了で実装ブロッカーは解消）。実装フェーズへ移る時点で `develop` を切る（git-workflow.md、決定済み）
2. **C7の決着**（会話ペインと`activeAdapter`の関係・折りたたみ状態の保存先）。どちらもNotion正本の変更を伴う
3. Cは各機能の実装時に回収。A2派生の**idleグループ存在検証**（model-mapping-ui.md TODO）はモデル取り込み実装時に対応

ハーネス整備は完了（たそがれ日記ベースへの移行 → Obsidian Vault導入 → 対称性フックの差分ベース化）。
A1+B一括Notion更新・A2も完了。**実装着手をブロックする未決事項は無い。**

## 技術情報

- **スタック**: Electron 43 / TypeScript 7 / React 19 / Vite 7 / electron-vite 5 / Zod 4
- **Viteは7系に固定**（electron-vite 5のpeerが`^5||^6||^7`。最新のVite 8とは非互換。`--legacy-peer-deps`で潰さない）
- **tsconfigは3分割**: `tsconfig.node.json`（Main/Preload/shared）・`tsconfig.web.json`（Renderer/shared）・`tsconfig.json`（references）
- **導入済み**: `pixi.js@^6.5.10`・`pixi-live2d-display@^0.4.0`（A2）
- **未導入**: `@anthropic-ai/sdk`・`sharp`・`lucide-react`（すべて実装時に追加）。Cubism外部ランタイム（`live2d.min.js`/`live2dcubismcore.js`、npmに無い）も実装時に用意
- **scratchpad**での検証実績: sharp・Anthropic SDK・Electronオフスクリーン。リポジトリには置かない
