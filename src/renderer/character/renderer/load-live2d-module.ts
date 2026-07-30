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
 *
 * **⚠️ アセット認証(2026-07-30・実機検証で解決)**: `GET /models/*` はトークン認証必須(security.md)。
 * `pixi-live2d-display`はモデル定義・moc3・motion・physics/poseを自前のXHRローダで、**テクスチャは
 * PixiJSが`<img src>`相当で**取得するため、いずれもRendererからヘッダを付ける経路が無い
 * (`SpriteSetRenderer`がfetch→Blobにする制約と同じ。CharacterRenderer.tsの`token`コメント参照)。
 * すべての相対アセットURLは`ModelSettings.resolveURL()`(XHRLoaderもテクスチャ読み込みも共通してこれを
 * 通す。実測で確認済み)を経由するため、**ここを1箇所だけ上書きしてクエリトークンを付与**すれば
 * 全アセット種別に一括で効く(ヘッダ注入のための個別ローダ差し替えより単純で安全)。最初のモデル定義
 * ファイル自体の取得は`resolveURL`を経由しない(settings構築前のため)ので、`Live2DRenderer`側で
 * URL構築時に直接クエリを付ける。
 */

import type { CubismVersion } from './cubism-runtime';
import { TOKEN_QUERY_KEY } from '../../../shared/ws-messages';

/**
 * このアプリが実際に使う`pixi-live2d-display`のAPI面。裸パッケージの型
 * (`typeof import('pixi-live2d-display')`)から必要な3つだけを取り出す。
 * サブパスの型宣言もこれと同一なので、動的importの戻り値は構造的にこれへ代入できる。
 */
export type Live2DModule = Pick<
  typeof import('pixi-live2d-display'),
  'Live2DModel' | 'MotionPriority' | 'ModelSettings'
>;

/**
 * `resolveURL`を二重に上書きしないためのガード。動的importは同一specifierで
 * モジュールインスタンスがキャッシュされるため、同じ版のモデルを2体目セットした際に
 * `loadLive2DModule`が再度呼ばれても、prototypeへの上書きは1回で済ませる
 * (二重に包むと`?token=`が付いた後の文字列へさらに`new URL()`するだけなので実害は無いが、
 * 呼ぶたびに関数が1段ずつ深くラップされていくのは無駄なため避ける)。
 */
const patchedPrototypes = new WeakSet<object>();

/**
 * `ModelSettings.resolveURL()`が返すすべての相対アセットURLへ認証トークンをクエリとして
 * 付与するよう、返り値を後処理する形で上書きする(冒頭コメント参照)。
 */
function ensureTokenizedResolveURL(modelSettings: Live2DModule['ModelSettings'], token: string): void {
  const proto = modelSettings.prototype as { resolveURL: (path: string) => string };
  if (patchedPrototypes.has(proto)) {
    return;
  }
  patchedPrototypes.add(proto);
  const original = proto.resolveURL;
  proto.resolveURL = function resolveURLWithToken(this: unknown, path: string): string {
    const resolved = original.call(this, path);
    const url = new URL(resolved);
    url.searchParams.set(TOKEN_QUERY_KEY, token);
    return url.toString();
  };
}

/** 指定バージョンのモジュールを動的importし、アセットURLへ認証トークンが付くよう配線する。 */
export async function loadLive2DModule(version: CubismVersion, token: string): Promise<Live2DModule> {
  const mod = version === 'cubism4'
    ? await import('pixi-live2d-display/cubism4')
    : await import('pixi-live2d-display/cubism2');
  ensureTokenizedResolveURL(mod.ModelSettings, token);
  return mod;
}
