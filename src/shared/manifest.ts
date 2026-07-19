/**
 * manifest.json のスキーマ(FR-5)。感情↔クリップ/モーション対応の**正本**は各モデルの
 * manifest.json(CLAUDE.md原則3 / constraints.md 正本一覧)。config.jsonには複製しない。
 * 対応する設計正本は docs/data.md 2章。
 *
 * 形式ごとに構造が異なる(対称だが非同型):
 * - live2d: `emotionMap[state] = { motion, expression }`(data.md 2.1)。`loop`の概念を持たない
 *   (持続はEmotionEngine責務。lipsync.md ③)。
 * - spriteset: `clips[state] = { file, loop, returnTo? }`(data.md 2.2)。`loop`は素材の再生方法
 *   であり状態の寿命とは直交する(lipsync.md)。
 *
 * どちらも**全10状態のうち idle は必須**(要件定義書 C-18。他状態のフォールバック先)。
 * idle以外は欠けてよく、欠けた状態は実行時に idle へフォールバックする(resolve* 参照)。
 *
 * Main(取り込み時の検証・将来)とRenderer(描画時のロード)が同じ契約を参照するため shared に置く。
 */

import { z } from 'zod';

import { EMOTION_STATES, FALLBACK_STATE, type EmotionState } from './emotions';

/** 感情状態キーの検証(全10状態のいずれか)。 */
const EmotionKey = z.enum(EMOTION_STATES);

// ── Live2D ──────────────────────────────────────────

/**
 * 1状態ぶんのLive2Dマッピング。motion/expression とも省略・null可
 * (data.md 2.1 の panic は `{ motion: null, expression: null }`)。両方 null/未指定は
 * 「専用の割当なし」= 実行時に idle のマッピングへフォールバックする(C-18)。
 */
export const Live2dEmotionEntrySchema = z.object({
  motion: z.string().nullish(),
  expression: z.string().nullish(),
});

export const Live2dManifestSchema = z.object({
  renderType: z.literal('live2d'),
  cubismVersion: z.enum(['cubism2', 'cubism4']), // cubism4 は Cubism 5(model3.json形式)も含む
  modelFile: z.string(), // モデル定義ファイル(cubism4: *.model3.json / cubism2: *.model.json)
  // partialRecord: 全10状態のうち一部だけ割り当ててよい(idle以外は省略可。欠けたら idle へフォールバック)。
  // z.record(enum, X) はzod v4では全enumキーを必須にするため使えない(欠落を許す設計に反する)。
  emotionMap: z.partialRecord(EmotionKey, Live2dEmotionEntrySchema),
});

// ── スプライトセット ─────────────────────────────────

/**
 * 1クリップぶんのスプライトセット定義。`loop` は素材の再生方法(尽きたときつなぎ直すか止めるか)。
 * `returnTo` は一過性クリップ再生後の戻り先(状態遷移=EmotionEngine責務のヒントで、Renderer自身は
 * 使わない。遷移はWSで届く次のスナップショットが駆動する)。
 */
export const SpriteClipSchema = z.object({
  file: z.string(),
  loop: z.boolean(),
  returnTo: z.string().optional(),
});

export const SpritesetManifestSchema = z.object({
  renderType: z.literal('spriteset'),
  baseResolution: z.object({ width: z.number().positive(), height: z.number().positive() }),
  // partialRecord: idle以外は省略可(欠けたら idle へフォールバック。C-18)。z.record(enum,X)は不可(上記)。
  clips: z.partialRecord(EmotionKey, SpriteClipSchema),
});

// ── 判別ユニオン ─────────────────────────────────────

/** idle必須(C-18)を両形式で強制する superRefine。 */
function requireIdle(
  map: Partial<Record<EmotionState, unknown>>,
  ctx: z.RefinementCtx,
  field: string,
): void {
  if (map[FALLBACK_STATE] === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: `${field}.${FALLBACK_STATE} は必須です(C-18: 全状態のフォールバック先)`,
      path: [field, FALLBACK_STATE],
    });
  }
}

export const ManifestSchema = z
  .discriminatedUnion('renderType', [Live2dManifestSchema, SpritesetManifestSchema])
  .superRefine((m, ctx) => {
    if (m.renderType === 'live2d') {
      requireIdle(m.emotionMap, ctx, 'emotionMap');
    } else {
      requireIdle(m.clips, ctx, 'clips');
    }
  });

export type Live2dEmotionEntry = z.infer<typeof Live2dEmotionEntrySchema>;
export type Live2dManifest = z.infer<typeof Live2dManifestSchema>;
export type SpriteClip = z.infer<typeof SpriteClipSchema>;
export type SpritesetManifest = z.infer<typeof SpritesetManifestSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * 描画すべき状態のクリップを解決する(スプライトセット)。未割当は idle へフォールバック(C-18)。
 * idle は ManifestSchema で必須化済みのため、この関数は必ず有効なクリップを返す。
 */
export function resolveClip(manifest: SpritesetManifest, state: EmotionState): SpriteClip {
  return manifest.clips[state] ?? manifest.clips[FALLBACK_STATE]!;
}

/**
 * 描画すべき状態のモーション/表情を解決する(Live2D)。
 * 未割当、または motion/expression の両方が空(null/未指定)なら idle のマッピングへフォールバック
 * (C-18 / model-mapping-ui.md 論点2「両方nullは正当」)。
 */
export function resolveLive2dMapping(
  manifest: Live2dManifest,
  state: EmotionState,
): Live2dEmotionEntry {
  const entry = manifest.emotionMap[state];
  if (entry && (entry.motion != null || entry.expression != null)) {
    return entry;
  }
  return manifest.emotionMap[FALLBACK_STATE] ?? { motion: null, expression: null };
}
