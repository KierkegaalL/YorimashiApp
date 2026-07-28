/**
 * Chat Adapter の real モード(FR-3)。Anthropic Messages API へ実接続する。
 * 正本: docs/detailed-design/chat-adapter-errors.md(論点1〜4)、api.md 5章。
 *
 * **このファイルは Electron に依存しない**。`net.isOnline()` は呼び出し側から関数として
 * 注入する(下記 `isOnline`)。理由は hook-event-log.ts と同じで、GUIを開けない環境でも
 * モックサーバー相手に実挙動を検証できるようにするため(constraints.md「サンドボックスで
 * 可能な検証」)。Electron依存を1つでも持ち込むと、この経路は推測でしか書けなくなる。
 *
 * **APIキーを扱うのはMainのみ**(security.md 5章)。キーはこの関数の引数までしか流れず、
 * 例外メッセージにも載せない(下記 `describeApiError` はSDKの文言をそのまま使わない)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(テキストを受信するだけ)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 *
 * ## 実測に基づく設計(SDK 0.112.3 で再確認。設計時の実測は 0.112.1)
 *
 * 1. **SDKの`timeout`は凍ったstreamに効かない**。ヘッダ受信までしかカバーせず、その後
 *    streamが無通信になっても中断しない。既定は600000ms(10分)でしかもリトライ対象のため
 *    最悪30分ハングし、灯里は`thinking`のまま二度と戻らない。よって
 *    **`AbortSignal`による無通信ウォッチドッグが必須**(chat-adapter-errors.md 論点3)。
 * 2. **壁時計の締切(`AbortSignal.timeout`)では駄目**。Nを超える正当な長文応答まで殺す。
 *    必要なのは「Nミリ秒のあいだ1チャンクも来なかったら中断」=受信のたびに延命するタイマー。
 * 3. **`APIConnectionError` は `APIError` のサブクラス**(本ファイル作成時に 0.112.3 で再確認)。
 *    `catch`で`APIError`を先に判定するとネットワークエラーを取りこぼすため、
 *    **具体的なクラスから順に並べる**(下記 `classifyError` の順序を入れ替えないこと)。
 * 4. **529は`InternalServerError`クラスで飛ぶ**(500と同じクラス)。区別は`e.type`で行う。
 *    ただし本アプリはどちらも同じ扱い(リトライ尽き=panic)なので分岐はしていない。
 * 5. リトライ・`retry-after`の尊重はSDKが実装済み。**自前でバックオフを書かない**(論点1)。
 */

import Anthropic from '@anthropic-ai/sdk';

import type { ChatErrorAction, ChatErrorKind, ChatTurn, ChatUsage } from '../../shared/chat';

/**
 * 応答の最大トークン数。Messages API の必須パラメータだが **config には足さない**。
 * スキーマの追加は basic-design.md 6.1(Notion正本)の変更を伴い、会話ペインの1往復の
 * 長さのためにそれを行う理由が無いため(mock-responder.ts の chunk 設定と同じ判断)。
 * 4096 は会話ペイン(幅560pxの読み物)で長すぎず、途中で切れて見える事故も起きにくい値。
 */
export const REAL_MAX_TOKENS = 4096;

/**
 * **システムプロンプトを付けない**(正本に無いものを勝手に作らない)。
 *
 * このアプリの real モードは要件定義書4.3で「Anthropic APIに実接続する」とだけ定義されており、
 * 灯里としてロールプレイさせるという記述はどこにも無い。灯里が担うのは**応答に対する感情表現**
 * (EmotionEngine)であって、応答そのものの人格ではない。ここで独自のペルソナを注入すると、
 * 「Claudeと話している」というユーザーの理解と実際の挙動がずれる(constraints.md
 * 「アプリが自分の状態について嘘をつかない」)。ペルソナが要るなら要件側で決めること。
 */

/** real 経路が投げる、UIへそのまま出せる形の失敗。 */
export class RealChatError extends Error {
  readonly kind: ChatErrorKind;
  readonly action: ChatErrorAction;

  constructor(kind: ChatErrorKind, message: string, action: ChatErrorAction) {
    super(message);
    this.name = 'RealChatError';
    this.kind = kind;
    this.action = action;
  }
}

/** SDKクライアントのうち本モジュールが使う部分だけ(検証でモックを差し込めるようにする)。 */
export interface AnthropicLike {
  messages: {
    stream: (
      params: Record<string, unknown>,
      options: { signal: AbortSignal },
    ) => AnthropicStreamLike;
  };
}

export interface AnthropicStreamLike {
  on: (event: 'text', listener: (text: string) => void) => unknown;
  finalMessage: () => Promise<{ usage?: { input_tokens?: number; output_tokens?: number } }>;
}

