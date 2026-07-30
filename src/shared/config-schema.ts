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

// 上限2体の単一の情報源は model-manage.ts(zod非依存の軽いモジュール)。
// **この向きでimportする**。逆向きにすると Renderer がこの定数のために Zod 一式を
// バンドルへ取り込む(model-manage.ts の注記参照)。
import { MAX_MODEL_SLOTS } from './model-manage';
// 表示サイズの範囲と配色テーマの選択肢も同じ理由で general-settings.ts(zod非依存)を正とする。
// 全体設定タブ(Renderer)とMainの検証が同じ値を使うため、スキーマ側から取り込む向きにする。
import { DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN, THEME_MODES } from './general-settings';
// ポート番号・連続失敗しきい値の範囲も同じ理由で code-settings.ts(zod非依存)を正とする。
// IPC経由の変更(モード設定タブ)はこの定数で検証済みだが、config.json の直接ロード経路
// (起動時読み込み・手動編集・破損ファイル)はこのスキーマでしか検証されないため、
// スキーマ側にも同じ範囲を適用する(reviewer指摘・2026-07-30)。
import { FAIL_STREAK_MAX, FAIL_STREAK_MIN, SERVER_PORT_MAX, SERVER_PORT_MIN } from './code-settings';

export const ModelSlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  renderType: z.enum(['live2d', 'spriteset']),
  cubismVersion: z.enum(['cubism2', 'cubism4']).optional(), // live2dのみ。'cubism4'はCubism 5モデル(model3.json形式)も含む
  baseResolution: z.object({ width: z.number(), height: z.number() }), // 形式共通・必須。spritesetはmanifest.jsonから読む。live2dは取り込み時に暫定でフォールバック(400×400)を入れ、初回描画後にRendererの実測報告(IPC.CharacterReportLive2dSize)でMainがアスペクト比を補正して書き換える(model-importer.ts / character-window.ts の normalizeLive2dBaseResolution。2026-07-30決着)
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
    // real時にユーザーが会話ペインから選択する応答モデル(Opus 4.8/Sonnet 5/Haiku 4.5)。mockでは未使用(FR-3/C-23)
    model: z.string().default('claude-sonnet-5'),
    classifier: z.enum(['keyword', 'haiku']).default('keyword'), // mockでは常にkeyword(課金しない)
    classifierModel: z.string().default('claude-haiku-4-5'),
    idleTimeoutMs: z.number().positive().default(30000), // streaming無通信ウォッチドッグのしきい値
    maxRetries: z.number().int().nonnegative().default(2),
    timeout: z.number().positive().default(60000),
  }).prefault({}),

  codeAdapter: z.object({
    // 範囲は code-settings.ts の SERVER_PORT_MIN/MAX と同じ(1024〜65535)。
    serverPort: z.number().int().min(SERVER_PORT_MIN).max(SERVER_PORT_MAX).default(8765),
    watchedProjectPaths: z.array(z.string()).default([]),
  }).prefault({}),

  model: z.object({
    // clips(感情↔クリップ対応の実体)はここに持たせない。正本はモデルごとのmanifest.json
    slots: z.array(ModelSlotSchema).max(MAX_MODEL_SLOTS).default([]),
    autoSwitchByMode: z.boolean().default(false),
    manualActiveId: z.string().nullable().default(null),
  }).prefault({}),

  emotionEngine: z.object({
    reactionDurationMs: z.number().positive().default(3000),
    cooldownMs: z.number().positive().default(1500),
    idleTimeoutMs: z.number().positive().default(300000), // 無操作でsleepyへ移行するまでの時間
    // 範囲は code-settings.ts の FAIL_STREAK_MIN/MAX と同じ(1〜100)。successStreakThreshold は
    // 「連続失敗」ではなく「連続成功」のしきい値だが、0だと無意味・青天井だと事実上機能しなくなる
    // という同じ理由で同じ範囲を適用する(専用の定数を別途持つほどの違いではないため共用する)。
    failStreakThreshold: z.number().int().min(FAIL_STREAK_MIN).max(FAIL_STREAK_MAX).default(3), // Code/Chat両Adapterで共有
    successStreakThreshold: z.number().int().min(FAIL_STREAK_MIN).max(FAIL_STREAK_MAX).default(3),
  }).prefault({}),

  general: z.object({
    themeMode: z.enum(THEME_MODES).default('system'),
    // 常駐マスコットが画面を占有しすぎず視認できる範囲(モックアップのスライダーmin=20/max=100と
    // 一致させた。未決事項C6として決着・basic-design.md 6.1 = Notion正本に反映済み・2026-07-27)。
    // 値は general-settings.ts の定数を使う(同じ範囲を全体設定タブの入力検証でも使うため)。
    displaySize: z.number().min(DISPLAY_SIZE_MIN).max(DISPLAY_SIZE_MAX).default(0.5),
    windowPosition: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
    clickThrough: z.boolean().default(true),
    autostart: z.boolean().default(true),
    controlPanelCollapsed: z.boolean().default(false), // Control Panel(設定画面)側の折りたたみ状態(FR-15/C-23)。既定は展開(false)=C-21
  }).prefault({}),

  /**
   * オンボーディング(FR-14)の完了状態。detailed-design/onboarding.md の実装時TODO
   * 「完了フラグの保存先を決める(config.jsonに未定義)」への回答(#10で決定)。
   *
   * 状態から推測せず**明示的に持つ**。モデル0体・hooks未設定・mockはいずれも
   * 「正当な完了状態」であり(onboarding.md: 全ステップが必須ではない)、
   * 設定内容からは「まだ通っていない」と区別できないため。
   *
   * schemaVersion は 1 のまま上げない。既存configにこのセクションが無くても
   * `.prefault({})` と各 `.default()` が補完するので、マイグレーションを要さない
   * (未完了として扱われ、初回起動フローが1度だけ出る)。
   */
  onboarding: z.object({
    completed: z.boolean().default(false), // スキップして完了した場合も true
    completedAt: z.string().nullable().default(null), // ISO8601。未完了は null
  }).prefault({}),

  // notion / obsidian セクションは **意図的に持たない**(要件定義書10章スコープ外・C-25)。
  // 初回スキャフォールド以来フィールドだけが存在し、対応するFR・実装・UIが一切無かったため、
  // 未決事項C0の決着(2026-07-29)として削除した。実体の無い設定をconfigに残さない
  // (constraints.md「アプリが自分の状態について嘘をつかない」)。将来必要になったら
  // FRを定義してから足す。**なおこれは開発ハーネス側のObsidian Vault利用とは無関係**
  // (constraints.md「ハーネスのObsidian ≠ アプリのObsidian連携機能」)。
  //
  // 既存 config.json にこれらのキーが残っていても、Zod は既定で未知キーを破棄するため
  // 読み込みは失敗せず、ConfigStore.load() の正規化書き戻しでディスクからも消える。
  // よって schemaVersion は 1 のままでよい(マイグレーション不要)。

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
