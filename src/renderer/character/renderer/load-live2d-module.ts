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
 * **⚠️ Cubism Coreの`drawables.renderOrders`→`drawOrders`リネーム対応、および最終的な正しい修正
 * (2026-07-30・実機検証で判明・複数回の訂正を経て決着)**:
 * `pixi-live2d-display@0.4.0`の`CubismModel.getDrawableRenderOrders()`は
 * `this._model.drawables.renderOrders`を読むが、**最新のCubism Core(公式サイトから新規取得した
 * バージョン6.0.1で実機確認)ではこのプロパティが存在しない**(実際にCoreへ
 * `Core.Model.fromMoc(moc)`した戻り値のキー一覧を列挙して確認した)。結果`renderOrders`が
 * `undefined`のまま`doDrawModel()`の`renderOrder[0]`アクセスで
 * `TypeError: Cannot read properties of undefined`となり、モデルが一切描画されなかった
 * (エラーは起きず`ready`にはなる=設定・moc3・テクスチャの取得自体は全部成功しているため気づきにくい)。
 *
 * **迷走した経緯(自戒として残す)**: `drawables`には代わりに`drawOrders`という配列があり、これは
 * Cubism Editorの「描画順」欄と同じ**まばらなZ値**(`200, 300, ..., 1000`等。同値=タイが多数ある)
 * で、`doDrawModel()`が前提とする「`0`〜`drawableCount-1`の連番」ではなかった。ここで**2段階の
 * 誤った修正を経てしまった**: ①`drawOrders`を値でソートして順位へ変換する対応(連番化はできるが
 * タイの同点判定が必要になる)、②タイの同点判定に`parentPartIndices`(Cubism Partツリー上の
 * インデックス)を使う対応(実機の瞳/白目の重なり順バグは直ったが、**別の実機モデル
 * (`hiyori_pro_t11`)で口がリボン/顔パーツに覆われて表示されない新たなバグを引き起こした**。
 * 三角形レベルのラスタライズ検証で「口の全領域がリボンの三角形と100%重なり、かつ現在の順位では
 * リボンが口より後=手前に描画される」ことを実証した上で、`parentPartIndices`の大小関係が
 * 瞳/白目の組では偶然正しかっただけで、口/リボンの組では逆に効くこと(=Part一覧の並び順は
 * Cubism Editor上の作成順に過ぎず、意味のある前後関係のシグナルではないこと)を確認した)。
 *
 * **正しい修正**: Cubism Coreの生JSソース(`live2dcubismcore.min.js`)を`grep`で読み込み、
 * `_csm.getRenderOrders`(ネイティブ関数`csmGetRenderOrders`のラッパー)が**`Model`クラス自身の
 * コンストラクタで`this.renderOrders`として保持され、`Model.prototype.getRenderOrders()`で
 * 取得できる**ことを発見した(`drawables.*`ではなく`Model`直下。ここを探していなかったのが
 * 迷走の原因)。これは`doDrawModel()`が要求する**密な0〜N-1の完全な順列**そのもので(実機データで
 * `unique===length`を確認済み)、かつ`hiyori_pro_t11`の口/リボンの組で**正しい重なり順
 * (リボンが先=奥、口が後=手前)を返す**ことも実機データで確認した。よって`drawOrders`からの
 * 再構成(値ソート+タイの同点判定)は一切不要で、**`this._model.getRenderOrders()`を直接呼ぶだけ**
 * でよい。①②の迂回はまるごと不要だったと判明したため削除した。
 *
 * `CubismModel.prototype.getDrawableRenderOrders`を上書きし、`drawables.renderOrders`が無ければ
 * `this._model.getRenderOrders()`(Model直下の正しいAPI)へフォールバックする。**cubism2には
 * 対応物が無い**(`CubismModel`クラス自体がCubism4専用のCore実装ラッパーで、cubism2.es.jsはこの
 * クラスを持たない=exportsにも無い。よってこのパッチはcubism4限定で正当な非対称)。
 * **`SpriteSetRenderer`にも対応物は無い**(対称性チェック): スプライトセットは事前合成済みの
 * 単一WebPフレームを再生するだけで、drawable単位の重なり順という概念自体を持たないため。
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
    getDrawableCount: () => number;
    _model: {
      /** `Model`直下の真の描画順API(冒頭コメント「正しい修正」参照)。密な0〜N-1の完全な順列。 */
      getRenderOrders: () => Int32Array;
    };
  };
}

/** `getRenderOrders()`の長さ不一致(下記コメント参照)を1回だけ警告するためのガード。 */
const warnedOffscreenMismatch = new WeakSet<object>();

/**
 * `CubismModel.getDrawableRenderOrders()`を上書きし、`drawables.renderOrders`が無ければ
 * `this._model.getRenderOrders()`(`Model`直下の真の描画順API)へフォールバックする
 * (冒頭コメント「正しい修正」参照)。**`drawOrders`からの再構成は行わない**(不要と判明した)。
 * cubism4専用。
 *
 * **⚠️ 呼び出し側(`doDrawModel()`)から毎フレーム呼ばれるが、意図的にキャッシュしない**。
 * Cubismの「Draw Order Group」(パラメータに連動してdrawableの描画順を動的に入れ替える機能。
 * 例: 腕が体の前後を行き来する)により描画順は不変とは限らない。ここで結果をキャッシュすると、
 * この機能を使うモデルで描画順が固定される回帰を招きうる(続報5でreviewerが指摘した教訓。
 * 実装をここまで簡略化した後もこの前提は変わらないため、将来「無駄なので毎フレーム呼ぶのを
 * やめよう」と最適化しないこと)。
 *
 * **⚠️ 未検証: `getOffscreenCount() > 0`のモデル(2026-07-30・reviewer指摘)**: 実際のCubism Core
 * ソース(`live2dcubismcore.min.js`)を読むと、`Model`コンストラクタは
 * `renderOrders`を`drawableCount + offscreenCount`長で確保している(`getOffscreenCount`はCubism 5
 * Editorのオフスクリーン描画機能に対応するAPI)。実機で検証した`hiyori_pro_t11`は
 * `offscreenCount=0`(=`getRenderOrders().length`が`drawableCount`と一致)だったため、
 * `offscreenCount>0`のモデルで`order`値が`drawableCount`以上になりうるかどうかは**未検証**
 * (該当するテストモデルが手元に無く、推測で決め打ちしない=constraints.md)。起きた場合
 * `doDrawModel()`の`_sortedDrawableIndexList[order]=i`が範囲外書き込みになり、続報4/5と同種の
 * 「一部パーツが静かに描画されない」症状を再発しうる。ここでは実害を止められないため、
 * せめて検出可能にするだけの目的で長さ不一致を1回だけ`console.warn`する。
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
    if (result !== undefined) {
      return result;
    }
    const orders = this._model.getRenderOrders();
    if (orders.length !== this.getDrawableCount() && !warnedOffscreenMismatch.has(this)) {
      warnedOffscreenMismatch.add(this);
      console.warn(
        `[live2d] getRenderOrders()の長さ(${orders.length})がdrawableCount(${this.getDrawableCount()})と` +
          '一致しません(offscreenCount>0の可能性。未検証のケースです)。一部パーツが描画されない場合はここが原因です。',
      );
    }
    return orders;
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
