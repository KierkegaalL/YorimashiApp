# Memory.md — ヨリマシ.app 状況記録

> セッションをまたいだ引き継ぎ用。`TaskCreate`/`TaskUpdate` がセッション内の再開用、本ファイルはセッション間の引き継ぎ用（次回セッション冒頭でも状況を把握できるようにする）。チェックポイント（.claude/rules/build-commands.md）ごとに更新する。

**最終更新**: 2026-07-17

## 現在地

**設計フェーズ完了。実装は未着手。**

- 詳細設計7件すべて確定（`docs/detailed-design/`）
- スキャフォールドのみ実装済み（Electron + TS + React + Vite）
- **未決事項は13件**（A1・A2・B1〜B6を解消。残りはA2の完了（モデル配置自体）とC0〜C6）
- A2（Live2Dモデル受け入れ準備）着手済み。`dev-assets/live2d/`作成、`pixi.js@^6`+`pixi-live2d-display@^0.4.0`導入。**実際のモデル配置はユーザー作業として残っている**
  - **非対称は正当**: `dev-assets/`はLive2D専用（`spriteset/`は無い）。Live2Dは完成済みモデルを**配置**する形式（フォルダ/zipドロップ）だが、スプライトセットは静止画1枚から**アプリ内で生成**する形式（要件定義書4.5・C-17）で、事前配置するモデル資材という概念自体が存在しない。character-window.mdで確認済みの非対称と同じ構造
  - **PixiJSはv6系で固定**。`pixi-live2d-display`安定版のpeerが`^6`。v8（npm最新）とは別クラス（`instanceof`不一致を実測）。beta(0.5.0-beta)はv7対応だが2023-12以降更新なし。Cubism 2/4はそれぞれ外部ランタイム（`live2d.min.js`/`live2dcubismcore.js`）が必須で、無いとimport時に例外。詳細は`.claude/rules/environments.md`「PixiJSのバージョン方針」
- **A1+B（B1〜B6）をNotion正本に反映済み**（基本設計書・要件定義書 両方 + docs/data.md・config-schema.ts）。`baseResolution`を形式共通必須化、EmotionEngineに`sustain`/`release`、`chatAdapter`にclassifier等追加、streakしきい値を`emotionEngine`へ移動、Anthropic SDKを技術スタックへ、`cubismVersion`にコメント明示、9章の記述誤り修正
- **副次的に発見した既存バグを修正**: `config-schema.ts`の`createDefaultConfig()`が実際には空値しか返さなかった。Zod v4は`.default(v)`だと入力undefined時に`v`をバリデーションなしで採用し、ネストしたフィールドの`.default()`が補完されない。`.prefault(v)`に変更して解決（実行時に全フィールド正しく補完されることを確認済み）

## 完了済み作業

| 内容 | 成果物 |
|---|---|
| 設計ドキュメントと開発ハーネスの配置 | `docs/`・`CLAUDE.md`・`.claude/` |
| Electronスキャフォールド | `src/{main,preload,shared,renderer}`・`electron.vite.config.ts`・tsconfig 3種 |
| Notion正本の更新（C-19メニューバーアイコン、windowPosition） | Notion 要件定義書・基本設計書 + docs/ ミラー |
| 詳細設計7件の確定 | `docs/detailed-design/*.md` |
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

## 未決事項（13件）

A1・A2（受け入れ準備）・B1〜B6は解消済み。残るのはA2の完了（実モデルの配置自体）とC0〜C6。

### 実装着手前に残るもの

| # | 内容 |
|---|---|
| A2完了 | **開発用Live2Dモデルの実配置**（ユーザー作業）。`dev-assets/live2d/`に配置後、Cubism 2/4の列挙構造・持続中にモーションが尽きたときの挙動を実測する（model-mapping-ui.md / lipsync.md） |

### 優先度C — 該当機能の実装時に併せて

| # | 内容 | 契機 |
|---|---|---|
| C0 | **`config.obsidian`（`vaultPath`/`syncMode`）と `config.notion` に対応するFRが無い**。configにだけ存在し、FR-1〜FR-14のどれにも紐づいていない。要件側の定義が要る | 要Notion確認 |
| C1 | 権利情報タブのOSS一覧に`sharp`/`libvips`追加（libvipsはLGPL-3.0で既存のMIT/ISCと種別が違う） | FR-12 |
| C2 | フォントをGoogle Fontsの`@import`からローカル同梱へ（CSP・オフライン・外部リクエスト） | ローカルサーバー |
| C3 | Rendererの読み込み元を`http://localhost:8765`へ移行（security.md 7章。**WebCodecsの有効化条件**） | 同上 |
| C4 | api.md 6章「直叩き」→ SDK採用に記述更新 | Chat Adapter |
| C5 | オンボーディング完了フラグの保存先（config未定義） | FR-14 |
| C6 | `displaySize`の範囲（モックアップ20-100% vs スキーマ0.1-2.0）。**UIから届かない範囲がスキーマ側にある** | FR-7 |

## 次の一手

1. **A2完了**（実モデル配置。ユーザー作業） → 実装着手
2. Cは各機能の実装時に回収

ハーネス整備は完了（たそがれ日記ベースへの移行 → Obsidian Vault導入 → 対称性フックの差分ベース化）。
A1+B一括Notion更新も完了。**残る実装ブロッカーはA2（実モデル配置）のみ。**

## 技術情報

- **スタック**: Electron 43 / TypeScript 7 / React 19 / Vite 7 / electron-vite 5 / Zod 4
- **Viteは7系に固定**（electron-vite 5のpeerが`^5||^6||^7`。最新のVite 8とは非互換。`--legacy-peer-deps`で潰さない）
- **tsconfigは3分割**: `tsconfig.node.json`（Main/Preload/shared）・`tsconfig.web.json`（Renderer/shared）・`tsconfig.json`（references）
- **未導入**: `@anthropic-ai/sdk`・`sharp`・`lucide-react`・`pixi-live2d-display`（すべて実装時に追加）
- **scratchpad**での検証実績: sharp・Anthropic SDK・Electronオフスクリーン。リポジトリには置かない
