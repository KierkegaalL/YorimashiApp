# spriteset-pipeline.md — スプライトセットの画像処理ライブラリ選定

**ステータス**: 確定(2026-07-16)
**対応FR**: FR-5
**関連**: basic-design.md 9章、data.md 2.2章、security.md 7章

## 背景

スプライトセットの取り込みパイプライン(クロマグリーン合成・色キー抜き・アニメーションWebPエンコード)の処理内容は基本設計で確定済みだが、実装に使う具体的な画像処理ライブラリは未選定。

## 結論

| 工程 | 採用 |
|---|---|
| クロマグリーン合成(手順2) | **sharp** |
| 動画デコード(手順4前段) | **Electron内蔵ChromiumのWebCodecs** |
| 色キー抜き・境界連結判定・1px膨張(手順4中段) | **自前TypeScript実装**(ライブラリ非依存) |
| アニメーションWebPエンコード(手順4後段) | **sharp** |

**不採用**: `ffmpeg`同梱、`jimp`。理由は下記「検討ログ」参照。

追加する依存は `sharp` 1つのみ。動画デコードはElectronが既に内蔵するChromiumのコーデックで賄うため、**ffmpegバイナリの同梱は不要**。

## 検討ログ

以下はすべて本プロジェクトの実環境(macOS arm64 / Electron 43.1.1 / Node 24.18.0)で実測した結果であり、ドキュメント上の推測ではない。

### 論点1: クロマグリーン合成 — ネイティブ依存(sharp)のビルド・配布上の懸念

**懸念は解消。sharpをそのまま採用する。**

当初の懸念は「ネイティブ依存はElectronのABIに合わせた再ビルド(`electron-rebuild`)が必要で、ビルド・配布が面倒になる」というものだった。しかし現在のsharp(0.35.3)は**Node-API(N-API)モジュール**であり、Node-APIはABI安定を保証するため**Electronでも再ビルド不要**。

実測:
- `npm install sharp` はプリビルドバイナリ(`@img/sharp-darwin-arm64` + `@img/sharp-libvips-darwin-arm64`)を取得するのみで、**node-gypによるコンパイルが一切走らない**。
- Electron 43.1.1(ABI 148 / Node-API 10)の**mainプロセスで`require('sharp')`が成功し、実際にアニメーションWebP生成まで動作することを確認済み**。

### 論点2: 色キー抜き(境界連結判定) — どのライブラリでどう実装するか

**この論点はライブラリ選定を左右しない。自前実装する。**

sharpにもjimpにも「境界連結したフラッドフィル」に相当するAPIは存在せず、どちらを選んでも自前実装になる。そして実装対象は**RGBAのフラットな`Uint8Array`に対する幅優先探索**でしかないため、画像ライブラリの機能とは無関係。したがって論点2は論点1・3の判断材料から外してよい。

実装方針:
1. 画像の四辺の画素をキューの初期値とする
2. 背景色(クロマグリーン)との色距離が閾値以内の画素のみ隣接方向へ展開する(4近傍)
3. 到達した画素集合 = 背景マスク。**縁から到達できない画素は、背景色に近くても背景と見なさない**(これが「境界連結判定」の要点)
4. 背景マスクを1px膨張させ、エッジの中間色(グリーンスピル)を除去
5. マスク部分のアルファを0にする

この処理は後述のとおりRenderer側の`ImageData`(既にRGBA)上で行うのが自然で、sharpを経由する必要がない。

> **要確認(ドキュメント間の不整合)**: basic-design.md 9章は境界連結判定の目的を「**内部の白**(髪飾り等)を保護」と記述しているが、背景はクロマ**グリーン**である。グリーン背景に対して内部の白が誤って抜けることはないため、この記述は背景が白だった旧設計の名残の可能性が高い。保護対象は「内部のグリーン系の画素(緑の髪飾り・瞳のハイライト等)」であるはずで、アルゴリズム自体はそのままで正しく機能する。**記述の修正はNotion(正本)側の判断が必要なため、本ドキュメントでは変更していない。**

### 論点3: アニメーションWebPエンコード

**sharp単体で完結できることを実測で確認。ffmpegは不要。**

sharpの`join`入力オプションで、**個別フレームの配列から直接アニメーションWebPをマックスできる**:

```typescript
const webp = await sharp(frameBuffers, { join: { animated: true } })
  .webp({ loop: 0, delay: [100, 100, 100] })
  .toBuffer();
```

