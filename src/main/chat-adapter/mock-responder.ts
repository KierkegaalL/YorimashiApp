/**
 * Chat Adapter の mock モード(FR-3。既定モード=C-08)。
 * 正本: docs/detailed-design/lipsync.md 論点4、要件定義書4.3(mock=固定返答・無料)。
 *
 * **なぜ固定返答をわざわざ擬似streamingで流すのか**(lipsync.md 論点4):
 * mockが即座に全文を返すと`thinking`が一瞬で終わり、**持続(sustain)→release の経路が
 * 一度も実行されない**。既定モードがmockである以上、日常の開発で最も動くのはこの経路であり、
 * realに切り替えて初めて動く状態を作らないために、mockも本番と同じ形(逐次受信)にする。
 * これにより sustain/release の往復・streaming表示のUI・分類器の実行が日常的に検証される。
 *
 * **返答がmockであることを本文で明示する**: chat-adapter-errors.md 論点4は、real失敗時に
 * 黙ってmockへ落とすことを「ユーザーの質問に対してあらかじめ用意された固定文が、Claudeの
 * 回答であるかのように返る」= アプリが自分の状態について嘘をつく行為として禁じている。
 * 同じ理屈で、mock自身の返答も**Claudeの回答に見えてはならない**。本文で mock と名乗り、
 * UI側でも origin='mock' のバッジを出す(constraints.md「嘘をつかない」)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(テキストを生成するだけ)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

/**
 * mockの固定返答。**固定**であること自体が要件(4.3)なので、ランダム化や入力に応じた
 * 出し分けはしない。文面は「これは固定返答である」と名乗ったうえで real への切替導線を示す。
 *
 * 副次的な設計意図: この文面は感情分類器(emotion-classification.md)で
 * 「どちら」(curious 1) + 「教えてください」(curious 2) = curious 3 に一致する。
 * mockの分類結果は固定になるが(同md 論点3が明記)、**分類経路が毎回実際に走る**ため
 * 実装が腐らない。分類を迂回してmockに感情を直接持たせる設計にはしない。
 */
export const MOCK_REPLY =
  '承知しました。ただいまは mock モードのため、これは固定の返答です。\n' +
  '実際の Claude に繋ぐには、モード設定タブで real に切り替えてください。' +
  'どちらにするか決まったら教えてください。';

/**
 * 1チャンクあたりの文字数と送出間隔。lipsync.md は「1文字ずつ(あるいは数文字ずつ)遅延を
 * 挟んで流す」としか定めていないため、体感が自然な範囲でここに置く。
 * **config には足さない**(スキーマの追加は basic-design.md 6.1 = Notion正本の変更を伴い、
 * mockの見た目の速度のためにそれを行う理由が無い)。
 */
export const MOCK_CHUNK_SIZE = 2;
export const MOCK_CHUNK_DELAY_MS = 30;

/** 中断可能な待機。AbortSignal で即座に抜ける(停止ボタンの応答性を保つ)。 */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * 固定返答を擬似streamingで流す。チャンクごとに onChunk を呼び、最後に全文を返す。
 *
 * 中断された場合は AbortError 相当の例外を投げる(呼び出し側が aborted イベントへ変換する)。
 * **サロゲートペア対策**: 素朴な slice はサロゲートペア(絵文字等)を分割して壊れた文字を
 * 送出しうるため、コードポイント単位([...text])で切る。
 */
export async function streamMockReply(
  onChunk: (chunk: string) => void,
  signal: AbortSignal,
  sleep: Sleep = defaultSleep,
): Promise<string> {
  const codePoints = [...MOCK_REPLY];
  let sent = '';
  for (let i = 0; i < codePoints.length; i += MOCK_CHUNK_SIZE) {
    // 最初のチャンクの前にも待つ。即座に全文が出ると擬似streamingの意味が無いため。
    await sleep(MOCK_CHUNK_DELAY_MS, signal);
    const chunk = codePoints.slice(i, i + MOCK_CHUNK_SIZE).join('');
    sent += chunk;
    onChunk(chunk);
  }
  return sent;
}
