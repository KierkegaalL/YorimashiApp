/**
 * スプライトセット生成で、感情ごとに外部の動画生成AIへ渡すプロンプトと表示ラベル(FR-5)。
 * **UIの正本** `docs/mockups/control-panel.jsx` の `EMOTION_STATES`(prompt / label)を写したもの。
 *
 * 状態の集合そのものの単一の情報源は `src/shared/emotions.ts`(全10状態)。ここはその各状態に
 * 対する**生成用の文言**だけを持つ(状態を増やす変更はFR-4の変更=Notion正本の更新を伴う)。
 * `Record<EmotionState, ...>` にしているため、状態が増減すれば型エラーで漏れに気づける。
 *
 * Live2D には対応物を持たない(完成済みモデルのモーション名を自動マッピングするだけで、
 * 素材をAIで作らせないため)。この非対称は生成パイプラインの性質に由来する正当なもの
 * (spriteset-pipeline.md / constraints.md)。
 */

import type { EmotionState } from '../emotions';

export interface ClipPrompt {
  /** 画面に出す見出し。idle だけは必須である旨を含む(モックアップの文言どおり)。 */
  label: string;
  /** 外部AIへ渡す日本語プロンプト。ユーザーがコピーして使う。 */
  prompt: string;
}

export const CLIP_PROMPTS: Record<EmotionState, ClipPrompt> = {
  idle: { label: 'idle(必須・待機ループ)', prompt: 'まばたきと呼吸だけの、ごくわずかな揺れ' },
  confident: { label: 'confident', prompt: '明るく弾むような、軽い足取り' },
  tired: { label: 'tired', prompt: 'うつむき加減で、ゆっくりとした揺れ' },
  thinking: { label: 'thinking', prompt: '首を少しかしげて考え込む' },
  happy: { label: 'happy', prompt: '小さく弾むように微笑む' },
  proud: { label: 'proud', prompt: '胸を張って誇らしげにする' },
  worried: { label: 'worried', prompt: '眉を下げて心配そうにする' },
  panic: { label: 'panic', prompt: '肩を震わせて焦る' },
  curious: { label: 'curious', prompt: '小首をかしげて興味深そうにする' },
  sleepy: { label: 'sleepy', prompt: 'とろんとした目で、あくびをする' },
};

/**
 * 外部AI動画生成ツールにそのまま貼り付ける完成形の指示文。
 *
 * `CLIP_PROMPTS[state].prompt` は感情ごとの動きの差分だけを表す短い文言で、
 * それ単体を外部ツールに渡すと、背景やカメラまで動かされて色キー抜き
 * (spriteset-pipeline.md 手順4中段の境界連結判定)が破綻することがある。
 * ここでは色キー抜きが成立するための技術的な制約(背景・カメラの固定、
 * 被写体のフレーミング)を毎回同じ文言で前置きし、そこに感情ごとの
 * 動きの指示を続けた、外部ツールへ入力するだけで済む一続きの指示文にする。
 *
 * 「1〜3秒程度」はUX上の推奨値であり、実測や仕様上の制約ではない
 * (decode-video.ts 側で長さを検証・強制してはいない。DEFAULT_MAX_FRAMES による
 * 上限はあるが、それとは別の目安)。
 */
export function buildExternalInstruction(state: EmotionState): string {
  const { prompt } = CLIP_PROMPTS[state];
  return (
    '背景は今の単色(クロマグリーン)のまま、色も位置も変えず完全に静止させてください。' +
    'カメラも固定でパン・ズームをしないでください。キャラクター全身が画面の中央に収まったまま、' +
    `次の動きだけを加えてください: ${prompt}。動画は1〜3秒程度の短い動きにしてください。`
  );
}
