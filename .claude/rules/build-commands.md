# build-commands.md — ビルド/型チェックコマンド & チェックループ手順

> Electron + TypeScript + React + Vite プロジェクト（electron-vite 5 / Vite 7 / Electron 43 / React 19）はスキャフォールド済み。以下のコマンドは`package.json`の scripts と一致する。

## ビルド / 実行

| 目的 | コマンド | 備考 |
|---|---|---|
| 依存インストール | `npm install` | |
| 開発起動 | `npm run dev` （= `electron-vite dev`） | **GUIを開くためClaude Codeからは実行不可**（constraints.md「実機能確認の制約」） |
| ビルド | `npm run build` （= `electron-vite build`） | `out/` へ出力。Claude Codeから実行可 |
| ビルド結果のプレビュー | `npm run preview` | GUIを開くため実行不可 |

## 型チェック

| 目的 | コマンド |
|---|---|
| 全体 | `npm run typecheck` |
| Main / Preload / shared | `npm run typecheck:node` （= `tsc --noEmit -p tsconfig.node.json`） |
| Renderer / shared | `npm run typecheck:web` （= `tsc --noEmit -p tsconfig.web.json`） |
| 単一ファイルの構文のみ（高速） | `npx esbuild <file> --outfile=/dev/null` |

Main/Preload と Renderer は別 tsconfig（`lib`・`types`が異なる）。**片方だけ通っても安心しない**。`npm run typecheck` は両方を順に実行する。

> `lint` / `test` スクリプトは未整備。`post-edit-check.sh` は**存在する script のみ実行する**設計なので、追加すれば自動的に有効になる。

## サンドボックスで可能な検証

GUIを開けないだけで、**多くの検証は実行できる**。詳細設計フェーズではこれで設計判断を実証した。推測でドキュメントやコードを書かないこと。

| 手段 | 用途・実績 |
|---|---|
| Electron のオフスクリーン実行 | `BrowserWindow({show:false})` + `app.exit(0)`。screen API・コーデック・`alwaysOnTop`レベル・`net.isOnline()`の実測に使用 |
| ローカルのモックサーバー | `http.createServer` + SDKの`baseURL`差し替え。リトライ挙動・SSEの凍結・タイムアウトの実測に使用 |
| ライブラリの単体実行 | scratchpad に隔離して `npm install` → 実測。sharp のアニメーションWebP生成・jimp の非対応判明に使用 |
| アルゴリズムの実行 | 自動マッピングのスコアリング・感情分類の否定処理を実データで検証 |

**検証用の一時ファイルはリポジトリに置かない**（scratchpad ディレクトリを使う）。

## hooks による自動実行

`.claude/settings.json` が以下を自動実行する。

| フック | イベント | 内容 |
|---|---|---|
| `post-edit-check.sh` | PostToolUse（Edit/Write/MultiEdit） | `.ts`/`.tsx`/`.js`/`.jsx` 編集後に `npm run lint`・`npm run typecheck`（存在するもののみ）。失敗時は非0で停止させる |
| `symmetry-reminder.sh` | 同上 | Live2D/スプライトセットの対称性をリマインド（**補助であり判断はしない**。誤検知あり） |
| `model-advisor.sh` | UserPromptSubmit | 依頼文から推奨モデルを助言。不一致時は警告（下記「使用モデルの自動化」） |
| `session-start-reminder.sh` | SessionStart | 正本確認・対称性チェックの注意喚起 |

各ツールが未整備の間は**グレースフルに no-op** する。型チェックが失敗した場合、Claude Code は先に進まず修正すること。

---

## 実装後チェックループ（必須フロー）

> **ルール: 実装の指示を行った後は、必ず以下のループを実行し、指摘事項が0件になるまで繰り返すこと。** `/check-loop` スラッシュコマンドで呼び出せる。

