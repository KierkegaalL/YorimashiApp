/**
 * スプライトセット生成の画像処理(FR-5 / spriteset-pipeline.md 論点1・3)。sharp を使う工程だけを集める。
 *
 *  - `compositeOnChromaGreen`(手順2): 透過PNGをクロマグリーン背景へ合成し、ユーザーが外部AIへ渡す
 *    `background_key.png` を作る。合成背景色は color-key.ts の CHROMA_GREEN と**同一**(抜きと厳密一致させる)。
 *  - `encodeAnimatedWebp`(手順4後段): 色キー抜き済みの個別フレーム(エンコード済み静止画バッファの配列)を
 *    sharp の `join:{animated:true}` でアニメーションWebPへ結合する。アルファ保持(FR-6の透過要件)。
 *
 * sharp は N-API プリビルドで Electron 再ビルド不要(spriteset-pipeline.md 論点1 実測)。**electron を import
 * しない**ため、node で直接読み込んでオフスクリーン検証できる(build-commands.md)。
 *
 * デコード(手順4前段)は Chromium の WebCodecs で Renderer 側が行う(secure context 前提。libvips は動画を
 * 扱えない=論点3)。色キー抜き(手順4中段)は color-key.ts の純粋関数を Renderer 側の ImageData 上で使う。
 * よって**このファイルは静止画合成とフレーム結合だけ**を担い、動画・キー抜きには触れない(正当な工程分担)。
 */

import sharp from 'sharp';

import { CHROMA_GREEN } from '../../shared/spriteset/color-key';

/** アニメーションWebPを構成する1フレーム(エンコード済み静止画。sharpが形式を自動判別する)。 */
export type EncodedFrame = Buffer | Uint8Array;

/**
 * 透過PNG(推奨)をクロマグリーン背景へ合成する(手順2)。透過部が CHROMA_GREEN で塗られた
 * `background_key.png` 相当のバッファを返す。ユーザーはこれを外部の動画生成AIへ渡す。
 *
 * 元画像の寸法をそのまま使う(合成でサイズは変えない)。アルファの無い画像でもそのまま重なる。
 */
export async function compositeOnChromaGreen(pngBuffer: Buffer | Uint8Array): Promise<Buffer> {
  const src = sharp(pngBuffer);
  const meta = await src.metadata();
  if (!meta.width || !meta.height) {
    throw new Error('入力画像の寸法を取得できませんでした(壊れた画像か非対応形式です)。');
  }
  // 元画像を確実にRGBA(PNG)へ正規化してから、同サイズの単色クロマグリーンの上に重ねる。
  const fg = await src.png().toBuffer();
  return sharp({
    create: {
      width: meta.width,
      height: meta.height,
      channels: 4,
      background: { r: CHROMA_GREEN.r, g: CHROMA_GREEN.g, b: CHROMA_GREEN.b, alpha: 1 },
    },
  })
    .composite([{ input: fg }])
    .png()
    .toBuffer();
}

export interface AnimatedWebpOptions {
  /** ループ再生するか。false は1回再生で最終フレーム停止(loop=1)。data.md 2.2 の `loop` に対応。 */
  loop: boolean;
  /** 各フレームの表示時間(ms)。frames と同数。 */
  delayMs: number[];
  /** WebP品質(1-100)。既定90。透過(アルファ)は品質に関わらず保持される(論点3 実測)。 */
  quality?: number;
}

/**
 * 色キー抜き済みフレーム列をアニメーションWebPへ結合する(手順4後段)。sharp 単体で完結し ffmpeg は不要
 * (論点3 実測)。`loop:false` は sharp の `loop:1`(1回)に対応させる(0は無限。実測で確認)。
 */
export async function encodeAnimatedWebp(
  frames: EncodedFrame[],
  options: AnimatedWebpOptions,
): Promise<Buffer> {
  if (frames.length === 0) {
    throw new Error('フレームが0枚です。アニメーションWebPを作れません。');
  }
  if (options.delayMs.length !== frames.length) {
    throw new Error(`delayMs(${options.delayMs.length})はフレーム数(${frames.length})と一致させてください。`);
  }
  const input = frames.map((f) => (Buffer.isBuffer(f) ? f : Buffer.from(f)));
  return sharp(input, { join: { animated: true } })
    .webp({
      loop: options.loop ? 0 : 1, // 0=無限ループ / 1=1回で停止(実測: sharpはこの値をそのまま書き込む)
      delay: options.delayMs,
      quality: options.quality ?? 90,
    })
    .toBuffer();
}