実測で確認した項目:
- 3フレームから`pages: 3`のアニメーションWebPが生成される
- `loop`・フレームごとの`delay`が正しく書き込まれ、読み戻しで復元できる
- **アルファチャンネルが保持される**(`hasAlpha: true` / `channels: 4`)。FR-6の透過要件を満たす

> ## ⚠️ 実測による訂正(2026-07-22・第2段階b-2の実装時)
>
> 本節の**結論(Chromium内蔵コーデックで賄い ffmpeg を同梱しない)は維持**するが、以下3点は実測と食い違っていたため訂正する。いずれも Electron 43.1.1 / macOS arm64 の実機(オフスクリーン)で測定した。
>
> **① `VideoDecoder`(WebCodecs)は単体では使えない — デムックスを行わない**
> `VideoDecoder` に mp4/webm の**ファイルのバイト列をそのまま渡してもデコードできない**。実測のエラー: `An EncodedVideoChunk was marked as type 'key' but wasn't a key frame`。WebCodecs はコンテナを解かないため、使うには mp4box.js 等のデムューサを別途抱える必要がある。
> **採用**: `HTMLVideoElement`(Chromium の demux + decode をそのまま使う)+ **シーク方式**(`currentTime` を進めて `seeked` を待ち1枚ずつ取り出す)。実測で6点サンプルすべて要求時刻どおりのフレームが取れた。再生 + `requestVideoFrameCallback` でも取れるが、**フレームのPNG化が非同期**で、再生中に同じ canvas を使い回すと競合するため採らない。デコードしているコーデックは同じ Chromium のものなので、本節の結論は変わらない。
>
> **② H.265 は「非対応」ではない — 下の表を訂正する**
> 下表は mp4/H.265(hvc1)を `no` としているが、実測では **`VideoDecoder.isConfigSupported` / `canPlayType` とも対応**(Apple Silicon の macOS が HEVC のハードウェアデコードを持ち、Chromium がそれを露出する)。
> したがって**コーデック名のハードコードした許可/拒否リストは持たない**。持てば実際には再生できる動画を「非対応」と拒否することになり、アプリが自分の状態について嘘をつく(constraints.md)。判定は**実際に読み込めたか**という実地の結果だけを根拠にする(`shared/spriteset/video-codec.ts`)。
>
> **③ canvas の WebP は `quality:1` でも可逆ではない**
> 後述の「フレーム単位に可逆圧縮してから送る」で例示している `convertToBlob({type:'image/webp', quality:1})` は、実測で**往復により画素が変化した**(可逆でない)。**PNG は往復でアルファが厳密に一致**したため、IPCへ渡すフレーム形式は **PNG** とする。生RGBAを送らないという趣旨(下記)はそのまま保つ。

#### 動画デコードはChromiumで行う(ffmpeg同梱を回避)

sharpの基盤であるlibvipsは**動画フォーマットを一切扱えない**(対応形式に動画コンテナが存在せず、mp4を渡すと`unsupported image format`で失敗することを確認済み)。よって手順3で外部AIが生成したmp4/webmのデコード手段が別途必要になる。

ここでffmpeg同梱ではなく**Electronが既に内蔵しているChromiumのコーデック**を使う。Electron 43.1.1で実測した対応状況:

| コーデック | 判定 |
|---|---|
| mp4 / H.264 (avc1) | `probably` |
| webm / VP8 | `probably` |
| webm / VP9 | `probably` |
| webm / AV1 | `probably` |
| mp4 / H.265 (hvc1) | ~~`no`~~ → **実測で対応(上の訂正②)** |

外部動画生成AIサービス(Pika・Canva等)の出力は実質H.264 mp4かVP9 webmなので、**H.265非対応は問題にならない**(取り込み時にバリデーションで弾き、ユーザーに再エンコードを促す)。

**WebCodecs(`VideoDecoder`)はsecure contextでのみ有効**という重要な制約を実測で確認した:

| 読み込み元 | `isSecureContext` | `VideoDecoder` |
|---|---|---|
| `data:text/html,...` | false | **利用不可** |
| `http://localhost:8799/` | true | **利用可**(H.264 / VP8 / VP9 すべて`supported: true`) |

security.md 7章が「キャラクターウィンドウも`http://localhost:8765/character`から読み込む形に統一する」と定めているため、**その方針に従う限りWebCodecsは自動的に有効になる**。逆に言えば、7章の方針を破って`file://`や`data:`で読み込むとWebCodecsが使えなくなる。この2つの設計判断は連動している。

