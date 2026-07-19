/**
 * userData配下の機密ファイル(.token / config.json / logs)のパーミッション制御。
 *
 * これらはローカルサーバーの認証トークンやAPIキー、フルパスを含むログを保持するため、
 * 所有者のみ読み書き可(0600)に締める(security.md 3章・data.md 3章)。
 */

import fs from 'node:fs';

/**
 * パスを 0600 へ締め直す(best-effort)。
 * ネットワークFS等ではchmodが無効なことがあるため、失敗してもfatalにしない
 * (機密保護はOS側のuserDataディレクトリ権限にも依存する)。
 */
export function tryChmod600(p: string): void {
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // 失敗しても続行する(上記の理由による)。
  }
}
