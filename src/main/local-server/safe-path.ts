/**
 * パストラバーサル対策(security.md 6・7章)。
 *
 * URLのパス断片やアーカイブのエントリ名をbaseDir配下に解決する際、`../`等で
 * baseDirの外に出るものを弾く。`GET /models/*`配信・モデルzip展開の両方で使う
 * (security.md 7章:「配信時のパス検証にも同じ考え方を適用する」)。
 */

import path from 'node:path';

/**
 * requestPath(URLデコード済みのパス断片、先頭スラッシュ有無は問わない)を
 * baseDir配下の絶対パスへ解決する。baseDirの外へ出る場合はnullを返す。
 *
 * - 先頭の`/`や`\`は取り除いてからjoinする(絶対パス指定でbaseを無視されるのを防ぐ)。
 * - NULバイトを含む入力は即座に拒否する(パス切り詰め攻撃対策)。
 * - `..`はpath.resolveで正規化されるため、解決後にbase配下か厳密判定する。
 */
export function resolveWithinBase(baseDir: string, requestPath: string): string | null {
  if (requestPath.includes('\0')) {
    return null;
  }

  const base = path.resolve(baseDir);
  const rel = requestPath.replace(/^[/\\]+/, '');
  const target = path.resolve(base, rel);

  // base自身、またはbase + セパレータ で始まるパスのみ許可する。
  // (base === target はディレクトリ自身への参照。ファイル配信では呼び出し側が
  //  ディレクトリを弾くが、パス判定としては安全側で許可しておく。)
  if (target !== base && !target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}
