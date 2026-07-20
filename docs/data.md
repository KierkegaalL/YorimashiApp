# data.md — データ設計リファレンス

> 基本設計書 6章の詳細版。実装時にconfig.json・manifest.jsonのフィールドを参照する際はこちらを見る。

## 1. config.json 全体スキーマ

`docs/basic-design.md` 6.1章と同一(実装時はこちらか、基本設計書か、どちらか一方を都度更新したら他方にも反映すること)。

```typescript
import { z } from 'zod';

const ModelSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  renderType: z.enum(['live2d', 'spriteset']),
  cubismVersion: z.enum(['cubism2', 'cubism4']).optional(),      // live2dのみ。'cubism4'はCubism 5モデル(model3.json形式)も含む
  baseResolution: z.object({ width: z.number(), height: z.number() }), // 形式共通・必須。spritesetはmanifest.jsonから、live2dはmodel3.json/model.jsonのロード時に読み取って書き込む
  installedDir: z.string(),                                       // userData/models/<uuid> の相対パス
  mappingFile: z.string().default('manifest.json'),
  assignedAdapter: z.enum(['code', 'chat']).nullable().default(null),
});

const AppConfigSchema = z.object({
  schemaVersion: z.literal(1),
  activeAdapter: z.enum(['code', 'chat']),

  chatAdapter: z.object({
    mode: z.enum(['mock', 'real']).default('mock'),
    anthropicApiKey: z.string().default(''),
    model: z.string().default('claude-sonnet-5'),           // real時にユーザーが選択(Opus 4.8/Sonnet 5/Haiku 4.5)。mockでは未使用(FR-3/C-23)
    classifier: z.enum(['keyword', 'haiku']).default('keyword'), // mockでは常にkeyword(課金しない)
    classifierModel: z.string().default('claude-haiku-4-5'),
    idleTimeoutMs: z.number().default(30000),                    // streaming無通信ウォッチドッグのしきい値
    maxRetries: z.number().default(2),
    timeout: z.number().default(60000),
  }),

  codeAdapter: z.object({
    serverPort: z.number().default(8765),
    watchedProjectPaths: z.array(z.string()).default([]),
  }),

  model: z.object({
    slots: z.array(ModelSlotSchema).max(2).default([]),
    autoSwitchByMode: z.boolean().default(false),
    manualActiveId: z.string().nullable().default(null),
  }),

  emotionEngine: z.object({
    reactionDurationMs: z.number().default(3000),
    cooldownMs: z.number().default(1500),
    idleTimeoutMs: z.number().default(300000),   // 無操作でsleepyへ移行するまでの時間
    failStreakThreshold: z.number().default(3),  // Code/Chat両Adapterで共有
    successStreakThreshold: z.number().default(3),
  }),

  general: z.object({
    themeMode: z.enum(['light', 'dark', 'system']).default('system'),
    displaySize: z.number().min(0.1).max(2).default(0.5),
    windowPosition: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
    clickThrough: z.boolean().default(true),
    autostart: z.boolean().default(true),
    controlPanelCollapsed: z.boolean().default(false),       // Control Panel(設定画面)側の折りたたみ状態(FR-15/C-23)。既定は展開(false)=C-21
  }),

  onboarding: z.object({
    completed: z.boolean().default(false),          // FR-14。falseの間だけ初回起動フローを表示する。スキップ完了もtrue
    completedAt: z.string().nullable().default(null), // ISO8601。未完了はnull
  }),

  notion: z.object({
    connected: z.boolean().default(false),
    requirementsPageId: z.string().nullable().default(null),
  }),

  obsidian: z.object({
    vaultPath: z.string().nullable().default(null),
    syncMode: z.enum(['none', 'icloud', 'git', 'obsidian-sync']).default('none'),
  }),

  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
    hookEventLogPath: z.string().default('logs/hook-events.jsonl'),
    retentionDays: z.number().min(1).max(90).default(7),
    maskOnExport: z.boolean().default(true),
  }),

  distribution: z.object({
    macSigningIdentity: z.string().nullable().default(null),
    macNotarize: z.boolean().default(false),
    live2dCommercialLicense: z.boolean().default(false),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
```

