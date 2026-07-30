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
 * **⚠️ 実機検証で判明した経緯(2026-07-30)**: `pixi-live2d-display`の裸import(`index.es.js`)は
 * cubism2/cubism4両サブモジュールを同梱した単一バンドルで、それぞれがモジュール評価時点で
 * `if (!window.Live2D) throw ...` / `if (!window.Live2DCubismCore) throw ...` という即時ガードを
 * 持つ(実測)。当初これに気づかず「モデルが使う版だけ確認すればよい」と実装し、cubism4専用モデルの
 * ためにlive2dcubismcore.min.jsだけ配置してもcubism2ガードで落ちる実機バグを踏んだ。
 * **解決策は、裸パッケージを使わず版別サブパス(`pixi-live2d-display/cubism4` / `/cubism2`)へ
 * 切り替えること**(`load-live2d-module.ts`)。それぞれ自分のランタイムしか要求しないため、
 * この`isCubismRuntimeAvailable`の「単体判定」という当初の設計はそのまま正しく使える
 * (両方確認する必要は無くなった)。
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
