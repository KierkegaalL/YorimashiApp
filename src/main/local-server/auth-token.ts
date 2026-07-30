/**
 * ローカルサーバーの共有トークン管理(security.md 3章)。
 *
 * 起動時にランダムトークンを生成し、userData配下に `.token`(パーミッション0600)で保存する。
 * 既に存在すれば再利用する(端末再起動をまたいで同じトークンを使う)。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { tryChmod600 } from '../fs-permissions';

export const TOKEN_FILENAME = '.token';

/**
 * userDataDir配下の`.token`を読み込む。無ければ生成して0600で保存する。
 * 既存ファイルのパーミッションが緩い場合も0600へ締め直す(ハイジーン)。
 */
export function ensureAuthToken(userDataDir: string): string {
  const tokenPath = path.join(userDataDir, TOKEN_FILENAME);

  try {
    const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (existing.length > 0) {
      // 既存トークンでもパーミッションを0600へ締め直しておく。
      tryChmod600(tokenPath);
      return existing;
    }
    // 空ファイルは壊れているとみなして作り直す。
  } catch {
    // 未作成 → 新規生成する。
  }

  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenPath, token, { mode: 0o600 });
  // writeFileSync の mode は umask の影響を受けうるため、念のため明示的に締め直す(保険)。
  tryChmod600(tokenPath);
  return token;
}

/** 既にリクエストヘッダ等から取り出したトークンを、定数時間で照合する。 */
export function tokensMatch(expected: string, provided: string | undefined | null): boolean {
  if (typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // 長さが違うとtimingSafeEqualが例外を投げるため、先に長さで弾く。
  // 長さ自体は秘密ではない(トークン長は固定)ため早期リターンで問題ない。
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