**設計上の注意**:
- `model.slots`に`clips`(感情↔クリップ対応の実体)を持たせない。正本は各モデルの`manifest.json`(2章参照)。
- real系フィールド(`chatAdapter.anthropicApiKey`等)は必ず安全なデフォルト値を持つこと。configファイル自体を配布物に含めても機密情報が漏れない設計にする。

## 2. manifest.json(モデルごと)

### 2.1 Live2D形式

```json
{
  "renderType": "live2d",
  "cubismVersion": "cubism4",
  "modelFile": "model3.json",
  "emotionMap": {
    "idle":      { "motion": "Idle" },
    "happy":     { "motion": "TapBody", "expression": "exp_smile" },
    "confident": { "motion": "TapBody", "expression": "exp_smile_soft" },
    "tired":     { "expression": "exp_tired" },
    "thinking":  { "expression": "exp_normal" },
    "proud":     { "expression": "exp_proud" },
    "worried":   { "expression": "exp_worried" },
    "panic":     { "motion": null, "expression": null },
    "curious":   { "expression": "exp_curious" },
    "sleepy":    { "motion": null, "expression": null }
  }
}
```

### 2.2 スプライトセット形式

```json
{
  "renderType": "spriteset",
  "baseResolution": { "width": 800, "height": 800 },
  "clips": {
    "idle":      { "file": "idle.webp",      "loop": true },
    "confident": { "file": "confident.webp", "loop": true },
    "tired":     { "file": "tired.webp",      "loop": true },
    "thinking":  { "file": "thinking.webp",   "loop": true },
    "happy":     { "file": "happy.webp",      "loop": false, "returnTo": "idle" },
    "proud":     { "file": "proud.webp",      "loop": false, "returnTo": "idle" },
    "worried":   { "file": "worried.webp",    "loop": false, "returnTo": "idle" },
    "panic":     { "file": "panic.webp",      "loop": true },
    "curious":   { "file": "curious.webp",    "loop": false, "returnTo": "idle" },
    "sleepy":    { "file": "sleepy.webp",     "loop": true }
  }
}
```

**`loop`と「状態の寿命」は直交する別概念**(detailed-design/lipsync.mdで確定)。

- **`loop`(manifest.jsonの責務)**: 素材の再生方法。クリップが状態の継続時間より短いとき、つなぎ直すか最終フレームで止めるか。
- **状態の寿命(EmotionEngineの責務)**: いつMoodへ戻るか。タイマー(`reactionDurationMs`)で戻るか、条件が解除されるまで持続するか。

| 状態 | `loop` | 寿命 | 備考 |
|---|---|---|---|
| idle / confident / tired | true | Mood(戻り先そのもの) | — |
| happy / proud / worried / curious | false + `returnTo: "idle"` | タイマー | イベントへの一過性の反応 |
| panic | true | タイマー | クリップが短ければループさせたいが、状態自体は一過性 |
| sleepy | true | **持続** | 無操作という条件が続く限り眠い。操作の検知で解除 |
| thinking | true | Code=タイマー / **Chat=持続** | 応答を待つ間ずっと考えている。応答完了で解除 |

panic と sleepy はどちらも`loop: true`だが寿命は正反対である。両者を「継続性のある状態」と一括りにできないのは、`loop`と寿命が別の軸だから。

持続する状態(sleepy / Chat中のthinking)はタイマーではなく明示的な解除で戻る。この仕組みはEmotionEngine側のAPI追加を伴う(lipsync.md参照、要Notion更新)。

## 3. ディレクトリ構成(userData配下全体)

