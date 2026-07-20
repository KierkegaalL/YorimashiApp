# api.md — API・外部連携リファレンス

> 基本設計書 7章の詳細版。ローカルサーバーのエンドポイント実装、hooks連携の実装時に参照する。

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

> **`PostToolUseFailure`の実在性(実測で確認済み・#9)**: Claude Code 2.1.205のバイナリ内ヘルプ表に `| PostToolUseFailure | Tool name | Run after tool fails |` と `executePostToolUseFailureHooks` を確認した。同じ表で`PostToolUse`は「Run after **successful** tool」と定義されており、上表の「成功時のみ発火」は正しい。**この2つは必ず対で実装する**(失敗検知は`PostToolUseFailure`にのみ依存するため、片方だけ実装すると灯里は永久に失敗へ反応しない)。
>
> Claude Codeはこの他に`PermissionRequest` / `PreCompact` / `PostCompact` / `SessionStart` / `SubagentStop`等も発火するが、**上表にないイベントは受け取っても無視する**(勝手に感情へ結びつけない。追加はNotion正本の更新を伴う)。

> **`Stop`のMood緩和方法(実装時に決定・#9)**: 正本は「idle寄りに重心移動」とだけ定めていたため、**両streakの切り捨て半減**として実装した(`EmotionEngine.onSessionStop()`)。0リセットにするとMoodが実質「1ターン限りの状態」になり、閾値ちょうどのconfident/tiredがターン終了だけで必ず消える。半減なら閾値ちょうど(既定3)は`3→1`でidleへ戻る一方、積み上げた確信(6以上)は`3`が残り維持される=**強い傾きほど長く残る**。詳細な検討は`src/main/emotion-engine.ts`の同メソッドに記載。

> **`activeAdapter`によるゲート(実装時に決定・#9)**: `activeAdapter !== 'code'`の間、hooksイベントは受信して204を返すが**EmotionEngineへは適用しない**。FR-1でユーザーが「灯里が何に反応するか」を選ぶ以上、Chat選択中にCode側のイベントで感情が動くとChat AdapterのsustainされたthinkingがPreToolUseに割り込まれる等の取り合いが起きるため。
>
> **`watchedProjectPaths`による絞り込み(同)**: 空配列(既定)は**絞り込み無し=全受理**とする。空を「何も受け付けない」と解釈すると、オンボーディングを完了せずhooksだけ手で設定した利用者に対しアプリが完全に無反応になるため。判定は文字列の前方一致ではなく**ディレクトリ境界での包含**で行う(`/work/app`の設定が`/work/app-backup`に一致しないようにする)。

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

#### 実装時の決定(FR-2 / #9)

スクリプトの正本は **`src/main/code-adapter/dispatch-script.ts`**(TS内の文字列)。ファイルとして持たないのは、electron-builderのアセット同梱設定を増やさずに済み「開発では動くが配布物に入っていない」事故を避けるため。配置はオンボーディング(FR-14)が行う。

| 論点 | 決定 | 理由 |
|---|---|---|
| **jqへの依存** | **必須にしない**。あればイベント名を付与、無ければ本文を素通し | jqはmacOS標準ではない。上記のjq前提のままだと未導入環境で全イベントが黙って捨てられ、アプリが無反応になる。素通しでも**Claude Code自身が`hook_event_name`をstdin JSONに含める**(実測: 2.1.205のバイナリ内に文字列として存在)ため、受信側(`shared/hook-events.ts`の`resolveHookEventName`)が`hookEventName`/`hook_event_name`の両方を解釈すれば成立する |
| **トークンの渡し方** | スクリプトに**埋め込まない**。実行時に`<userData>/.token`を読む | 埋め込むと利用者のプロジェクト(=gitに入りうる場所)へ認証情報を書き込むことになる。security.md 3章はトークンをuserData配下0600に置くと定めている |
| **ポートの取得** | `<userData>/.port`(平文1行)を`cat`で読む。読めなければ8765 | 競合フォールバック後の実ポートに追従する必要があるが、薄いスクリプトでは`config.json`を解析できない(data.md 3章) |
| スクリプトに埋め込む値 | **userDataディレクトリのパスのみ**(秘密ではない)。環境変数`YORIMASHI_DATA_DIR`で上書き可 | 配置時に確定し、以降変わらないため |

`.token`が読めない(=アプリ未起動/未セットアップ)場合は**何もせず正常終了**する。認証なしでPOSTしても401になるだけで、利用者の作業を遅らせるだけだから。

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

## 3. WebSocketメッセージ仕様(状態配信)

| メッセージ | 方向 | 用途 |
|---|---|---|
| Mood/Reaction配信 | サーバー→クライアント | EmotionEngineの状態変化をブロードキャスト |

## 4. 外部動画生成AIサービス連携 (FR-5)

APIを直接叩かず、以下の半自動フローで完結する(特定ベンダー非依存)。

| 工程 | 担当 | 実装場所 |
|---|---|---|
| 元画像アップロード | ユーザー | Control Panel・モデル管理タブ |
| クロマグリーン合成画像の生成 | アプリ(自動、ローカル画像処理) | Electron Main |
| 動画生成(mp4/webm) | ユーザー(外部サービス) | ブラウザ(アプリ外) |
| 取り込み・色キー抜き・WebP変換 | アプリ(自動) | Electron Main |

推奨サービス(Pika・Canva等)はアプリ内で固定リンクとして案内するか、完全にツール非依存の説明に留めるかは詳細設計で確定する。

## 5. Anthropic API連携(Chat Adapter real時)

- Messages APIをstreamingで直叩き。`chatAdapter.mode === 'real'`の場合のみ。
- APIキーは`config.chatAdapter.anthropicApiKey`から取得。
- エラーハンドリング(レート制限・ネットワーク断時の挙動)は詳細設計で確定(`detailed-design/chat-adapter-errors.md`参照)。
