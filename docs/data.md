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
  cubismVersion: z.enum(['cubism2', 'cubism4']).optional(),      // live2dのみ
  baseResolution: z.object({ width: z.number(), height: z.number() }).optional(), // spritesetのみ
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
    model: z.string().default('claude-sonnet-5'),
  }),

  codeAdapter: z.object({
    serverPort: z.number().default(8765),
    watchedProjectPaths: z.array(z.string()).default([]),
    failStreakThreshold: z.number().default(3),
    successStreakThreshold: z.number().default(3),
  }),

  model: z.object({
    slots: z.array(ModelSlotSchema).max(2).default([]),
    autoSwitchByMode: z.boolean().default(false),
    manualActiveId: z.string().nullable().default(null),
  }),

  emotionEngine: z.object({
    reactionDurationMs: z.number().default(3000),
    cooldownMs: z.number().default(1500),
    idleTimeoutMs: z.number().default(300000),
  }),

  general: z.object({
    themeMode: z.enum(['light', 'dark', 'system']).default('system'),
    displaySize: z.number().min(0.1).max(2).default(0.5),
    windowPosition: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
    clickThrough: z.boolean().default(true),
    autostart: z.boolean().default(true),
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
    chromeExtensionId: z.string().nullable().default(null),
    chromeStorePublished: z.boolean().default(false),
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
    "thinking":  { "file": "thinking.webp",   "loop": false, "returnTo": "idle" },
    "happy":     { "file": "happy.webp",      "loop": false, "returnTo": "idle" },
    "proud":     { "file": "proud.webp",      "loop": false, "returnTo": "idle" },
    "worried":   { "file": "worried.webp",    "loop": false, "returnTo": "idle" },
    "panic":     { "file": "panic.webp",      "loop": true },
    "curious":   { "file": "curious.webp",    "loop": false, "returnTo": "idle" },
    "sleepy":    { "file": "sleepy.webp",     "loop": true }
  }
}
```

Mood(idle/confident/tired)は`loop: true`、Reaction(thinking/happy/proud/worried/curious)は`loop: false`+`returnTo: "idle"`が基本パターン。panic/sleepyはReactionだが継続性のある状態なのでループ扱いとする(実装時に要再検証、詳細設計で確定)。

## 3. ディレクトリ構成(userData配下全体)

```
<userData>/
 ├─ config.json
 ├─ .token                    # ローカルサーバー認証トークン、パーミッション0600
 ├─ models/
 │   └─ <uuid>/
 │       ├─ manifest.json
 │       ├─ model3.json / *.moc3   # live2dのみ
 │       └─ idle.webp 等            # spritesetのみ
 └─ logs/
     └─ hook-events.jsonl     # パーミッション0600、retentionDaysで自動削除
```

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
