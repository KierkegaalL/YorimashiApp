# api.md — API・外部連携リファレンス

> 基本設計書 7章の詳細版。ローカルサーバーのエンドポイント実装、hooks連携、拡張機能連携の実装時に参照する。

## 1. Claude Code hooks連携 (FR-2)

### 1.1 対応イベント一覧

| イベント | トリガーするEmotionEngine呼び出し | 備考 |
|---|---|---|
| PreToolUse | `engine.trigger('thinking')` | ツール実行前 |
| PostToolUse | `engine.onToolResult(true)` | ツール実行成功時のみ発火(仕様上、失敗時は別イベント) |
| PostToolUseFailure | `engine.onToolResult(false)` | ツール実行失敗時 |
| Notification | `engine.trigger('curious')` | 権限確認・入力待ち等 |
| Stop | Moodをidle寄りに重心移動 | セッション区切り。Reactionには影響しない |
| UserPromptSubmit | `engine.trigger('curious', { cooldownMs: 500 })` | クールダウンを短めに設定 |

### 1.2 `.claude/settings.json`(hooks設定・アプリのユーザー側に案内するテンプレート)

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh PreToolUse" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh PostToolUse" }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh PostToolUseFailure" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh Notification" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh Stop" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh UserPromptSubmit" }] }
    ]
  }
}
```

> 注: これは**アプリの利用者側**が自分のプロジェクトに設置するテンプレート。このリポジトリ自身の開発用hooks(`.claude/settings.json`、フック層)とは別物(CLAUDE.md参照)。

### 1.3 `dispatch.sh`の要件

- stdinのJSONをそのままローカルサーバーへPOSTする薄いスクリプト。重い処理をしない。
- 必ず`exit 0`。curlは`-m 2`でタイムアウト、失敗してもアプリ側の動作をブロックしない(非同期・非ブロッキング)。
- `$(echo "$INPUT" | jq -c --arg ev "$EVENT_NAME" '. + {hookEventName: $ev}')` のようにイベント名を付与してPOSTする。

## 2. ローカルサーバーAPI一覧

| メソッド/パス | 用途 | 認証 | 備考 |
|---|---|---|---|
| POST /hook | hooksイベント受信 | 必須(`X-App-Token`ヘッダ) | dispatch.shから呼ばれる |
| GET /panel | Control PanelのHTML配信 | 不要 | トークンはHTML内`<script>`にサーバー側で埋め込み |
| GET /character | キャラ表示用HTML配信 | 不要 | 同上 |
| GET /models/* | モデルアセット配信(画像・moc3等) | 必須 + パス検証 | パストラバーサル対策必須(security.md参照) |
| WS /ws?token=... | Mood/Reaction配信、viewer制御 | 必須(クエリでトークン付与) | upgrade時に検証 |

### 2.1 認証ミドルウェアの考え方

```typescript
function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers['x-app-token'];
  return header === authToken;
}
```

`/panel`・`/character`はHTMLの入れ物を返すだけなので認証不要。ただしHTML内に埋め込むトークンは、別オリジンの悪意あるサイトがiframeで埋め込んでも同一オリジンポリシーにより読み取れない(security.md参照)。

## 3. WebSocketメッセージ仕様(表示排他制御・状態配信)

| メッセージ | 方向 | 用途 |
|---|---|---|
| `viewer:hello` | クライアント→サーバー | 接続時に自己申告(`{ viewer: 'desktop' \| 'extension' }`) |
| `viewer:claim` | クライアント→サーバー | 手動で表示権を取得 |
| `viewer:visibility` | サーバー→クライアント | 表示/非表示の通知(`{ visible: boolean }`) |
| Mood/Reaction配信 | サーバー→クライアント | EmotionEngineの状態変化をブロードキャスト |

サーバーは`activeViewer`を保持し、後から`hello`/`claim`した方を優先する。切断時は残った方へ自動復帰する。

## 4. ブラウザ拡張機能連携 (FR-8)

### 4.1 マニフェスト(Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "ヨリマシ.app Panel",
  "version": "0.1.0",
  "permissions": ["sidePanel", "tabs"],
  "host_permissions": ["http://localhost:8765/*", "https://claude.ai/*"],
  "background": { "service_worker": "background.js" },
  "action": {}
}
```

### 4.2 claude.aiタブでのみ有効化するロジック

```javascript
function isClaudeAi(url) {
  try { return new URL(url).hostname === 'claude.ai'; } catch { return false; }
}
async function syncPanel(tabId, url) {
  await chrome.sidePanel.setOptions({ tabId, path: 'panel.html', enabled: isClaudeAi(url ?? '') });
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.url) syncPanel(tabId, info.url); });
```

## 5. 外部動画生成AIサービス連携 (FR-5)

APIを直接叩かず、以下の半自動フローで完結する(特定ベンダー非依存)。

| 工程 | 担当 | 実装場所 |
|---|---|---|
| 元画像アップロード | ユーザー | Control Panel・モデル管理タブ |
| クロマグリーン合成画像の生成 | アプリ(自動、ローカル画像処理) | Electron Main |
| 動画生成(mp4/webm) | ユーザー(外部サービス) | ブラウザ(アプリ外) |
| 取り込み・色キー抜き・WebP変換 | アプリ(自動) | Electron Main |

推奨サービス(Pika・Canva等)はアプリ内で固定リンクとして案内するか、完全にツール非依存の説明に留めるかは詳細設計で確定する。

## 6. Anthropic API連携(Chat Adapter real時)

- Messages APIをstreamingで直叩き。`chatAdapter.mode === 'real'`の場合のみ。
- APIキーは`config.chatAdapter.anthropicApiKey`から取得。
- エラーハンドリング(レート制限・ネットワーク断時の挙動)は詳細設計で確定(`detailed-design/chat-adapter-errors.md`参照)。
