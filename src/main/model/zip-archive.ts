/**
 * zip アーカイブの安全な展開(FR-5 / FR-13。security.md 6章「対策5: モデルインポート時のzip-slip対策」)。
 *
 * **Electron 非依存**。`node:child_process` と `node:fs` だけで完結するため、GUIを伴わずに実測できる
 * (.claude/rules/build-commands.md)。
 *
 * **展開手段に macOS 標準の `unzip` を使う(依存を足さない)**:
 * - 対応OSは macOS のみ(C-01)であり、`unzip`(Info-ZIP 6.00, Apple 改変版)は標準で存在する。
 * - zip ライブラリを1つ足すと、そのライブラリ自身の zip-slip 脆弱性(adm-zip 等に前例がある)を
 *   抱え込む。**外部AI動画生成でffmpegを同梱せずChromium内蔵コーデックで賄った判断**と同じ姿勢。
 * - 文字コード・zip64 等の実装差は成熟したツールに委ねられる。
 *
 * **多層防御(この順に効かせる)**:
 *  1. **展開前**にエントリ名を列挙(`unzip -Z1`)し、`resolveWithinBase` で base の外に出るものが
 *     1つでもあれば**アーカイブごと拒否する**(1バイトも書かない)。
 *     実測では `unzip` 自身も `/abs.txt` を `abs.txt` へ、`../../escaped.txt` を `escaped.txt` へ
 *     **黙って改名して**展開先内に収める。だが「黙って直す」のは
 *     constraints.md「アプリが自分の状態について嘘をつかない」に反するため、**明示的に拒否**する。
 *  2. 展開は**隔離した一時ディレクトリ**へ行う(models 配下へ直接展開しない)。
 *  3. **展開後**に実体を走査し、**シンボリックリンクを含むアーカイブを拒否**し、
 *     **実バイト数**が上限を超えていれば拒否する(展開前の申告値 `unzip -Zt` は早期に弾くための
 *     ものでしかなく、読めないこともある。最終的な守りは実サイズ側)。
 *     zip はシンボリックリンクを保持でき、`/models/*` 配信は `stat()`(リンクを辿る)を使うため、
 *     モデルディレクトリ内に外部を指すリンクが残ると配信経路で外部ファイルを読まれうる。
 *     一時ディレクトリ段階で弾くので models 配下には決して入らない。
 *
 * 形式非依存ではない(現状 Live2D の取り込みでのみ使う)が、これは**正当な非対称**である。
 * スプライトセットは動画から生成する(spriteset-pipeline.md)ためアーカイブを受け取る導線自体が無い。
 * 将来スプライトセットが zip を受け取るなら、このモジュールをそのまま共用する。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveWithinBase } from '../local-server/safe-path';

const execFileAsync = promisify(execFile);

/** `unzip` の絶対パス。PATH 汚染の影響を受けないよう固定する。 */
const UNZIP_BIN = '/usr/bin/unzip';

/**
 * 展開後の合計サイズの上限(バイト)。zip 爆弾で userData を埋めないための保険。
 * Live2D モデルは大きくても数十MB程度で、512MB を超える正当なモデルは想定しない。
 */
export const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/** アーカイブが不正・危険なときに投げる。メッセージはそのままUIへ出せる日本語にする。 */
export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeArchiveError';
  }
}

/**
 * zip のエントリ名を列挙する(展開はしない)。
 * `unzip -Z1` は**生のエントリ名**をそのまま1行1件で出すため、`../` や絶対パスも改変されずに見える
 * (実測。だからこそ展開前の検査に使える)。
 *
 * **既知の限界(正直に明記)**: 出力を改行で区切るため、**エントリ名自体に改行を含む zip** では
 * 1件が複数行に割れて別々に検査される。ただし `..` の途中に改行が入るとファイルシステム上でも
 * 親ディレクトリ参照として機能しなくなるため、これを使って検査を迂回するのは困難と判断している。
 * 加えて展開後の走査(`inspectExtracted`)と `unzip` 自身の正規化が後段に控えるため、
 * この行分割に依存して安全性が決まる構造にはしていない。
 */
