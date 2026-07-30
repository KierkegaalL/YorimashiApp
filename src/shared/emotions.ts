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

/**
 * EmotionEngineが算出する解決済みの状態スナップショット。
 * Main(EmotionEngine)が生成し、ローカルサーバーのWS経由でRenderer
 * (CharacterRenderer / 会話ペインの憑坐状態帯)へ配信される共有契約のため、
 * shared に置く(Main/Renderer 双方が同じ型を参照する)。
 */
export interface EmotionSnapshot {
  /** 現在のMood層。 */
  mood: MoodState;
  /** 現在アクティブなReaction。無ければnull。 */
  reaction: ReactionState | null;
  /** 実際に描画すべき解決状態。reaction ?? mood。 */
  state: EmotionState;
  /** 現在のReactionがsustain付き(明示release待ち)かどうか。 */
  sustained: boolean;
}

/**
 * Reactionの優先度(大きいほど優先)。basic-design.md 5.2 の
 * 「panic > proud > worried > happy > curious > thinking > idle系」をそのまま数値化する。
 *
 * sleepyは正本の優先度チェーンに明記が無い(Reactionだが無操作タイマー起点の特殊な状態)。
 * 無操作5分で発火する性質上、あらゆるイベント由来のReactionは「操作があった」ことを意味し
 * sleepyを上書きすべきなので、Reactionの中で最下位(idle系=Moodの直上)に置く。
 * これは正本に無い判断のため明記する(黙って決めない)。
 *
 * ここ(shared)に置くのは、EmotionEngine(Main)の調停と、感情分類器
 * (emotion-classification.ts)の同点決着が**同じ順序**を使う必要があるため。
 * 片方だけ書き換えると両者の判断が食い違うので、単一の情報源にする。
 */
export const REACTION_PRIORITY: Record<ReactionState, number> = {
  panic: 6,
  proud: 5,
  worried: 4,
  happy: 3,
  curious: 2,
  thinking: 1,
  sleepy: 0,
};

/** マッピング未設定時のフォールバック先。idleのみ必須(要件定義書 C-18)。 */
export const FALLBACK_STATE: EmotionState = 'idle';

export function isReactionState(key: string): key is ReactionState {
  return (REACTION_STATES as readonly string[]).includes(key);
}