1. メインエージェントがタスクを実装する
2. **チェック専用のサブエージェント**を起動し、以下を確認させる:
   - **対称性チェック**（Live2D/スプライトセットの片方だけ直していないか。非対称なら理由が明記されているか）— constraints.md 最重要ルール
   - 修正漏れ・要件との齟齬（Notion / `docs/`）
   - 不具合（バグ、例外処理漏れ、型不整合など）
   - コードの冗長な部分（重複ロジック、デッドコード）
   - `docs/detailed-design/` の決定事項との整合性
   - UIは `docs/mockups/control-panel.jsx` と一致しているか
3. 指摘が **1件以上** → 修正 → 手順2に戻る（再チェック）
4. 指摘が **0件** → ループ終了、完了として報告
5. 回答・報告は **日本語** で行う

### サブエージェント起動の目安

- チェック（既存/作成済みファイルへの実行）は **`reviewer` エージェント**（`.claude/agents/reviewer.md`、Sonnet 5 固定）を `Agent` で起動する（CLAUDE.md 原則8）
- チェック結果は「指摘リスト（該当ファイル:行・種別・修正案）」の形で受け取る

## 使用モデルの自動化（CLAUDE.md 原則8）

- **UserPromptSubmit フック** `.claude/hooks/model-advisor.sh` が依頼文を判定し、推奨モデル（新規作成→Opus 4.8／既存への修整・調査→Sonnet 5）を助言として注入する。**フックはモデルを切り替えられない**ため、必要に応じ `/model` で切り替える。
- **警告時は実行を停止**: 現在のモデルが **Opus 4.8 のまま新規作成以外の指示**を受けた場合は警告を注入する。警告時はメインエージェントはその指示の実行に着手せず、ユーザーに不一致を伝えて `/model` での Sonnet 5 切替を求め停止する。ユーザーが切替後に指示を再送するか、Opus 続行を明示的に指示した場合のみ実行する。
  - 現在モデルの検知: フック入力の `model` → 無ければ `transcript_path` 末尾の assistant 発話の `message.model`。
  - **検知できない場合は警告を出さず**（＝停止せず）、依頼内容ベースの推奨のみ表示する（安全側）。
- **レビュー・整合チェック・残タスク調査**は、メインエージェントが `reviewer` サブエージェント（`model: sonnet` 固定）を起動することで Sonnet 5 実行になる（フックが自動で起動するわけではない）。`/check-loop` の手順に従って明示的に起動する。

## セッション消費量の節約（チェックポイント方式）

> 背景: セッション利用枠（Anthropic 側の API 利用制限。会話のコンテキスト量とは別物）は Claude Code が実行中にリアルタイムで正確な割合として取得できない。そのため「消費量が90%に達したら」のような数値ベースの条件は実行不能（推測になる）。代わりに、**メインエージェントが確実に検知できるタスク境界（チェックポイント）** をトリガーにする。

**ルール**: 以下のいずれかのチェックポイントに到達するたびに、作業を止めて次を行う。

1. **1機能（または詳細設計1件）の実装・チェックループ・コミットが完了した直後**
2. ユーザーから次の指示を受ける前で、かつ会話が長くなってきたと判断した時（目安: サブタスクが3件以上完了、または大きめのサブエージェント呼び出しを複数回行った後）

チェックポイントでは:

1. **残タスクを `TaskCreate`/`TaskUpdate` で構造化して保持する**（会話履歴だけに残さない）。セッション制限等で中断しても、会話全体を読み返さずタスクリストを見れば再開できる。
2. **[Memory.md](../../Memory.md) を更新する**（「最終更新」日付・完了済み作業・残タスクの節を中心に）。`TaskCreate`/`TaskUpdate` がセッション内の再開用、Memory.md はセッションをまたいだ引き継ぎ用。
3. 完了した内容・残タスクを簡潔に要約してユーザーに提示する。
4. 次の指示に進む前に、**`/compact` の実行をユーザーに提案する**（強制はしない）。

**長時間サブエージェント呼び出しの分割**: reviewer 等の大きな検証タスクは、可能な範囲でファイル単位・機能単位に分割して呼び出す。1回の巨大な呼び出し中にセッション制限へ到達すると、それまでの検証結果が失われやすいため。
