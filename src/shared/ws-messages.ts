/**
 * ローカルサーバー WS(/ws)でやり取りするメッセージの型(api.md 3章)。
 * Main(サーバー)とRenderer(クライアント)が同じ契約を参照するため shared に置く。
 *
 * v1ではサーバー→クライアントの一方向のみ(EmotionEngineの状態配信)。
 * クライアント→サーバーのviewer制御(api.md 2.2の「viewer制御」)は
 * 該当機能の実装時に追加する。
 */

import type { EmotionSnapshot } from './emotions';

/** サーバー→クライアント: EmotionEngineの解決済み状態を配信する。 */
export interface EmotionStateMessage {
  type: 'emotion';
  snapshot: EmotionSnapshot;
}

/** サーバー→クライアントに流れる全メッセージのユニオン。 */
export type ServerToClientMessage = EmotionStateMessage;

/** WSのパス。security.md/api.mdの `ws://localhost:<port>/ws?token=...`。 */
export const WS_PATH = '/ws';

/**
 * 認証トークンを載せるクエリキー(ヘッダを付けられない読み込み経路向け)。
 *
 * 当初はWS専用の定数だったが、`GET /models/*` でも同じ理由(PixiJSのテクスチャ読み込みが
 * `<img src>` 相当でヘッダを送れない。SpriteSetRendererがfetch→Blobにする制約と同じ)で
 * クエリトークンが要るようになったため、`local-server.ts`が両方の認証チェックで共有する
 * (security.md 3章)。
 */
export const TOKEN_QUERY_KEY = 'token';
