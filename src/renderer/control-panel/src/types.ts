/**
 * Control Panel レンダラー内で共有するUI型。
 * config 由来の値(chatAdapter.mode 等)と最終的に接続する。折りたたみ状態のIPC連携は #7 で完了。
 * ここに残る型は当面ローカルUI状態として保持し、config/IPC 連携は Chat Adapter(#8)で行う。
 */

/** FR-1 のアダプタ切替。config には保持されず activeAdapter(basic-design 5.3)として扱う。 */
export type AdapterMode = 'code' | 'chat';

/** Chat Adapter の動作モード(config.chatAdapter.mode)。既定 mock(C-08)。 */
export type ChatMode = 'mock' | 'real';

/**
 * 会話ペインの1メッセージ(C-22: メモリのみ・永続化しない)。
 * id は描画キー用の一時値で、保存も外部送出もしない。
 */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}