#### 処理の配置(Renderer / Main の分担)

デコードはChromium(Renderer)、エンコードはsharp(Main)にあるため、工程がプロセスをまたぐ:

1. **Renderer**: ~~`VideoDecoder`で~~ **`HTMLVideoElement` + シーク方式で**(訂正①)mp4/webmをデコード → canvasへ描画 → `ImageData`(RGBA)取得
2. **Renderer**: 論点2の境界連結フラッドフィル + 1px膨張をそのまま`ImageData`上で実行(既にRGBAなので変換不要)
3. **Renderer → Main**: フレームをIPCで転送。**生RGBAのまま送らないこと** — 800×800×4 = 約2.5MB/フレームで、30フレームなら約77MBになる。フレーム単位に可逆圧縮してから送る。~~`canvas.convertToBlob({ type: 'image/webp', quality: 1 })`等~~ → **PNG(`canvas.toBlob(..., 'image/png')`)を使う**。canvasのWebPは`quality:1`でも可逆ではなく、PNGはアルファが厳密に一致すると実測(訂正③)
4. **Main**: sharpの`join`でアニメーションWebPへマックスし、`userData/models/<uuid>/<emotion>.webp`へ書き出す

なお手順2のクロマグリーン合成(静止画1枚 → 緑背景合成)は動画デコードを伴わない単純な合成なので、Main側でsharpの`composite`で行う。

### 論点4: 配布時のバイナリサイズ・ライセンス

**実測サイズ(macOS arm64、配布に必要な分のみ)**:

| パッケージ | サイズ |
|---|---|
| `sharp` | 1.0 MB |
| `@img/sharp-darwin-arm64` | 300 KB |
| `@img/sharp-libvips-darwin-arm64` | 17 MB |
| **合計** | **約18 MB** |

- npmは実行中のプラットフォームに一致する`optionalDependencies`のみ取得するため、開発機(arm64)では約18MB。**Intel Mac向けにもビルドする(universal化する)場合は`darwin-x64`側も同梱され、約35MBになる**。v1のターゲットをApple Siliconのみに絞るなら18MBで済む。この判断は配布設計(FR-12関連)で別途行う。
- **electron-builderの設定に`asarUnpack`が必要**。sharpのネイティブバイナリ(`.node` / `.dylib`)はasarアーカイブ内から読み込めないため、`"asarUnpack": ["**/node_modules/@img/**", "**/node_modules/sharp/**"]`を指定する。

**ライセンス(FR-12「使用OSSライセンス一覧」への追加分)**:

