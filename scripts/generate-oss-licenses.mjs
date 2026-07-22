/**
 * 権利情報タブ(FR-12)の「使用しているオープンソースソフトウェア」一覧を、実際に
 * インストールされている依存の package.json から**ビルド時に自動生成**する。
 * 要件定義書 4.12 / 9章(「配布時は license-checker で自動収集」)への実装。
 *
 * 出力: src/shared/oss-licenses.ts(自動生成・手で編集しない)。`npm run generate:licenses`
 * および build/dev の pre スクリプトから実行される。生成物をコミットしておくことで、
 * typecheck・dev がこのスクリプトを都度走らせなくても解決できるようにする。
 *
 * **一覧に含める対象 = 配布物にバンドルされる JS 依存**:
 *  - 実行時 dependencies を**推移的に**辿る(react-dom → scheduler、pixi.js → @pixi/* 等、
 *    直下の依存が更に依存するパッケージも配布物へバンドルされるため。license-checker が
 *    依存ツリー全体を走査するのと同じ網羅性を、外部ツールを増やさず自前で確保する)。
 *    各パッケージの `dependencies` と**実際にインストール済みの `optionalDependencies`** を辿り、
 *    `devDependencies` のサブツリーには入らない(ビルド時にしか使われないものを配布物として列挙しない)。
 *  - **`optionalDependencies` を辿る理由(実測に基づく訂正)**: sharp のネイティブ実体は
 *    `@img/sharp-darwin-arm64`(Apache-2.0)+ `@img/sharp-libvips-darwin-arm64`(**LGPL-3.0-or-later**)
 *    という npm パッケージで、これらは sharp の `optionalDependencies`(プラットフォーム別)に置かれる。
 *    実際にインストールされる=配布物に含まれるのは実行プラットフォームぶんだけで、未インストールの
 *    ものは findPackageDir が null を返して自動的に一覧から落ちる。よって「dependencies だけ」だと
 *    sharp 本体は拾えても実体(とりわけ LGPL の libvips)を取りこぼす(spriteset-pipeline.md 論点4 が
 *    FR-12 に必須と定める分)。
 *  - `electron` 本体は**葉として1件だけ**足す(その npm パッケージの dependencies は
 *    @electron/get / extract-zip 等の**インストール時ツール**であって配布物に含まれないため
 *    辿らない)。electron-vite / vite / typescript / electron-builder 等の devDependencies も除外。
 *
 * **この生成のスコープ外(配布 NOTICE 段階で別途扱う)**:
 *  - 同梱される Electron ランタイム自身の第三者ライセンス(Chromium / Node / V8 等)。
 *    これらは npm 依存ツリーには現れず、Electron 配布物の LICENSE ファイルで提供される。
 *  - libvips **本体**(C ライブラリ)のソース開示・全文表示。npm パッケージ
 *    `@img/sharp-libvips-darwin-arm64` の package.json 由来で LGPL-3.0-or-later を**一覧には出せる**が、
 *    LGPL が求めるライセンス全文・再リンクの案内は配布 NOTICE で対応する(独立した .dylib として
 *    asar 外に置かれ差し替え可能=構成上の要件は満たす。spriteset-pipeline.md 論点4)。
 *
 * 利点: sharp 等を dependencies に足せば、その JS 依存とネイティブ実体は**手で書き換えずとも自動反映**される。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * Node の解決規則で `name` の package.json ディレクトリを探す。`fromDir` を起点に、
 * 各祖先の `node_modules/<name>` を見る(祖先自身が node_modules のときは二重に付けない)。
 * npm の巻き上げ(hoist)でルート直下に居る依存も、ネストした依存も見つけられる。
 */
function findPackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** package.json の各種ライセンス表記(SPDX文字列 / licenses配列 / license.type)を吸収する。 */
function licenseOf(manifest) {
  if (typeof manifest.license === 'string') {
    return manifest.license;
  }
  if (Array.isArray(manifest.licenses)) {
    const types = manifest.licenses.map((l) => l?.type).filter(Boolean);
    if (types.length > 0) {
      return types.join(' / ');
    }
  }
  if (manifest.license && typeof manifest.license.type === 'string') {
    return manifest.license.type;
  }
  return 'UNKNOWN';
}

