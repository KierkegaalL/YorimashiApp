/**
 * FR-4が定義する全10状態の単一の情報源。
 * FR-5のマッピング対象(Live2DのemotionMap / スプライトセットのclips)は、
 * どちらもこの配列を参照すること。状態を増減する場合はここだけを変更する。
 */

export const MOOD_STATES = ['idle', 'confident', 'tired'] as const;

export const REACTION_STATES = [
  'thinking',
  'happy',
  'proud',
  'worried',
  'panic',
  'curious',
  'sleepy',
] as const;

export const EMOTION_STATES = [...MOOD_STATES, ...REACTION_STATES] as const;

export type MoodState = (typeof MOOD_STATES)[number];
export type ReactionState = (typeof REACTION_STATES)[number];
export type EmotionState = (typeof EMOTION_STATES)[number];

/** マッピング未設定時のフォールバック先。idleのみ必須(要件定義書 C-18)。 */
export const FALLBACK_STATE: EmotionState = 'idle';

export function isMoodState(key: string): key is MoodState {
  return (MOOD_STATES as readonly string[]).includes(key);
}

export function isReactionState(key: string): key is ReactionState {
  return (REACTION_STATES as readonly string[]).includes(key);
}
