/**
 * キーワードベースの感情分類器(FR-3/FR-4)。
 * 正本: docs/detailed-design/emotion-classification.md(辞書・重み・否定処理・同点決着すべて)。
 *
 * 位置づけ:
 * - **Chat Adapter固有**。Code Adapterはhooksイベントから直接Reactionを決めるため使わない。
 *   よって全10状態の定義(emotions.ts)とは別ファイルにする(同md 実装時TODO)。
 * - 分類対象は**Claudeの応答テキストのみ**。ユーザー入力は分類しない(要件に無い挙動を足さない)。
 * - 分類は**受信完了時に1度だけ**呼ぶ。streaming中に逐次呼ぶと「エラーが出ましたが」の時点で
 *   worriedが出て直後にproudへ飛ぶ百面相になる(同md「分類の実行点」)。
 * - 該当なし(スコア0)は **null を返す**。無理にidle等を発火させない
 *   (「反応する理由が無かった」こと自体が正しい状態)。
 * - クールダウンによる連発抑制はEmotionEngineの責務。分類器は関知しない。
 *
 * mockでも必ずこの分類器を通す(同md 論点3)。mockの固定返答は分類結果も固定になるが、
 * 既定モードがmockである以上ここが日常的に動くことで実装が腐らない。
 * **mockでHaiku分類(課金)は絶対に呼ばない**(C-08)。Haiku分類は#12でrealのオプトインとして足す。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(状態キーを返すだけ)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { REACTION_PRIORITY, type ReactionState } from './emotions';

/**
 * 分類器が出力しうる状態。全10状態のうち**5つだけ**が対象。
 * 残り5つはテキストからは分類しない(発火源が別にある。同md 論点1):
 *   idle/confident/tired = Mood層(success/failのstreak) / thinking = 送信イベント /
 *   sleepy = 無操作タイマー。
 * 「疲れました」と書かれていてもtiredにはしない(Mood層とReaction層の2層構造が崩れるため)。
 */
export type ChatReaction = Extract<
  ReactionState,
  'panic' | 'proud' | 'worried' | 'happy' | 'curious'
>;

export const CHAT_REACTIONS: readonly ChatReaction[] = [
  'panic',
  'proud',
  'worried',
  'happy',
  'curious',
];

/** [語, 重み, 否定スキャンから除外するか]。 */
type KeywordEntry = readonly [word: string, weight: number, skipNegationScan?: boolean];

/**
 * 辞書(emotion-classification.md の表をそのまま写す)。
 *
 * 重みは「その語がどれだけ単独で状態を決定づけるか」。`問題`(1)は「問題ありません」等の
 * 中立文脈にも出るため低く、`致命的`(3)はほぼ異常時にしか出ないため高い。
 *
 * **記号(！ ？)は入れない**。技術的な応答では強調や反語で頻出しノイズにしかならないことを
 * 実測で確認済み(同md)。
 *
 * 第3要素(否定スキャン除外)の意味: `申し訳ありません`・`すみません` は語そのものが「ません」を
 * 含む定型句のため、否定スキャンを一律に当てると**最も明確なworriedのシグナルが自分自身の
 * 「ません」で打ち消される**。実測で発覚した挙動であり、除外指定を外すと
 * 「申し訳ありません、失敗しました。」が無反応になる。
 */
export const KEYWORDS: Record<ChatReaction, readonly KeywordEntry[]> = {
  panic: [
    ['致命的', 3],
    ['クラッシュ', 3],
    ['緊急', 3],
    ['データが失われ', 3],
    ['危険', 2],
    ['重大', 2],
  ],
  proud: [
    ['完了しました', 3],
    ['解決しました', 3],
    ['完璧', 3],
    ['全て通り', 3],
    ['すべて通り', 3],
    ['成功', 2],
    ['通りました', 2],
  ],
  worried: [
    ['申し訳', 3, true],
    ['すみません', 3, true],
    ['エラー', 2],
    ['失敗', 2],
    ['警告', 2],
    ['問題', 1],
    ['注意', 1],
  ],
  happy: [
    ['できました', 2],
    ['いいですね', 2],
    ['ありがとう', 2],
    ['素晴らし', 2],
    ['助かり', 2],
  ],
  curious: [
    ['でしょうか', 1],
    ['どちら', 1],
    ['確認させて', 2],
    ['教えてください', 2],
  ],
};

