/**
 * Cubism外部ランタイムを実行時に `<script>` タグで読み込む(FR-5)。
 *
 * ランタイム本体(live2dcubismcore.min.js / live2d.min.js)はLive2D公式配布でnpmに無く、
 * ライセンス上このリポジトリにはコミットしない(`src/renderer/public/cubism-runtime/README.md`
 * 参照。dev-assets/live2d/ と同じ理由)。開発者が各自 Cubism SDK for Web から取得し、
 * `src/renderer/public/cubism-runtime/` へ配置する運用にする。
 *
 * 配置さえすれば、Vite の public ディレクトリ規約により**開発時・ビルド後のどちらでも
 * 同じ絶対パス**(`/cubism-runtime/<ファイル名>`)で取得できる(ビルド後は local-server.ts の
 * 「それ以外のGETはRendererの静的資産」フォールバックが `out/renderer/` から配信する)。
 * よってこのモジュール自身は「今 dev か prod か」を一切意識しない。
 *
 * **失敗を例外にしない**: ファイル未配置(404)は開発中ふつうに起こる状態であり、
 * 呼び出し側の `createRenderer.ts` が `isCubismRuntimeAvailable()` で判定して
 * 「ランタイム未導入」という正直なエラーを出す(constraints.md「嘘をつかない」)。
 * ここで例外を投げると、その正直なエラー文言より前に素の読み込み失敗が表面化してしまう。
 *
 * 対称性(CLAUDE.md原則4): これはLive2D専用で、スプライトセットには対応物を持たない
 * (`SpriteSetRenderer`は`<img>`でのブラウザネイティブ再生のみで外部ランタイムを要さないため。
 * `cubism-runtime.ts`で確認済みの非対称と同じ構造)。
 */

import { isCubismRuntimeAvailable, type CubismVersion } from './cubism-runtime';

const RUNTIME_SCRIPT_PATH: Record<CubismVersion, string> = {
  cubism4: '/cubism-runtime/live2dcubismcore.min.js',
  cubism2: '/cubism-runtime/live2d.min.js',
};

/**
 * バージョンごとの読み込みPromiseをキャッシュする(モデル切替のたびに<script>を積み増さない)。
 *
 * **`Set`ではなく`Map<..., Promise<void>>`にする理由**: 読み込み中に2件目の呼び出しが来た場合
 * (2体セットして両方Live2Dかつ同じcubismVersion、等)、「試みたかどうか」の`Set`だけだと
 * 2件目は読み込み完了を待たずに即resolveしてしまい、`isCubismRuntimeAvailable`判定が
 * 実際のロード完了より先に走って「未導入」と誤判定しうる。進行中のPromiseそのものを返せば
 * 2件目も同じ完了を待つ。
 */
const pending = new Map<CubismVersion, Promise<void>>();

/**
 * 指定バージョンのランタイムを読み込む。既に window にあれば何もしない。
 * 常に resolve する(失敗しても呼び出し側の可用性判定に委ねる。冒頭コメント参照)。
 */
export function loadCubismRuntime(version: CubismVersion): Promise<void> {
  if (isCubismRuntimeAvailable(version)) {
    return Promise.resolve();
  }
  const existing = pending.get(version);
  if (existing) {
    return existing;
  }
  const promise = new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.src = RUNTIME_SCRIPT_PATH[version];
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  pending.set(version, promise);
  return promise;
}
