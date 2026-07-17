# features.md — 機能一覧・Notion要件リンク・現在のフェーズ

## Notion（要件・基本設計の正本）

| ドキュメント | URL |
|---|---|
| ヨリマシ.app（親ページ） | https://app.notion.com/p/39ecd5c5312e81eda7bff0c1463a2747 |
| **要件定義書**（正本） | https://app.notion.com/p/39ecd5c5312e81c19947f4905c032181 |
| **基本設計書**（正本） | https://app.notion.com/p/39fcd5c5312e811b938ff35e04246436 |

リポジトリ側の `docs/requirements.md` / `docs/basic-design.md` は**ミラー**。要件の追加・変更は必ずNotionを先に更新し、その後ミラーへ反映する。Notion MCP（`notion-fetch` / `notion-update-page`）で操作できる。

## 機能要件（FR-1〜FR-14）

| FR | 機能 | 詳細設計 |
|---|---|---|
| FR-1 | アダプタ切替（Code / Chat をControl Panelホームから手動切替） | — |
| FR-2 | Code Adapter（Claude Code hooks連携。`dispatch.sh` → ローカルサーバー） | api.md 1章 |
| FR-3 | Chat Adapter（mock / real。既定mock） | chat-adapter-errors.md / emotion-classification.md / lipsync.md |
| FR-4 | EmotionEngine（Mood 3 + Reaction 7 = **全10状態**。優先度・クールダウン・streak遷移） | emotion-classification.md / lipsync.md |
| FR-5 | モデル管理（Live2D / スプライトセット、最大2体） | spriteset-pipeline.md / model-mapping-ui.md |
| FR-6 | キャラクター表示ウィンドウ（透過・枠なし・最前面・クリックスルー） | character-window.md |
| FR-7 | コントロールパネル（ホーム/モデル/モード/設定/ログ/権利 の6タブ） | model-mapping-ui.md |
| FR-8 | ブラウザ拡張機能連携（Manifest V3、`chrome.sidePanel`、claude.aiタブのみ） | api.md 4章 |
| FR-9 | 表示排他制御（後から開いた方を優先。`viewer:hello`/`viewer:claim`） | api.md 3章 |
| FR-10 | 設定管理（config.json、Zod、`schemaVersion`マイグレーション） | data.md 1章 |
| FR-11 | ログ管理（hooksイベントログ7日保持、仮名化エクスポート） | data.md 4章 |
| FR-12 | 権利情報表示（Live2D利用区分、外部AIのToS、OSSライセンス、フォント） | — |
| FR-13 | セキュリティ機構（127.0.0.1限定、トークン認証、CSP、パストラバーサル対策） | security.md |
| FR-14 | オンボーディング（ようこそ→モデル→モード→完了の4ステップ） | onboarding.md |

### 全10状態（FR-4。単一の情報源）

- **Mood（緩やか）**: `idle` / `confident` / `tired` — `successStreak`/`failStreak`で遷移
- **Reaction（一過性）**: `thinking` / `happy` / `proud` / `worried` / `panic` / `curious` / `sleepy`
- **優先度**: panic > proud > worried > happy > curious > thinking > idle系
- 実装の単一の情報源は `src/shared/emotions.ts`。**11状態目を足す変更はFR-4の変更**（=Notion正本の更新）を伴う。

## 現在のフェーズ

**設計フェーズ。詳細設計7件はすべて確定済み。実装は未着手**（スキャフォールドのみ）。

| 詳細設計 | ステータス |
|---|---|
| spriteset-pipeline.md | 確定 |
| character-window.md | 確定（ウィンドウサイズの非対称のみ実装前に要決着） |
| model-mapping-ui.md | 確定 |
| emotion-classification.md | 確定 |
| chat-adapter-errors.md | 確定 |
| lipsync.md | 確定 |
| onboarding.md | 確定 |

実装済みのコード:

- `src/shared/emotions.ts` — 全10状態の定義
- `src/shared/config-schema.ts` — config.jsonのZodスキーマ
- `src/main/index.ts` — Control Panelウィンドウのみ生成（キャラクターウィンドウは未接続）
- `src/preload/index.ts` — contextBridge
- `src/renderer/{character,control-panel}/` — プレースホルダ

**次の作業**: 未決事項（13件）の解消 → 実装着手。一覧と優先度は [Memory.md](../../Memory.md) を参照。

## 参照ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/requirements.md` | 要件定義書のミラー（FR-1〜FR-14、非機能、セキュリティ、権利、確定事項C-01〜C-19） |
| `docs/basic-design.md` | 基本設計書のミラー（システム構成、コンポーネント、データ、外部IF） |
| `docs/data.md` | config.jsonスキーマ全体、manifest.json、ディレクトリ構成 |
| `docs/api.md` | ローカルサーバーAPI、hooks連携イベント対応表 |
| `docs/security.md` | トークン認証・CSP・パストラバーサル対策 |
| `docs/detailed-design/` | 詳細設計7件 |
| `docs/mockups/control-panel.jsx` | UIモックアップ（UIの正） |
