/**
 * キャラクターウィンドウ(character HTML)にサーバーが埋め込むブートストラップ情報の契約(FR-5/FR-6)。
 *
 * ローカルサーバーは `/character` のHTML配信時に、認証トークン(`window.__APP_TOKEN__`)に加えて
 * 「今描画すべきアクティブモデル」を `window.__YORIMASHI_MODEL__` として埋め込む(local-server.ts)。
 * Renderer はこれを読み、`/models/<installedDir>/<mappingFile>` から manifest を取得して描画する
 * (renderer/bootstrap.ts)。トークンと同じ「HTMLに埋め込む」経路に載せることで、別途の設定取得APIを
 * 増やさずに済む(security.md 3章の方針と一貫)。
 *
 * モデル未導入時は `null`(オンボーディング前)。その場合キャラウィンドウは「モデル未導入」を正直に示す。
 * Main/Renderer 双方が同じ型を参照するため shared に置く。
 */

/** 描画対象モデルの最小情報(config の ModelSlot から必要分だけ写したもの)。 */
export interface CharacterBootstrapModel {
  /** userData/models 配下の相対ディレクトリ(= /models/<installedDir>)。 */
  installedDir: string;
  /** manifest ファイル名(ModelSlot.mappingFile。既定 manifest.json)。 */
  mappingFile: string;
}

/** character HTML に埋め込まれるグローバルのキー。 */
export const BOOTSTRAP_MODEL_GLOBAL = '__YORIMASHI_MODEL__';
export const BOOTSTRAP_TOKEN_GLOBAL = '__APP_TOKEN__';