export interface RealResponderParams {
  apiKey: string;
  model: string;
  /** 無通信ウォッチドッグのしきい値(config.chatAdapter.idleTimeoutMs。既定30000)。 */
  idleTimeoutMs: number;
  /** SDKのリトライ回数(config.chatAdapter.maxRetries。既定2=SDK既定のまま)。 */
  maxRetries: number;
  /** ヘッダすら返らない場合の保険(config.chatAdapter.timeout。既定60000)。 */
  timeout: number;
  /** 直近のユーザー発話までを含む会話履歴(末尾は必ず user)。 */
  turns: readonly ChatTurn[];
  onChunk: (chunk: string) => void;
  /** ユーザーの停止ボタン由来の中断シグナル。無通信中断とは**区別する**(下記)。 */
  signal: AbortSignal;
  /**
   * `net.isOnline()`。**接続可否の事前判定には使わない**(chat-adapter-errors.md 論点2:
   * 真でも api.anthropic.com に到達できるとは限らず、判定が二重化する)。
   * 用途は**エラー文言の出し分けのみ**で、制御フローは変えない。
   */
  isOnline: () => boolean;
  /** 検証でモックを差し込むための注入口。未指定なら実SDKクライアントを作る。 */
  createClient?: (options: { apiKey: string; maxRetries: number; timeout: number }) => AnthropicLike;
}

export interface RealChatResult {
  text: string;
  usage: ChatUsage | null;
}

/**
 * real の応答を streaming で受信する。チャンクごとに `onChunk` を呼び、全文と使用量を返す。
 *
 * - ユーザーが停止した場合は **`signal.reason` をそのまま throw** する(呼び出し側が
 *   `signal.aborted` を見て `aborted` イベントへ変換する。chat-adapter.ts runStream)。
 * - それ以外の失敗は `RealChatError` に正規化して throw する。
 */
export async function streamRealReply(params: RealResponderParams): Promise<RealChatResult> {
  const apiKey = params.apiKey.trim();
  if (apiKey.length === 0) {
    // 送る前に落とす。キー未設定は必ず401になるので、課金も往復も無駄に発生させない。
    // **mockの固定返答で代替しない**(chat-adapter-errors.md 論点4)。
    throw new RealChatError(
      'configuration',
      'APIキーが設定されていません。モード設定タブでAnthropicのAPIキーを入力してください。',
      'open-adapter-settings',
    );
  }
  if (params.turns.length === 0) {
    throw new RealChatError('configuration', '送信する会話がありません。', 'none');
  }

  const client = (params.createClient ?? defaultCreateClient)({
    apiKey,
    maxRetries: params.maxRetries,
    timeout: params.timeout,
  });

  // 内部の AbortController を1つ立て、「ユーザーの停止」と「無通信ウォッチドッグ」の
  // **両方**をここへ集約する。SDKへ渡せるsignalは1つで、かつ中断後は両者とも
  // APIUserAbortError として同じ形で飛んでくるため、**どちらが切ったのかを自前で覚えておく**
  // 必要がある(覚えていないと、ユーザーが押していない中断を「停止しました」と表示してしまう。
  // #8のreviewer 3周目で同種の取り違えを実際に踏んでいる)。
  const controller = new AbortController();
  let idleTimedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const armIdleTimer = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort(new Error(`idle>${params.idleTimeoutMs}ms`));
    }, params.idleTimeoutMs);
  };

  const onUserAbort = (): void => {
    clearTimeout(timer);
    controller.abort(params.signal.reason);
  };

  if (params.signal.aborted) {
    throw params.signal.reason instanceof Error ? params.signal.reason : new Error('aborted');
  }
  params.signal.addEventListener('abort', onUserAbort, { once: true });

  let received = '';
  try {
    armIdleTimer();
    const stream = client.messages.stream(
      {
        model: params.model,
        max_tokens: REAL_MAX_TOKENS,
        messages: params.turns.map((turn) => ({ role: turn.role, content: turn.content })),
      },
      { signal: controller.signal },
    );

    stream.on('text', (text: string) => {
      // **チャンク受信のたびに延命する**。これが壁時計方式との違いで、遅いが生きている
      // 長文応答(実測: 0.8秒間隔×6チャンク=合計4.8秒)を殺さずに、凍ったstreamだけ切れる。
      armIdleTimer();
      received += text;
      params.onChunk(text);
    });

    const final = await stream.finalMessage();
    return { text: received, usage: readUsage(final) };
  } catch (err) {
    // ユーザーの停止が先。ウォッチドッグと同時に成立した場合もユーザー操作を優先する
    // (ユーザーは実際に押しており、その事実のほうが表示として正しい)。
    if (params.signal.aborted) {
      throw params.signal.reason instanceof Error ? params.signal.reason : new Error('aborted');
    }
    if (idleTimedOut) {
      throw new RealChatError(
        'idle-timeout',
        `応答が${Math.round(params.idleTimeoutMs / 1000)}秒以上途切れたため中断しました。`,
        'retry',
      );
    }
    throw classifyError(err, params.isOnline);
  } finally {
    clearTimeout(timer);
    params.signal.removeEventListener('abort', onUserAbort);
  }
}

