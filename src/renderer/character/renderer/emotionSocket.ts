/**
 * EmotionEngineの状態を受け取るWSクライアント(FR-4/FR-5)。ローカルサーバーの `WS /ws?token=...`
 * (local-server.ts / api.md 3章)へ接続し、届いた EmotionSnapshot を onSnapshot で流す。
 *
 * サーバーは接続直後に現在状態を1回送り、以後は変化時にブロードキャストする(local-server.ts)。
 * 切断時は指数バックオフで再接続する(キャラウィンドウの可用性: サーバー再起動やスリープ復帰で
 * 自動的につなぎ直す)。close() を明示的に呼んだ後は再接続しない。
 *
 * WebSocketコンストラクタは注入可能にしてある(既定は global の WebSocket)。ブラウザでは既定を使い、
 * Node(オフスクリーン検証)では `ws` パッケージを渡してモックサーバー相手に挙動を実測できる。
 */

import {
  WS_PATH,
  TOKEN_QUERY_KEY,
  type ServerToClientMessage,
} from '../../../shared/ws-messages';
import type { EmotionSnapshot } from '../../../shared/emotions';

/** `new (url) => WebSocketLike` を満たす最小限のWebSocket型(ブラウザ/wsパッケージ共通部分)。 */
export interface WebSocketLike {
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface EmotionSocketOptions {
  /** WSのベースURL(スキーム+ホスト+ポート、末尾スラッシュ無し)。例: `ws://127.0.0.1:8765`。 */
  wsBaseUrl: string;
  /** `/ws` 認証トークン(クエリで渡す。WSはヘッダを付けられないため。security.md)。 */
  token: string;
  /** 状態スナップショット受信時。 */
  onSnapshot: (snapshot: EmotionSnapshot) => void;
  /** 接続状態の変化(UI表示や可用性の観測に使う。任意)。 */
  onStatusChange?: (connected: boolean) => void;
  /** 再接続の基準遅延(ms)。既定1000。実遅延は指数バックオフ(最大 maxReconnectDelayMs)。 */
  reconnectDelayMs?: number;
  /** 再接続遅延の上限(ms)。既定10000。 */
  maxReconnectDelayMs?: number;
  /** WebSocket実装の注入(既定 globalThis.WebSocket)。 */
  webSocketCtor?: WebSocketCtor;
}

export class EmotionSocket {
  private readonly opts: Required<Omit<EmotionSocketOptions, 'onStatusChange'>> &
    Pick<EmotionSocketOptions, 'onStatusChange'>;
  private ws: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUser = false;

  constructor(options: EmotionSocketOptions) {
    const ctor = options.webSocketCtor ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
    if (!ctor) {
      throw new Error('WebSocket 実装がありません(webSocketCtor を渡してください)');
    }
    this.opts = {
      wsBaseUrl: options.wsBaseUrl,
      token: options.token,
      onSnapshot: options.onSnapshot,
      onStatusChange: options.onStatusChange,
      reconnectDelayMs: options.reconnectDelayMs ?? 1000,
      maxReconnectDelayMs: options.maxReconnectDelayMs ?? 10000,
      webSocketCtor: ctor,
    };
  }

  /** 接続を開始する。既に接続中なら何もしない。 */
  connect(): void {
    if (this.ws || this.closedByUser) {
      return;
    }
    const url = `${this.opts.wsBaseUrl}${WS_PATH}?${TOKEN_QUERY_KEY}=${encodeURIComponent(
      this.opts.token,
    )}`;
    const ws = new this.opts.webSocketCtor(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempts = 0;
      this.opts.onStatusChange?.(true);
    });
    ws.addEventListener('message', (ev) => this.handleMessage(ev.data));
    ws.addEventListener('error', () => {
      // error の後は通常 close が続く。close 側で再接続を扱うため、ここでは握りつぶす。
    });
    ws.addEventListener('close', () => {
      this.ws = null;
      this.opts.onStatusChange?.(false);
      this.scheduleReconnect();
    });
  }

  /** 明示的に閉じる。以後は自動再接続しない。 */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── 内部 ───────────────────────────────────────────

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') {
      return; // v1のサーバーはテキストJSONのみ送る
    }
    let msg: ServerToClientMessage;
    try {
      msg = JSON.parse(data) as ServerToClientMessage;
    } catch {
      return; // 壊れたフレームは無視(接続は維持)
    }
    if (msg && msg.type === 'emotion') {
      this.opts.onSnapshot(msg.snapshot);
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(
      this.opts.reconnectDelayMs * 2 ** this.attempts,
      this.opts.maxReconnectDelayMs,
    );
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
