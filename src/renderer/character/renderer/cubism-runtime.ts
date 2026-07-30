/**
 * Cubism外部ランタイムの存在判定(FR-5)。
 *
 * **このモジュールは `pixi-live2d-display` を import しない**のが要点。`pixi-live2d-display` は
 * ランタイム未ロードだと import した瞬間に例外を投げる(environments.md)。そのため「ランタイムが
 * あるか」を Live2DRenderer(pixiをimportする)より**手前**で判定する場所が必要で、createRenderer は
 * ここで確認してから初めて Live2DRenderer を動的 import する。
 *
 * ランタイムの出所: cubism4(Cubism 5含む)=`live2dcubismcore.min.js`(`window.Live2DCubismCore`)、
 * cubism2=`live2d.min.js`(`window.Live2D`)。いずれもLive2D公式配布でnpmに無く、リポジトリには
 * コミットしない(`src/renderer/public/cubism-runtime/README.md`)。開発者が各自配置すれば
 * `load-cubism-runtime.ts` が `<script>` タグで読み込み、この判定は true になる。未配置のままなら
 * 従来どおり false を返し、Live2D描画は「未描画(ランタイム未導入)」として正直に扱われる。
 * 配布ビルドへどう同梱するか(electron-builder設定と同様)は配布フェーズの未決事項として残る。
 *
 * **⚠️ 実機検証で判明した重要な訂正(2026-07-30)**: `pixi-live2d-display`の`import`元(裸の
 * `'pixi-live2d-display'`。`index.es.js`)は cubism2/cubism4 両方のサブモジュールを**同梱した
 * 単一バンドル**で、それぞれのサブモジュールがトップレベル(モジュール評価時点)で
 * `if (!window.Live2D) throw ...` / `if (!window.Live2DCubismCore) throw ...` という
 * **即時ガードを持つ**(実測: `node_modules/pixi-live2d-display/dist/index.es.js`)。
 * つまり**使うモデルの形式に関わらず、importした瞬間に両方のランタイムが揃っている必要がある**。
 * 「モデルが要求するバージョンだけ確認すればよい」という当初の設計は誤りだった(cubism4モデルの
 * ためにlive2dcubismcore.min.jsだけ配置しても、live2d.min.jsが無いとimportで例外になる実機バグを
 * 誘発した)。よって `isAnyCubismRuntimeUsable` は**常に両方**を確認する。
 *
 * 対称性(CLAUDE.md原則4): これはLive2D専用のヘルパで**スプライトセットに対応物を持たない=正当な非対称**。
 * スプライトセットはアニメーションWebPをブラウザネイティブ(`<img>`)で再生し、外部ランタイムを一切
 * 必要としないため(SpriteSetRenderer参照)。片方だけの実装漏れではない。
 */

export type CubismVersion = 'cubism2' | 'cubism4';

interface CubismGlobals {
  Live2DCubismCore?: unknown;
  Live2D?: unknown;
}

/** 指定バージョンのCubismランタイムが window にロード済みか(単体の判定)。 */
export function isCubismRuntimeAvailable(cubismVersion: CubismVersion): boolean {
  const w = window as unknown as CubismGlobals;
  return cubismVersion === 'cubism4' ? w.Live2DCubismCore != null : w.Live2D != null;
}

/**
 * `pixi-live2d-display` を import してよいか(= cubism2/cubism4 **両方**のランタイムが揃っているか)。
 *
 * `createRenderer.ts` は、これから描画するモデルの`cubismVersion`に関わらず**必ずこちらで判定する**
 * (冒頭の訂正参照。単体の`isCubismRuntimeAvailable`だけでは import 時の例外を防げない)。
 */
export function isAnyCubismRuntimeUsable(): boolean {
  return isCubismRuntimeAvailable('cubism4') && isCubismRuntimeAvailable('cubism2');
}
