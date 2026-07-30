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
 * **⚠️ Cubism Coreの`drawables.renderOrders`→`drawOrders`リネーム対応(2026-07-30・実機検証で判明)**:
 * `pixi-live2d-display@0.4.0`の`CubismModel.getDrawableRenderOrders()`は
 * `this._model.drawables.renderOrders`を読むが、**最新のCubism Core(公式サイトから新規取得した
 * バージョン6.0.1で実機確認)ではこのプロパティ名が`drawOrders`に変わっている**(実際にCoreへ
 * `Core.Model.fromMoc(moc)`した戻り値のキー一覧を列挙して確認した。`renderOrders`はどこにも存在しない)。
 * 結果`renderOrders`が`undefined`のまま`doDrawModel()`の`renderOrder[0]`アクセスで
 * `TypeError: Cannot read properties of undefined`となり、モデルが一切描画されなかった
 * (エラーは起きず`ready`にはなる=設定・moc3・テクスチャの取得自体は全部成功しているため気づきにくい)。
 * `CubismModel.prototype.getDrawableRenderOrders`を上書きし、`renderOrders`が無ければ`drawOrders`へ
 * フォールバックする(古いCore=`renderOrders`が生きている場合はそのまま使うため後方互換も保つ)。
 * **cubism2には対応物が無い**(`CubismModel`クラス自体がCubism4専用のCore実装ラッパーで、
 * cubism2.es.jsはこのクラスを持たない=exportsにも無い。よってこのパッチはcubism4限定で正当な非対称)。
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
 * prototypeメソッドを二重に上書きしないためのガード。動的importは同一specifierで
 * モジュールインスタンスがキャッシュされるため、同じ版のモデルを2体目セットした際に
 * `loadLive2DModule`が再度呼ばれても、上書きは1回で済ませる(二重に包んでも実害は無いが、
 * 呼ぶたびに関数が1段ずつ深くラップされていくのは無駄なため避ける)。
 * `ensureTokenizedResolveURL`(`ModelSettings.prototype`)と`ensureDrawOrdersCompat`
 * (`CubismModel.prototype`)の**両方**がこの1つの`WeakSet`を共用する。プロトタイプ
 * オブジェクトそのものをキーにするためキーの衝突は起きない。
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

/**
 * `CubismModel`のprototype面。`pixi-live2d-display`の型宣言(`types/index.d.ts`)は
 * `declare class CubismModel { ... }`と`export`無しで宣言しており、**JS側の実際のexport
 * (`export { ..., CubismModel, ... }`。実測で確認済み)と型宣言が食い違っている**(ライブラリの
 * 型定義側の不備)。そのため`typeof import('pixi-live2d-display/cubism4')`経由では`CubismModel`に
 * 型付きでアクセスできず、ここだけ実行時形状を手書きしてキャストする。
 */
interface CubismModelClass {
  prototype: {
    getDrawableRenderOrders: () => Int32Array | undefined;
    _model: { drawables: { renderOrders?: Int32Array; drawOrders?: Int32Array } };
  };
}

/**
 * `CubismModel.getDrawableRenderOrders()`を上書きし、`drawables.renderOrders`が無ければ
 * `drawables.drawOrders`へフォールバックする(冒頭コメントの経緯参照)。cubism4専用。
 */
function ensureDrawOrdersCompat(mod: typeof import('pixi-live2d-display/cubism4')): void {
  const CubismModel = (mod as unknown as { CubismModel: CubismModelClass }).CubismModel;
  const proto = CubismModel.prototype;
  if (patchedPrototypes.has(proto)) {
    return;
  }
  patchedPrototypes.add(proto);
  const original = proto.getDrawableRenderOrders;
  proto.getDrawableRenderOrders = function getDrawableRenderOrdersCompat(
    this: typeof proto,
  ): Int32Array | undefined {
    const result = original.call(this);
    return result !== undefined ? result : this._model.drawables.drawOrders;
  };
}

/** 指定バージョンのモジュールを動的importし、アセットURLへ認証トークンが付くよう配線する。 */
export async function loadLive2DModule(version: CubismVersion, token: string): Promise<Live2DModule> {
  if (version === 'cubism4') {
    const mod = await import('pixi-live2d-display/cubism4');
    ensureTokenizedResolveURL(mod.ModelSettings, token);
    ensureDrawOrdersCompat(mod);
    return mod;
  }
  const mod = await import('pixi-live2d-display/cubism2');
  ensureTokenizedResolveURL(mod.ModelSettings, token);
  return mod;
}