| パッケージ | ライセンス |
|---|---|
| `sharp` | Apache-2.0 |
| `@img/sharp-darwin-arm64` | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64` (libvips本体) | **LGPL-3.0-or-later** |

libvipsがLGPL-3.0-or-laterである点に注意。LGPLは利用者による差し替え(再リンク)の余地を求めるが、本件は**独立した動的ライブラリ(`libvips-cpp.8.18.3.dylib`)としてasar外に配置される**ため、その要件は構成上満たされる。FR-12の権利情報タブにライセンス全文へのリンクを掲載すること。

### 不採用にしたもの

#### ffmpeg同梱 — 不採用

- **不要**: 唯一の用途である動画デコードをChromiumが賄えることを実測で確認したため。
- **ライセンス上のリスク**: 最も広く使われる`ffmpeg-static`は**GPL-3.0-or-later**で、クローズドソースのアプリに同梱するには強い制約がかかる。`@ffmpeg-installer/ffmpeg`(LGPL-2.1)なら緩和されるが、そもそも必要ない依存のためにこの検討をする理由がない。
- **サイズ**: ffmpegバイナリは数十MB規模で、sharpと合わせると配布サイズへの影響が無視できない。

将来H.265対応やフレーム精度の高い取り出しが必要になった場合に限り、LGPL版の再検討余地を残す。

#### jimp — 不採用

当初「Pure JS、依存が軽い」という理由で候補に挙げていたが、**実測の結果この前提が事実と逆であることが判明した**。

- **致命的: WebPコーデックを持たない。** jimp 1.6.1の同梱プラグインは`js-bmp` / `js-gif` / `js-jpeg` / `js-png` / `js-tiff`のみで、**WebPの読み書きが一切できない**。本パイプラインの成果物はアニメーションWebPなので、この時点で要件を満たせない。
- **「軽い」が成立しない**: jimpの`node_modules`は**31MB**で、sharp一式(18MB)**より大きい**。Pure JSでもプラグイン群とWASM依存で肥大している。
- 加えてPure JS実装は画素処理がsharp(libvips)より大幅に遅い。

以上より、jimpは軽さ・機能のどちらの観点でも採用理由がない。

## 実装時のTODO

2026-07-22 に **第2段階b: Main側の生成コア**を実装(sharp導入・クロマグリーン合成・境界連結色キー抜き・アニメーションWebPエンコード・取り込みオーケストレーション・コーデック分類)。RendererのWebCodecsデコード+取り込みUIの配線は**第2段階b-2**として残す。

- [x] `npm install sharp` を本体に追加(sharp 0.35.3 / libvips 8.18.3。実測でN-APIプリビルド=Electron再ビルド不要を再確認)
- [ ] electron-builder設定に`asarUnpack`(`**/node_modules/@img/**` / `**/node_modules/sharp/**`)を追加 → **配布フェーズで対応**。現状 electron-builder の`build`設定自体を置いていない(build-commands.md「動かないCDを置かない」)ため、asarUnpackも配布設定の実装時にまとめて入れる
- [x] FR-12の権利情報タブにsharp / libvipsのライセンスを追加 → `scripts/generate-oss-licenses.mjs` が**インストール済み `optionalDependencies`** も辿るよう修正し、`sharp`(Apache-2.0)/ `@img/sharp-darwin-arm64`(Apache-2.0)/ `@img/sharp-libvips-darwin-arm64`(**LGPL-3.0-or-later**)を自動収集(`src/shared/oss-licenses.ts`)。libvips**本体**のソース開示・全文表示は配布NOTICE段階(論点4)
- [x] 取り込み時バリデーション → **訂正②により方針変更**。H.265 も実測で対応していたため、**コーデック名によるハードコードの拒否リストは持たない**。`src/shared/spriteset/video-codec.ts` は「実際に読み込めなかったとき」の説明文言だけを持ち、判定は `decode-video.ts` が実地の読み込み結果で行う
- [ ] 境界連結判定の色距離閾値・膨張量のチューニング(要件定義書「未確定事項」)→ アルゴリズムは実装済み(`src/shared/spriteset/color-key.ts`)。既定値(CHROMA_GREEN / 距離80 / 膨張1)は暫定で、実素材でのチューニングは残タスク
- [x] basic-design.md 9章「内部の白(髪飾り等)を保護」の記述をNotion正本側で確認・修正 → **確認の結果すでに解消済み**。2026-07-17のコミット(8926625)でNotion基本設計書・`docs/basic-design.md` 9章とも「内部のグリーン系の画素(緑の髪飾り・瞳のハイライト等)を保護」へ修正されており、`src/shared/spriteset/color-key.ts`の実装コメントとも一致している。このTODOのチェックだけが更新漏れだった
- [ ] universal build(darwin-x64同梱)の要否判断 → 配布フェーズ。なおライセンス生成は**実行プラットフォームぶんのバイナリのみ**収集する(未インストールのx64は自動的に一覧から落ちる)ため、universal化する場合はその環境で再生成が要る

### 第2段階b-2(2026-07-22 実装済み)

- [x] mp4/webm のデコード(手順4前段)→ **`HTMLVideoElement` + シーク方式**(訂正①)。`src/renderer/control-panel/src/spriteset/decode-video.ts`
- [x] デコードした`ImageData`への `keyOutBackground` 適用(手順4中段)+ **PNG** でのフレームIPC転送(訂正③)
- [x] 静止画選択 → `compositeOnChromaGreen` → `background_key.png` 保存(手順1-2)。`src/main/model/background-key.ts`。**選択も保存もネイティブダイアログ**で、Rendererからパスを渡さない
- [x] 動画取り込みUI(感情ごと・プロンプトのコピー)と `SpritesetImporter.importSpriteset` へのIPC配線・preload公開。`SpritesetAddFlow.tsx` / ModelTab に「追加するモデルの形式」セレクタを追加(モックアップ L931-1080 準拠)

**b-2 で残したもの**: Live2D の zip 取り込み、感情↔クリップの**再割り当て編集**(取り込み後に差し替える導線。第3段階)、モデル名の変更(モックアップどおり既定名で登録する)。