/**
 * 否定表現。素朴なキーワード一致は日本語の否定で破綻するため
 * (実測: 「エラーは出ませんでした。」がworriedになる)、一致直後を走査して打ち消す。
 */
const NEGATION = /(ませんでし|ません|なかった|ないです|ない|無い|ず(に|、|。))/;

/**
 * 否定スキャンの窓(文字数)。**既知の限界**: 窓の外にある否定は拾えない
 * (実測の唯一の失敗例「エラーは、今回のケースに限っては出ませんでした。」)。
 * 窓を広げると無関係な否定を拾うため、これはキーワード方式の限界そのもので、
 * Haiku分類(#12でrealのオプトイン)への移行理由になる。誤ってworriedが出ても
 * 3秒でMoodへ復帰するだけなので、この限界を承知でv1はキーワード方式で始める。
 */
const NEGATION_WINDOW = 10;

/** 同語の連発は2回で頭打ち(同じ単語の繰り返しでスコアが暴走しないように)。 */
const MAX_HITS_PER_WORD = 2;

export interface ClassificationResult {
  /** 最終的に選ばれた状態。 */
  state: ChatReaction;
  /** 選ばれた状態のスコア。 */
  score: number;
  /** 全5状態のスコア(デバッグ・検証用)。 */
  scores: Record<ChatReaction, number>;
}

/**
 * 応答テキストを5状態のいずれかへ分類する。該当なし(全スコア0)なら null。
 *
 * 決着の順序(同md 論点2):
 *   1. **スコアの合計が大きいもの**。
 *   2. 同点のときだけ EmotionEngine の優先度(REACTION_PRIORITY)で決める。
 *
 * 優先度を第一基準にしないのは、優先度が本来「時間軸上で競合する複数のReactionを調停する」
 * ためのものであり、「1つのテキストが何を意味するか」を決める道具ではないため。
 * 例:「エラーは出ましたが、修正できました。完了しました。」は
 *    proud(3) > worried(2) = happy(2) で proud になる(優先度順だとworriedが勝ちうる)。
 *
 * 合計方式は長文ほどスコアが伸びるが、**状態間の相対比較しかしない**(閾値を持たない)ため
 * 問題にならない。
 */
export function classify(text: string): ClassificationResult | null {
  const scores = {} as Record<ChatReaction, number>;
  for (const reaction of CHAT_REACTIONS) {
    scores[reaction] = scoreFor(text, KEYWORDS[reaction]);
  }

  let best: ChatReaction | null = null;
  for (const reaction of CHAT_REACTIONS) {
    if (scores[reaction] === 0) {
      continue;
    }
    if (
      best === null ||
      scores[reaction] > scores[best] ||
      // 同点は優先度で決着(ここで独自の順序を作ると情報源が二重化する)。
      (scores[reaction] === scores[best] &&
        REACTION_PRIORITY[reaction] > REACTION_PRIORITY[best])
    ) {
      best = reaction;
    }
  }

  if (best === null) {
    return null;
  }
  return { state: best, score: scores[best], scores };
}

/** 1状態ぶんのスコアを合計する。 */
function scoreFor(text: string, entries: readonly KeywordEntry[]): number {
  let total = 0;
  for (const [word, weight, skipNegationScan] of entries) {
    total += countHits(text, word, skipNegationScan === true) * weight;
  }
  return total;
}

/**
 * 語の出現回数を数える(否定で打ち消されたものは数えない)。MAX_HITS_PER_WORDで頭打ち。
 */
function countHits(text: string, word: string, skipNegationScan: boolean): number {
  let hits = 0;
  let from = 0;
  while (hits < MAX_HITS_PER_WORD) {
    const at = text.indexOf(word, from);
    if (at === -1) {
      break;
    }
    from = at + word.length;
    if (skipNegationScan || !isNegated(text, from)) {
      hits += 1;
    }
  }
  return hits;
}

/** 一致直後 NEGATION_WINDOW 文字以内に否定表現があるか。 */
function isNegated(text: string, matchEnd: number): boolean {
  return NEGATION.test(text.slice(matchEnd, matchEnd + NEGATION_WINDOW));
}
