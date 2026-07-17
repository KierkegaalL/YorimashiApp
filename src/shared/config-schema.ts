/**
 * config.json のスキーマ。docs/data.md 1章が対応する設計上の正本。
 * フィールドを増減した場合は docs/data.md と docs/basic-design.md 6.1 の両方に反映すること。
 *
 * ネストした z.object() セクションは `.prefault({})` を使う(`.default({})` ではない)。
 * zod v4では `.default(v)` は入力がundefinedのときvをバリデーションなしでそのまま採用するため、
 * 内部フィールドの`.default()`が補完されない。`.prefault(v)`はvを入力として通常のパース
 * (内部defaultの適用を含む)を行う。実測で確認済み(createDefaultConfig()が空値を返す事故)。
 */

import { z } from 'zod';

export const ModelSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  renderType: z.enum(['live2d', 'spriteset']),
  cubismVersion: z.enum(['cubism2', 'cubism4']).optional(), // live2dのみ。'cubism4'はCubism 5モデル(model3.json形式)も含む
  baseResolution: z.object({ width: z.number(), height: z.number() }), // 形式共通・必須。spritesetはmanifest.jsonから、live2dはmodel3.json/model.jsonのロード時に読み取って書き込む
  installedDir: z.string(), // userData/models/<uuid> の相対パス
  mappingFile: z.string().default('manifest.json'),
  assignedAdapter: z.enum(['code', 'chat']).nullable().default(null),
});

export const AppConfigSchema = z.object({
  schemaVersion: z.literal(1),
  activeAdapter: z.enum(['code', 'chat']),

  chatAdapter: z.object({
    // 既定値は必ずmock。realへの切替はAPI課金が発生する(CLAUDE.md参照)
    mode: z.enum(['mock', 'real']).default('mock'),
    anthropicApiKey: z.string().default(''),
    model: z.string().default('claude-sonnet-5'),
    classifier: z.enum(['keyword', 'haiku']).default('keyword'), // mockでは常にkeyword(課金しない)
    classifierModel: z.string().default('claude-haiku-4-5'),
    idleTimeoutMs: z.number().default(30000), // streaming無通信ウォッチドッグのしきい値
    maxRetries: z.number().default(2),
    timeout: z.number().default(60000),
  }).prefault({}),

  codeAdapter: z.object({
    serverPort: z.number().default(8765),
    watchedProjectPaths: z.array(z.string()).default([]),
  }).prefault({}),

  model: z.object({
    // clips(感情↔クリップ対応の実体)はここに持たせない。正本はモデルごとのmanifest.json
    slots: z.array(ModelSlotSchema).max(2).default([]),
    autoSwitchByMode: z.boolean().default(false),
    manualActiveId: z.string().nullable().default(null),
  }).prefault({}),

  emotionEngine: z.object({
    reactionDurationMs: z.number().default(3000),
    cooldownMs: z.number().default(1500),
    idleTimeoutMs: z.number().default(300000), // 無操作でsleepyへ移行するまでの時間
    failStreakThreshold: z.number().default(3), // Code/Chat両Adapterで共有
    successStreakThreshold: z.number().default(3),
  }).prefault({}),

  general: z.object({
    themeMode: z.enum(['light', 'dark', 'system']).default('system'),
    displaySize: z.number().min(0.1).max(2).default(0.5),
    windowPosition: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
    clickThrough: z.boolean().default(true),
    autostart: z.boolean().default(true),
  }).prefault({}),

  notion: z.object({
    connected: z.boolean().default(false),
    requirementsPageId: z.string().nullable().default(null),
  }).prefault({}),

  obsidian: z.object({
    vaultPath: z.string().nullable().default(null),
    syncMode: z.enum(['none', 'icloud', 'git', 'obsidian-sync']).default('none'),
  }).prefault({}),

  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),
    hookEventLogPath: z.string().default('logs/hook-events.jsonl'),
    retentionDays: z.number().min(1).max(90).default(7),
    maskOnExport: z.boolean().default(true),
  }).prefault({}),

  distribution: z.object({
    macSigningIdentity: z.string().nullable().default(null),
    macNotarize: z.boolean().default(false),
    live2dCommercialLicense: z.boolean().default(false),
  }).prefault({}),
});

export type ModelSlot = z.infer<typeof ModelSlotSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

/** 全フィールドがデフォルト値を持つため、空オブジェクトのparseで初期configを得られる。 */
export function createDefaultConfig(): AppConfig {
  return AppConfigSchema.parse({ schemaVersion: 1, activeAdapter: 'code' });
}
