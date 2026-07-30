/**
 * `pixi-live2d-display`の**バージョン別サブパス**を動的importする(FR-5)。
 *
 * **⚠️ 経緯(2026-07-30・実機検証)**: 当初は裸の`'pixi-live2d-display'`(cubism2/cubism4両方の
 * サブモジュールを同梱した単一バンドル)をimportしていたが、そのバンドルは**どちらのサブモジュールも
 * モジュール評価時点で自分のランタイムグローバルが無いと即例外を投げる**ため、実際に描画する
 * モデルの版に関わらず`window.Live2D`と`window.Live2DCubismCore`の**両方**が必要になる実機バグを
 * 誘発した。
 *
 * `pixi-live2d-display`は`package.json`の`exports`でバージョン別のサブパス
 * (`pixi-live2d-display/cubism4` = `dist/cubism4.es.js`、`pixi-live2d-display/cubism2` =
 * `dist/cubism2.es.js`)も提供しており、**それぞれ自分のランタイムしか要求しない**(実測:
 * 各ファイルにもう一方のガード節が無いことを確認済み)。よって**このアプリはこちらのみを使い、
 * 裸の`'pixi-live2d-display'`は他のどこからも import しない**(Live2DRenderer.ts は型のみ
 * 参照する。型宣言はどのサブパスでも同一の`./types/index.d.ts`を指すため、型と実体のバージョンが
 * 食い違うことはない)。
 *
 * これにより、cubism4専用モデルしか使わない開発者は`live2dcubismcore.min.js`だけを配置すればよく、
 * cubism2の`live2d.min.js`は不要になる(その逆も同様)。
 */

import type { CubismVersion } from './cubism-runtime';

/**
 * このアプリが実際に使う`pixi-live2d-display`のAPI面。裸パッケージの型
 * (`typeof import('pixi-live2d-display')`)から必要な2つだけを取り出す。
 * サブパスの型宣言もこれと同一なので、動的importの戻り値は構造的にこれへ代入できる。
 */
export type Live2DModule = Pick<typeof import('pixi-live2d-display'), 'Live2DModel' | 'MotionPriority'>;

export async function loadLive2DModule(version: CubismVersion): Promise<Live2DModule> {
  return version === 'cubism4'
    ? await import('pixi-live2d-display/cubism4')
    : await import('pixi-live2d-display/cubism2');
}
