/**
 * Chat Adapter(FR-3)のMain↔Renderer共有契約。
 * 正本: docs/detailed-design/chat-pane.md 論点3(送信から表示までの経路)・論点4(エラーの見せ方)、
 *       lipsync.md 論点4(mockも擬似streamingで流す)、chat-adapter-errors.md。
 *
 * **APIキーを扱うのはMainのみ**(security.md 5章)。Rendererは本文とイベントだけを受け取り、
 * `anthropicApiKey`・SDKクライアント・モデル選択の実体には一切触れない。
 *
 * 会話履歴は**永続化しない**(C-22)。ここで定義するのは「1回の送信に対する実況」の型であり、
 * 履歴そのものはRendererのメモリ上にしか存在しない。保持期間・パーミッション・削除UI・
 * エクスポート時のマスクのいずれも未決のまま永続化を始めると、最も機微なデータが最も無管理に
 * 溜まるため(chat-pane.md 論点2)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(会話ペインはキャラ描画を持たず、
 * EmotionEngineへtrigger/releaseを送るだけ)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

/** 応答の生成元。UIが「これはmockの固定返答である」と明示するために使う。 */
export type ChatOrigin = 'mock' | 'real';

/**
 * 失敗の種別。UIはこれに応じて添えるボタンを変える(chat-pane.md 論点4)。
 * **mockへの自動フォールバックはしない**(chat-adapter-errors.md 論点4)。ボタンを添えて
 * ユーザーが明示的に押したときだけ切り替える。黙って落とすと、ユーザーの質問に対して
 * あらかじめ用意された固定文がClaudeの回答であるかのように返ることになる。
 */
export type ChatErrorKind =
  /** リトライを尽くして失敗(429/5xx/通信断)。灯里はpanic。「モックモードに切り替える」ボタン。 */
  | 'retry-exhausted'
  /** 401/400/404 等のリトライ不能な設定ミス。灯里はworried。「モード設定を開く」ボタン。 */
  | 'configuration'
  /** 無通信ウォッチドッグが切った。灯里はpanic。再送ボタン。 */
  | 'idle-timeout'
  /** まだ実装されていない経路(現時点ではreal=#12)。**mockで代替せず、そのまま失敗を返す**。 */
  | 'not-implemented';

/** UIがエラー吹き出しに添えるアクション(chat-pane.md 論点4の表)。 */
export type ChatErrorAction = 'switch-to-mock' | 'open-adapter-settings' | 'retry' | 'none';

/**
 * 1回の送信に対してMainからRendererへ流れるイベント。
 * `start` → `chunk`* → (`done` | `error` | `aborted`) で必ず終端する。
 *
 * **不変条件(Renderer側の実装が依存している)**:
 *  1. `start` は必ず最初に、他のどのイベントよりも先に届く。Main側は streaming 本体の
 *     `try` に入った直後・最初の await より前に同期的に送出する(chat-adapter.ts runStream)。
 *     Rendererはこれを前提に「start で吹き出しを作り、以降のチャンクをそこへ追記する」
 *     実装になっているため、**この順序を崩す変更をしてはならない**。
 *  2. **終端イベントは全経路で必ず1回送る**(送らないとRendererの「考えています…」が
 *     残り続ける)。Main側の`release('thinking')`と同じ理由で、成功・失敗・中断・
 *     タイムアウトのすべてで保証する。
 */
export type ChatStreamEvent =
  /** 応答の開始。Rendererはこの時点で空のアシスタント吹き出しを作る。 */
  | { type: 'start'; requestId: number; origin: ChatOrigin }
  /** 受信チャンク。Rendererは最後の吹き出しへ**追記**する(差し替えない)。 */
  | { type: 'chunk'; requestId: number; text: string }
  /**
   * 受信完了。`text`は結合済みの全文(Rendererの追記結果と一致するはずの正)。
   * `state`は受信完了時に1度だけ実行した分類結果(該当なしならnull。emotion-classification.md)。
   */
  | { type: 'done'; requestId: number; text: string; state: string | null }
  /** ユーザーが停止ボタンで中断した。`text`はそこまでに受信済みの本文。 */
  | { type: 'aborted'; requestId: number; text: string }
  /** 失敗。`message`はそのままUIに出す文言(Mainが状況に応じて出し分ける)。 */
  | { type: 'error'; requestId: number; kind: ChatErrorKind; message: string; action: ChatErrorAction };

/**
 * 送信要求に対するMainの即時応答(streamの中身ではなく受理可否)。
 * `adapterSwitched`は案1(C-24)の明示に使う: 送信時に`activeAdapter`をChatへ自動切替した場合、
 * **黙って切り替えず**Rendererがその旨を会話ペインに表示する。
 */
export interface ChatSendAccepted {
  requestId: number;
  /** この送信のために activeAdapter を 'code' → 'chat' へ自動切替したなら true(C-24)。 */
  adapterSwitched: boolean;
}

/** 会話ペインの入力欄が扱える最大文字数(過大な入力でMainを詰まらせない防御)。 */
export const MAX_CHAT_INPUT_LENGTH = 8000;

/**
 * Renderer が表示・操作するモード類。**正本は config(Main)** で、Rendererのstateはその写し。
 *
 * Renderer側だけで持つと「UI上はmockなのに実際はrealへ送る」「Trayでアダプタを切り替えても
 * 会話ペインの表示が追従しない」といった食い違いが起きる。これは
 * constraints.md「アプリが自分の状態について嘘をつかない」に反するため、
 * 取得も変更も必ずMainを経由する(ChatConfigGet / ChatConfigSet / ChatConfigChanged)。
 */
export interface ChatConfigSnapshot {
  /** FR-1 のアダプタ(config.activeAdapter)。 */
  activeAdapter: 'code' | 'chat';
  /** Chat Adapter の動作モード(config.chatAdapter.mode)。既定 mock(C-08)。 */
  chatMode: 'mock' | 'real';
  /** real時にユーザーが選ぶ応答モデル(config.chatAdapter.model)。mockでは未使用(C-23)。 */
  model: string;
}

/** モード変更要求(指定したキーだけを更新する)。 */
export type ChatConfigPatch = Partial<ChatConfigSnapshot>;