// ── 内部 ───────────────────────────────────────────

function defaultCreateClient(options: {
  apiKey: string;
  maxRetries: number;
  timeout: number;
}): AnthropicLike {
  return new Anthropic({
    apiKey: options.apiKey,
    maxRetries: options.maxRetries,
    timeout: options.timeout,
  }) as unknown as AnthropicLike;
}

function readUsage(final: {
  usage?: { input_tokens?: number; output_tokens?: number };
}): ChatUsage | null {
  const input = final.usage?.input_tokens;
  const output = final.usage?.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') {
    // **推測で埋めない**。使用量が取れないなら「取れなかった」として null を返し、
    // UI側はコンテキスト表示を出さない(mock時に誇張しないのと同じ理由。chat-pane.md 論点7)。
    return null;
  }
  return { inputTokens: input, outputTokens: output };
}

/**
 * SDKの例外を、UIに出せる `RealChatError` へ正規化する。
 *
 * **判定順を入れ替えないこと**: `APIConnectionError` は `APIError` のサブクラスなので
 * (0.112.3で再確認済み)、`APIError` を先に書くと通信断がその他のHTTPエラーに吸収される。
 *
 * 表情の割り当ては chat-adapter-errors.md 論点1の表に従う:
 * - リトライを尽くした失敗(429/5xx/通信断) → panic(ユーザーにできることが少ない)
 * - 401/400/404 等の設定ミス → worried(キーを直せば済む。panicは過剰)
 * 表情そのものは kind から chat-adapter.ts が決める(ここでは kind までを返す)。
 */
function classifyError(err: unknown, isOnline: () => boolean): RealChatError {
  // **診断用ログ(issue #15)**: UIには`chat-adapter-errors.md`の方針で一般化した文言しか出さない
  // (SDKの生のエラーをそのまま出すとAPIの内部実装に利用者を巻き込む)。だがそれだと原因の特定が
  // できないため、Main側のコンソール(開発時のターミナル/本番はElectronのログ)にだけ、
  // APIキー等の秘密を含まない範囲(status/type/エラーボディ)を残す。APIキー自体はこのオブジェクトの
  // どのフィールドにも含まれない(SDKがヘッダへ載せるのみでエラーオブジェクトへは複製しない)。
  // **将来への注意**: `err.error`(APIの検証エラーメッセージ)にはリクエスト内容の断片が
  // 含まれる可能性がゼロではない。現状は`console.error`のみで永続化されないため実害は無いが、
  // 将来Electronのログをファイルへリダイレクトする実装が入る場合は、C-22(会話履歴を
  // 永続化しない)に抵触しないか、このログの扱いを見直すこと(推測で対応を決めない)。
  if (err instanceof Anthropic.APIError) {
    console.error(
      `[chat-adapter] real接続エラー: status=${err.status ?? '不明'} type=${err.type ?? '不明'} message=${err.message}`,
      err.error,
    );
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new RealChatError(
      'configuration',
      'APIキーが受け付けられませんでした(401)。モード設定タブのAPIキーを確認してください。',
      'open-adapter-settings',
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new RealChatError(
      'configuration',
      'このAPIキーではこの操作が許可されていません(403)。',
      'open-adapter-settings',
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new RealChatError(
      'configuration',
      '指定されたモデルが見つかりませんでした(404)。応答モデルの選択を確認してください。',
      'open-adapter-settings',
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new RealChatError(
      'configuration',
      'リクエストが受け付けられませんでした(400)。設定を確認してください。',
      'open-adapter-settings',
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new RealChatError(
      'retry-exhausted',
      'レート制限に達しました(429)。再試行しましたが解消しませんでした。',
      'switch-to-mock',
    );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    // **`net.isOnline()` は文言の出し分けにのみ使う**(論点2)。制御フローは変えない。
    return new RealChatError(
      'retry-exhausted',
      isOnline()
        ? 'Anthropicのサーバーに接続できませんでした。'
        : 'ネットワークに接続されていないようです。',
      'switch-to-mock',
    );
  }
  if (err instanceof Anthropic.APIError) {
    // 500/529 はここ。529(overloaded)は `type` で判別できるが、本アプリでは扱いが同じなので
    // 分岐しない(分けても表情もボタンも変わらないため、区別する意味が無い)。
    return new RealChatError(
      'retry-exhausted',
      `Anthropic APIがエラーを返しました(${err.status ?? '不明'})。再試行しましたが解消しませんでした。`,
      'switch-to-mock',
    );
  }
  return new RealChatError(
    'retry-exhausted',
    `応答の取得に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    'retry',
  );
}