/**
 * `dependencies` に宣言されているが**実際には配布物に含まれない**ことがプロジェクトで
 * 確定しているパッケージ。ここを除外ルートにすると、そこ経由でしか到達しない依存も一覧から落ちる
 * (別経路でも到達する依存は残るので、実際に同梱される分は消えない)。
 *
 * - `gh-pages`: `pixi-live2d-display` が**誤って** `dependencies` に含む(既知の prototype pollution
 *   脆弱性パッケージ)。environments.md「PixiJSのバージョン方針」に「distバンドルには痕跡がなく
 *   ランタイムには使われない」と明記済み。宣言を機械的に辿ると gh-pages とその依存 43 件が
 *   混入し、配布されないものを権利情報タブに並べることになる(法務的正確性を損なう)ため除外する。
 *   ※ 根本対応(electron-builder の files 選定で物理的に除外)は配布設定の実装時に行う。
 */
const EXCLUDED = new Set(['gh-pages']);

/**
 * dependencies + optionalDependencies の名前を返す。optionalDependencies を含めても、未インストールの
 * ものは findPackageDir が null を返して一覧から落ちるため、実際に配布される分だけが残る(冒頭参照)。
 */
function depNames(manifest) {
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})];
}

/** name -> license(null = 未インストール/未解決で一覧に出さない)。 */
const resolved = new Map();
const queue = depNames(pkg)
  .filter((name) => !EXCLUDED.has(name))
  .map((name) => ({ name, from: root }));

while (queue.length > 0) {
  const { name, from } = queue.shift();
  if (resolved.has(name) || EXCLUDED.has(name)) {
    continue;
  }
  const dir = findPackageDir(name, from);
  if (dir === null) {
    // optionalDependencies(プラットフォーム別バイナリ等)が未インストールの場合。
    // 実際に入っていない=配布物に含まれないため一覧に出さない。
    resolved.set(name, null);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  resolved.set(name, licenseOf(manifest));
  for (const child of depNames(manifest)) {
    if (!resolved.has(child) && !EXCLUDED.has(child)) {
      queue.push({ name: child, from: dir });
    }
  }
}

// electron 本体を葉として足す(その npm 依存=インストール時ツールは辿らない。冒頭参照)。
if (!resolved.has('electron')) {
  const dir = findPackageDir('electron', root);
  if (dir !== null) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    resolved.set('electron', licenseOf(manifest));
  }
}

const entries = [...resolved]
  .filter(([, license]) => license !== null)
  .map(([name, license]) => ({ name, license }))
  .sort((a, b) => a.name.localeCompare(b.name));

const header = [
  '/**',
  ' * AUTO-GENERATED — このファイルは編集しない。',
  ' * `npm run generate:licenses`(build/dev の pre スクリプトから自動実行)で再生成される。',
  ' * 生成元: scripts/generate-oss-licenses.mjs / package.json の dependencies + インストール済み optionalDependencies を推移的に辿ったもの + electron。',
  ' * 権利情報タブ(FR-12)の OSS 一覧の単一の情報源。',
  ' *',
  ' * スコープ: 配布物にバンドルされる JS 依存 + ネイティブ実体の npm パッケージ(@img/sharp-* 等)。',
  ' * 同梱 Electron ランタイム自身の第三者ライセンス(Chromium/Node 等)や、libvips 本体(C ライブラリ)の',
  ' * ソース開示・全文表示は含まない(配布 NOTICE 段階で扱う。spriteset-pipeline.md 論点4)。',
  ' */',
].join('\n');

const body = [
  'export interface OssLicense {',
  '  /** パッケージ名(npm 上の名前をそのまま出す。表示名を捏造しない)。 */',
  '  name: string;',
  '  /** SPDX ライセンス識別子。 */',
  '  license: string;',
  '}',
  '',
  `export const OSS_LICENSES: readonly OssLicense[] = ${JSON.stringify(entries, null, 2)};`,
  '',
].join('\n');

const outPath = path.join(root, 'src', 'shared', 'oss-licenses.ts');
fs.writeFileSync(outPath, `${header}\n\n${body}`);
console.log(`[generate:licenses] ${entries.length} 件を ${path.relative(root, outPath)} へ生成しました。`);
