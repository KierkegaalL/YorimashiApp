# cubism-runtime/ — Cubism外部ランタイムの配置場所(開発者ローカル専用)

このディレクトリは `.gitignore` 対象。**本体ファイルはコミットしない**(Live2D公式配布でnpmに無く、
ライセンス上リポジトリへ含めない。`dev-assets/README.md` と同じ理由)。

## 何を置くか

使うモデルの `cubismVersion` に応じて、**該当するファイルだけ**をこのディレクトリ直下に配置する
(**両方は不要**。下記「仕組み」参照)。

| モデルの `cubismVersion` | 配置するファイル | 入手元の目安 |
|---|---|---|
| `cubism4`(Cubism 5 の `model3.json` 形式を含む) | `live2dcubismcore.min.js` | Live2D公式の Cubism SDK for Web(`Core/live2dcubismcore.min.js`) |
| `cubism2` | `live2d.min.js` | Cubism 2.1 SDK の配布物内。**Live2Dは2.1を非推奨化しており、現行の公式SDK配布ページに含まれているか未確認**(このアプリはcubism2形式を持ち出しでは配布しない・推奨しない方針。cubism2モデルを使う予定が無ければこのファイルは不要) |

いずれもLive2D公式の配布物で、取得時はライセンスへの同意が必要。

## 仕組み

`src/renderer/character/renderer/load-live2d-module.ts` が、`pixi-live2d-display`の**バージョン別
サブパス**(`pixi-live2d-display/cubism4` または `/cubism2`)をモデルの`cubismVersion`に応じて
動的importする。**モデルが実際に使う版のランタイムだけ**あれば描画できる
(cubism4専用のモデルしか使わないなら`live2d.min.js`は不要。cubism-runtime.tsの経緯コメント参照)。

`src/renderer/character/renderer/load-cubism-runtime.ts` が、対応する版のファイルを `<script>` タグで
動的に読み込む。読み込み元パスはサイトルート直下(`/cubism-runtime/<ファイル名>`)に固定しており、
これは Vite の `public` ディレクトリ規約により**開発時(`npm run dev`。Vite dev server が `public/` を
サイトルート直下で配信する)・ビルド後(`npm run build && npm run preview`。ローカルサーバーが
`out/renderer/` を静的配信する)のどちらでも同じ URL で解決される**。

ただし `npm run dev` では、キャラクターウィンドウが**別の理由でアクティブモデルの情報自体を
受け取れない**(character HTML はローカルサーバーではなく Vite dev server から読まれるため、
サーバーがHTMLに埋め込むはずのモデル情報が注入されない。`src/renderer/character/renderer/bootstrap.ts`
の「既知の dev 制約」参照)。**Live2D描画の実機確認は `npm run build && npm run preview` で行うこと**
(このファイルが説明するランタイム読み込み自体は `npm run dev` でも機能するが、モデル情報が
届かないため描画までは辿り着かない)。

ファイルを置かなければ `<script>` は 404 になるだけで、アプリは「ランタイム未導入」の
正直なエラー表示に留まる(`cubism-runtime.ts` の `isCubismRuntimeAvailable`)。

## 配布ビルドへの同梱について

**未決事項として残る**。electron-builder の設定自体がまだ無く(配布フェーズで検討)、
ここに置いたファイルが最終的な配布物にどう含まれるか(そのまま `public` 経由で含めるか、
別途 `extraResources` にするか)、および同梱がCubism SDKのライセンス条件に適合するかは
配布フェーズで別途判断する。