```
<userData>/
 ├─ config.json               # パーミッション0600(real時にchatAdapter.anthropicApiKeyを保持しうるため)
 ├─ .token                    # ローカルサーバー認証トークン、パーミッション0600
 ├─ .port                     # 実際にバインドしたポート(1行の平文)。秘密ではないため0600にしない
 ├─ models/
 │   └─ <uuid>/
 │       ├─ manifest.json
 │       ├─ model3.json / *.moc3   # live2dのみ
 │       └─ idle.webp 等            # spritesetのみ
 └─ logs/
     └─ hook-events.jsonl     # パーミッション0600、retentionDaysで自動削除
```

> **`.port` を置く理由(FR-2実装時に追加)**: `dispatch.sh` は「重い処理をしない薄いスクリプト」(api.md 1.3)であり、`config.json` を解析できない。ポートは競合時に8765以外へフォールバックする(environments.md)ため、実ポートを平文1行で置き、シェルから `cat` だけで読めるようにする。**トークンを利用者のプロジェクト側へ書かない**ための前提でもある(api.md 1.3)。

## 4. hooksイベントログの1行あたりのフィールド

```typescript
interface HookLogEntry {
  hookEventName: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Notification' | 'Stop' | 'UserPromptSubmit';
  tool_name?: string;
  exit_code?: number;
  filePath?: string;   // プロジェクト名を含むフルパス。エクスポート時のみ仮名化(project-a/b等)
  timestamp: string;   // ISO8601
}
```

> **実装(#11)**: この型の実体は `src/shared/hook-log.ts`、記録・保持・仮名化は
> `src/main/logging/hook-event-log.ts`。以下は正本に明記が無く、実装時に決めてここへ書き足した事項。
>
> - **記録対象**: `CodeAdapter.handle()` の結果が `applied` と `ignored-inactive-adapter` のものだけ。
>   後者を残すのは、ログが「灯里の反応の記録」ではなく**利用者の作業の記録**だから(Chat Adapterを
>   選んでいる間も利用者は作業している)。逆に `ignored-unwatched-path` は**記録しない**——
>   利用者自身が `watchedProjectPaths` で除外したプロジェクトのフルパスを7日間残すのは、
>   除外した意図に反する。なおこの除外が実効するために、`CodeAdapter.handle()` は
>   **監視パスの判定を `activeAdapter` の判定より先に**行う(逆順だと `activeAdapter` が
>   `chat` の間は除外判定に到達せず、除外したプロジェクトのパスが記録される)。
>   `ignored-unknown-event` は `hookEventName` が上の閉じた union に無いため記録しない。
> - **`exit_code`**: Claude Code 2.1.205 のhooksドキュメントが示す stdin JSON は
>   `session_id` / `tool_name` / `tool_input` / `tool_response`(PostToolUseのみ)であり、
>   **`exit_code` は定義されていない**(実測)。付いていれば拾うが、**無いものを補わない**。
>   成否の判定は `PostToolUseFailure` というイベント名そのものが担う。
> - **`filePath`**: `tool_input.file_path` を第一候補にし(同ドキュメントの例、および本リポジトリの
>   開発用hookが同じ位置を読んでいることで確認)、無ければ `cwd` に落とす。Notification/Stop のように
>   ファイルを伴わないイベントでも、どのプロジェクトの出来事かは残すため。
> - **仮名化の規則**: `watchedProjectPaths` を既知のルートとして `project-a` / `project-b` … に置換する
>   (長いパスから照合するため入れ子でも深い方が勝つ)。どのルートにも属さないパスは
>   `project-unknown/<ファイル名>` にし、ディレクトリ部分をすべて落とす。**アプリはプロジェクトの
>   境界を知らないので推測で分類しない**(別プロジェクトが同じ仮名に潰れるのは情報の欠落であり、漏洩ではない)。
> - **`logging.hookEventLogPath` の検証**: 利用者が編集しうるため、userData 配下に解決できることを
>   毎回確認し、外を指す場合は既定値へ落として警告する(`resolveWithinBase`。security.md 6章と同じ考え方)。
> - **保持期間の適用契機**: 起動時 + 6時間ごと。常駐アプリなので起動時だけでは古い行が残り続ける。
