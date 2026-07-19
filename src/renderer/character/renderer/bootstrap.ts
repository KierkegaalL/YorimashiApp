/**
 * character HTML に埋め込まれたブートストラップ(トークン・アクティブモデル)を読む(FR-5/FR-6)。
 * サーバーが `/character` 配信時に注入する(local-server.ts injectBootstrap / shared/bootstrap.ts)。
 *
 * prod では character ウィンドウがローカルサーバー(`http://127.0.0.1:<port>`)から読み込まれるため、
 * `window.location.origin` がそのままアセット/WSのオリジンになる。dev(Vite)では別オリジンかつ
 * トークン未注入のため、token/model は null になり「モデル未導入」表示になる(既知の dev 制約)。
 */

import {
  BOOTSTRAP_MODEL_GLOBAL,
  BOOTSTRAP_TOKEN_GLOBAL,
  type CharacterBootstrapModel,
} from '../../../shared/bootstrap';

export interface CharacterBootstrap {
  /** `/models/*`・`/ws` 認証トークン。未注入(dev等)なら null。 */
  token: string | null;
  /** HTTP配信オリジン(例: `http://127.0.0.1:8765`)。/models の取得元。 */
  httpOrigin: string;
  /** WSオリジン(例: `ws://127.0.0.1:8765`)。 */
  wsOrigin: string;
  /** 描画対象モデル。未導入なら null。 */
  model: CharacterBootstrapModel | null;
}

function readModel(raw: unknown): CharacterBootstrapModel | null {
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as CharacterBootstrapModel).installedDir === 'string' &&
    typeof (raw as CharacterBootstrapModel).mappingFile === 'string'
  ) {
    return raw as CharacterBootstrapModel;
  }
  return null;
}

export function readBootstrap(): CharacterBootstrap {
  const w = window as unknown as Record<string, unknown>;
  const token = typeof w[BOOTSTRAP_TOKEN_GLOBAL] === 'string' ? (w[BOOTSTRAP_TOKEN_GLOBAL] as string) : null;
  const model = readModel(w[BOOTSTRAP_MODEL_GLOBAL]);
  const httpOrigin = window.location.origin;
  // http→ws / https→wss。origin は必ず http(s) で始まる。
  const wsOrigin = httpOrigin.replace(/^http/, 'ws');
  return { token, httpOrigin, wsOrigin, model };
}