export async function listZipEntryNames(zipPath: string): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(UNZIP_BIN, ['-Z1', '--', zipPath], {
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch {
    // 壊れたzip・zipでないファイル・存在しないファイルはいずれも非0で落ちる(実測: exit 9)。
    throw new UnsafeArchiveError('zipファイルを読み取れませんでした。壊れていないか確認してください。');
  }
  return stdout.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0);
}

/**
 * 展開**前**に、アーカイブが申告する展開後サイズを読む(`unzip -Zt` の要約行)。
 * 読めなかった場合は null を返す。**その場合でも展開後に実サイズで再度チェックする**ため
 * (`extractZipSafely` の③)、上限が素通りすることはない。
 */
export async function readUncompressedSize(zipPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(UNZIP_BIN, ['-Zt', '--', zipPath]);
    // 例: "4 files, 21 bytes uncompressed, 21 bytes compressed:  0.0%"
    const m = /([\d,]+)\s+bytes\s+uncompressed/.exec(stdout);
    return m ? Number(m[1]!.replace(/,/g, '')) : null;
  } catch {
    return null;
  }
}

/**
 * zip を destDir へ**検証してから**展開する。危険なアーカイブは `UnsafeArchiveError` で拒否する。
 * destDir は呼び出し側が用意した**隔離ディレクトリ**であること(models 配下へ直接展開しない)。
 */
export async function extractZipSafely(zipPath: string, destDir: string): Promise<void> {
  const names = await listZipEntryNames(zipPath);
  if (names.length === 0) {
    throw new UnsafeArchiveError('zipファイルが空です。');
  }

  // ① 展開前の検査: 1件でも base の外に出るなら、1バイトも書かずに拒否する。
  for (const name of names) {
    if (isIgnorableEntry(name)) {
      continue;
    }
    if (resolveWithinBase(destDir, name) === null) {
      throw new UnsafeArchiveError(
        `安全でないパスを含むzipのため取り込みを中止しました(${name})。`,
      );
    }
  }

  const total = await readUncompressedSize(zipPath);
  if (total !== null && total > MAX_UNCOMPRESSED_BYTES) {
    throw new UnsafeArchiveError(
      `展開後のサイズが大きすぎます(${Math.round(total / 1024 / 1024)}MB)。取り込みを中止しました。`,
    );
  }

  // ② 隔離ディレクトリへ展開する。-o は既存を上書き(destDirは呼び出し側が作った空のtmp)。
  try {
    await execFileAsync(UNZIP_BIN, ['-q', '-o', '--', zipPath, '-d', destDir], {
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    throw new UnsafeArchiveError('zipの展開に失敗しました。壊れていないか確認してください。');
  }

  // ③ 展開後の検査: シンボリックリンクの拒否と、**実サイズ**での上限チェックを1回の走査で行う。
  //    実サイズで見るのは、展開前の申告値(`unzip -Zt`)が読めなかった場合に上限が素通りしないため。
  //    申告値は「展開前に無駄な書き込みを避ける」ための早期チェックで、こちらが最終的な守り。
  const actualBytes = inspectExtracted(destDir, destDir);
  if (actualBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new UnsafeArchiveError(
      `展開後のサイズが大きすぎます(${Math.round(actualBytes / 1024 / 1024)}MB)。取り込みを中止しました。`,
    );
  }
}

/**
 * `__MACOSX/` 配下と `.DS_Store` は macOS が付けるメタデータで、モデルの実体ではない。
 * 検査対象からも展開結果からも無視してよい(不正パスの判定でノイズにしない)。
 */
function isIgnorableEntry(name: string): boolean {
  return name.startsWith('__MACOSX/') || path.basename(name) === '.DS_Store';
}

/**
 * 展開結果を再帰的に走査し、**シンボリックリンクがあれば拒否**しつつ**実バイト数を合計**する。
 * `readdirSync(withFileTypes)` は `lstat` 相当でリンク自体を見るため、リンクを辿らない
 * (辿るとリンク先の実体サイズを数えたり、リンク先を検査対象にしてしまう)。
 */
function inspectExtracted(dir: string, baseDir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new UnsafeArchiveError(
        `シンボリックリンクを含むzipのため取り込みを中止しました(${path.relative(baseDir, full)})。`,
      );
    }
    if (entry.isDirectory()) {
      total += inspectExtracted(full, baseDir);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}
