/**
 * Control Panel レンダラー内で共有するUI型。
 * 折りたたみ状態のIPC連携は #7 で、モード類(activeAdapter / chatAdapter.mode)は #8 で
 * config(Main)と同期済み。**モードの正本は config** で、Renderer側のstateはその写しにすぎない
 * (shared/chat.ts の ChatConfigSnapshot を参照)。
 */

import type { ChatConfigSnapshot, ChatErrorAction, ChatOrigin } from '../../../shared/chat';

/**
 * FR-1 のアダプタ切替(config.activeAdapter。basic-design 5.3)。
 * **union を書き下さず ChatConfigSnapshot から導出する**。二重定義にすると、将来モードを
 * 増やしたときに片方だけ直しても型検査が通ってしまい、実行時に食い違う
 * (このプロジェクトが繰り返し踏んできた「片方だけ直す」事故と同種)。
 */
export type AdapterMode = ChatConfigSnapshot['activeAdapter'];

/** Chat Adapter の動作モード(config.chatAdapter.mode)。既定 mock(C-08)。同上の理由で導出する。 */
export type ChatMode = ChatConfigSnapshot['chatMode'];

/**
 * 会話ペインの1メッセージ(C-22: メモリのみ・永続化しない)。
 * id は描画キー用の一時値で、保存も外部送出もしない。
 *
 * `system`/`error` は会話の相手の発話ではなく**アプリ自身の申告**を表す:
 *  - system … 「Chatに切り替えました」等の明示(C-24 案1は黙って切り替えないことを求める)
 *  - error  … 応答の失敗。添えるボタンは `action` で決まる(chat-pane.md 論点4)
 * これらをassistantの吹き出しと同じ見た目にしないことで、灯里の発言と取り違えさせない。
 */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'error';
  text: string;
  /**
   * assistant のときの生成元。mock は**固定返答であることをUIに明示する**ために使う
   * (Claudeの回答に見せない。chat-adapter-errors.md 論点4と同じ理屈)。
   */
  origin?: ChatOrigin;
  /** 受信途中か(streaming中はカーソル等を出し、メッセージ操作ボタンを出さない)。 */
  streaming?: boolean;
  /**
   * 本文が最後まで来なかった場合の**原因**(途中までの本文であることをUIに示す)。
   *   'stopped' … ユーザーが停止ボタンで中断した
   *   'error'   … 応答が失敗して途切れた(real接続の無通信タイムアウト等)
   * 原因を区別せずに一律「中断しました」と出すと、**ユーザーが押していない停止を押したかのように
   * 表示する**ことになり、状態について嘘をつく(constraints.md)。
   */
  truncated?: 'stopped' | 'error';
  /** error のときUIが添えるアクション(chat-pane.md 論点4の表)。 */
  action?: ChatErrorAction;
}
