# features.md — 機能一覧・Notion要件リンク・現在のフェーズ

## Notion（要件・基本設計の正本）

| ドキュメント | URL |
|---|---|
| ヨリマシ.app（親ページ） | https://app.notion.com/p/39ecd5c5312e81eda7bff0c1463a2747 |
| **要件定義書**（正本） | https://app.notion.com/p/39ecd5c5312e81c19947f4905c032181 |
| **基本設計書**（正本） | https://app.notion.com/p/39fcd5c5312e811b938ff35e04246436 |

リポジトリ側の `docs/requirements.md` / `docs/basic-design.md` は**ミラー**。要件の追加・変更は必ずNotionを先に更新し、その後ミラーへ反映する。Notion MCP（`notion-fetch` / `notion-update-page`）で操作できる。

## 機能要件（FR-1〜FR-7, FR-10〜FR-15。FR-8・FR-9はボツにより欠番）

| FR | 機能 | 詳細設計 |
|---|---|---|
| FR-1 | アダプタ切替（Code / Chat をControl Panelホームから手動切替） | — |
| FR-2 | Code Adapter（Claude Code hooks連携。`dispatch.sh` → ローカルサーバー） | api.md 1章 |
| FR-3 | Chat Adapter（mock / real。既定mock） | chat-adapter-errors.md / emotion-classification.md / lipsync.md |
| FR-4 | EmotionEngine（Mood 3 + Reaction 7 = **全10状態**。優先度・クールダウン・streak遷移） | emotion-classification.md / lipsync.md |
| FR-5 | モデル管理（Live2D / スプライトセット、最大2体） | spriteset-pipeline.md / model-mapping-ui.md |
| FR-6 | キャラクター表示ウィンドウ（透過・枠なし・最前面・クリックスルー） | character-window.md |
| FR-7 | コントロールパネル（ホーム/モデル/モード/設定/ログ/権利 の6タブ） | model-mapping-ui.md |
| FR-10 | 設定管理（config.json、Zod、`schemaVersion`マイグレーション） | data.md 1章 |
| FR-11 | ログ管理（hooksイベントログ7日保持、仮名化エクスポート） | data.md 4章 |
| FR-12 | 権利情報表示（Live2D利用区分、外部AIのToS、OSSライセンス、フォント） | — |
| FR-13 | セキュリティ機構（127.0.0.1限定、トークン認証、CSP、パストラバーサル対策） | security.md |
| FR-14 | オンボーディング（ようこそ→モデル→モード→完了の4ステップ） | onboarding.md |
| FR-15 | 会話ペイン（Chat Adapterでの対話UI。**Control Panelと同一ウィンドウ内の左ペイン**。既定で展開、タブで折りたたみ可） | chat-pane.md |

**FR-8（ブラウザ拡張機能連携）とFR-9（表示排他制御）はボツとして削除**（要件定義書C-20）。拡張機能を実装しないため、Viewerの排他制御自体が不要になった。番号は欠番のまま維持し、詰めない。

### 全10状態（FR-4。単一の情報源）

- **Mood（緩やか）**: `idle` / `confident` / `tired` — `successStreak`/`failStreak`で遷移
- **Reaction（一過性）**: `thinking` / `happy` / `proud` / `worried` / `panic` / `curious` / `sleepy`
- **優先度**: panic > proud > worried > happy > curious > thinking > idle系
- 実装の単一の情報源は `src/shared/emotions.ts`。**11状態目を足す変更はFR-4の変更**（=Notion正本の更新）を伴う。

## 現在のフェーズ

**実装フェーズ**（2026-07-18に`develop`ブランチを作成して着手）。詳細設計8件はすべて確定済みで、**実装前に要決着だった論点・未決事項（A/B/C系）は2026-07-29に全件決着した**。

| 詳細設計 | ステータス |
|---|---|
| spriteset-pipeline.md | 確定 |
| character-window.md | 確定（ウィンドウサイズの非対称は#4で案2採用により決着） |
| model-mapping-ui.md | 確定（「検出した不整合」1〜4もすべて決着済み） |
| emotion-classification.md | 確定 |
| chat-adapter-errors.md | 確定 |
| lipsync.md | 確定（持続中のモーション再発火は#5系で決着） |
| onboarding.md | 確定 |
| chat-pane.md | 確定（`activeAdapter`との関係=C-24、折りたたみ状態の保存先=`config.general.controlPanelCollapsed`ともに決着） |

**進捗の詳細（どの機能がどこまで実装済みか、実測で確定した事項、残タスク）は [Memory.md](../../Memory.md) を単一の情報源とする。** 本ファイルに実装状況の一覧を複製すると必ず陳腐化するため、ここには置かない（過去に「実装は未着手」という記述が実態と乖離したまま残った）。

## 参照ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/requirements.md` | 要件定義書のミラー（FR-1〜FR-15（FR-8/9欠番）、非機能、セキュリティ、権利、確定事項C-01〜C-25） |
| `docs/basic-design.md` | 基本設計書のミラー（システム構成、コンポーネント、データ、外部IF） |
| `docs/data.md` | config.jsonスキーマ全体、manifest.json、ディレクトリ構成 |
| `docs/api.md` | ローカルサーバーAPI、hooks連携イベント対応表 |
| `docs/security.md` | トークン認証・CSP・パストラバーサル対策 |
| `docs/detailed-design/` | 詳細設計8件 |
| `docs/mockups/control-panel.jsx` | UIモックアップ（UIの正） |
