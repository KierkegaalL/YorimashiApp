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
 * 対称性(CLAUDE.md原則4): これはLive2D専用のヘルパで**スプライトセットに対応物を持たない=正当な非対称**。
 * スプライトセットはアニメーションWebPをブラウザネイティブ(`<img>`)で再生し、外部ランタイムを一切
 * 必要としないため(SpriteSetRenderer参照)。片方だけの実装漏れではない。
 */

export type CubismVersion = 'cubism2' | 'cubism4';

interface CubismGlobals {
  Live2DCubismCore?: unknown;
  Live2D?: unknown;
}

/** 指定バージョンのCubismランタイムが window にロード済みか。 */
export function isCubismRuntimeAvailable(cubismVersion: CubismVersion): boolean {
  const w = window as unknown as CubismGlobals;
  return cubismVersion === 'cubism4' ? w.Live2DCubismCore != null : w.Live2D != null;
}
