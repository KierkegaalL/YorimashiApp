/**
 * dispatch.sh が接続先ポートを知るための `.port` ファイル(userData配下)。
 *
 * 背景: ローカルサーバーはポート競合時に 8765 から順に別ポートへフォールバックする
 * (environments.md)。この場合 `config.codeAdapter.serverPort` へ書き戻されるが、
 * **dispatch.sh は薄いシェルスクリプトで JSON を解析できない**(jq前提にすると
 * jq未導入の環境で機能しない。api.md 1.3)。1行のプレーンテキストを別に置くことで、
 * 依存なしに `cat` で読めるようにする。
 *
 * 秘密ではない(ポート番号のみ)ため 0600 にはしない。トークンは従来どおり `.token`(0600)。
 */

import fs from 'node:fs';
import path from 'node:path';

export const ENDPOINT_FILENAME = '.port';

/**
 * 実際にバインドできたポートを `<userData>/.port` へ書き出す。
 * 失敗しても起動を止めない(可用性NFR: この書き出しはdispatch.sh向けの利便であり、
 * アプリ本体の動作には不要)。
 */
export function writeEndpointFile(userDataDir: string, port: number): void {
  try {
    fs.writeFileSync(path.join(userDataDir, ENDPOINT_FILENAME), `${port}\n`, 'utf-8');
  } catch (err) {
    console.warn('[local-server] .port の書き出しに失敗しました:', err);
  }
}
