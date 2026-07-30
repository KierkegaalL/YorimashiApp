/**
 * スプライトセット取り込みの手順4前段〜中段(FR-5 / spriteset-pipeline.md)。
 * mp4/webm を**フレーム列へ落とし、背景をクロマグリーンで抜く**までを Renderer 側で行う。
 *
 * ## なぜ VideoDecoder(WebCodecs)ではないのか — 実測に基づく設計の訂正
 *
 * 論点3は「WebCodecs(`VideoDecoder`)でデコードする」としていたが、**`VideoDecoder` は
 * コンテナのデムックスを行わない**。mp4/webm のバイト列をそのまま `EncodedVideoChunk` に
 * 渡しても復号できないことを実測で確認した(`An EncodedVideoChunk was marked as type 'key'
 * but wasn't a key frame`)。使うにはコンテナごとのデムューサ(mp4box.js 等)を別途抱える必要がある。
 *
 * 代わりに **`HTMLVideoElement`**(Chromium の demux + decode をそのまま使う)で取り出す。実測:
 *  - `currentTime` を進めて `seeked` を待つ**シーク方式**で、要求時刻どおりのフレームが取れる
 *    (6点サンプルすべて `actual === 要求時刻`、色も想定どおり分離)
 *  - 再生 + `requestVideoFrameCallback` でも取れるが、**フレームのPNG化が非同期**なため
 *    再生中に同じ canvas を使い回すと競合する。シーク方式なら1枚ずつ逐次処理でき競合しない
 *
 * 論点3の結論(**Chromium 内蔵コーデックで賄い ffmpeg を同梱しない**)は維持される。使う API が
 * `VideoDecoder` ではないだけで、デコードしているのは同じ Chromium のコーデックである。
 *
 * ## フレームをPNGで渡す理由 — 実測に基づく訂正
 *
 * 論点3は「`convertToBlob({type:'image/webp', quality:1})` 等で**可逆**圧縮してから送る」と
 * していたが、**canvas の WebP は quality:1 でも可逆ではない**ことを実測で確認した
 * (画素が往復で変化する)。**PNG は往復でアルファが厳密に一致**したため、IPC へ渡す
 * フレーム形式は PNG にする。生RGBAを送らない(800×800×4≒2.5MB/枚)という論点3の趣旨は保つ。
 *
 * Live2D に対応物を持たない正当な非対称(Live2Dは完成済みモデルを取り込むだけ)。
 */

import { keyOutBackground, type ColorKeyOptions } from '../../../../shared/spriteset/color-key';
import { videoLoadFailureMessage } from '../../../../shared/spriteset/video-codec';

/** Main(SpritesetImporter)へ渡す1感情ぶんのクリップ。 */
export interface DecodedClip {
  /** 色キー抜き済みフレーム(PNG。可逆・アルファ厳密)。 */
  frames: ArrayBuffer[];
  /** 各フレームの表示時間(ms)。frames と同数。 */
  delayMs: number[];
  width: number;
  height: number;
}

export interface DecodeOptions {
  /** 抽出するフレームレート(既定12)。素材の実fpsに関わらずこの間隔でサンプリングする。 */
  targetFps?: number;
  /** 上限フレーム数(既定120)。長い動画でメモリとIPC量が膨らむのを防ぐ。 */
  maxFrames?: number;
  /** 色キー抜きの設定(しきい値・膨張量)。既定は color-key.ts の定数。 */
  colorKey?: ColorKeyOptions;
  /** 進捗(done/total)。UIの「取り込み中」表示用。 */
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_TARGET_FPS = 12;
const DEFAULT_MAX_FRAMES = 120;
/** 1回のシーク待ちの上限(ms)。壊れた素材で無限に待たない。 */
const SEEK_TIMEOUT_MS = 5000;

/** 動画を読み込み、シーク方式でフレームを取り出し、背景を抜いてPNG列にする。 */
export async function decodeAndKeyVideo(file: File, options: DecodeOptions = {}): Promise<DecodedClip> {
  const targetFps = options.targetFps ?? DEFAULT_TARGET_FPS;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await waitForMetadata(video, file.name);
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error(videoLoadFailureMessage('no-video-track', file.name));
    }
    const duration = await resolveDuration(video);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) {
      throw new Error('2Dコンテキストを取得できませんでした。');
    }

    const total = Math.min(Math.max(1, Math.ceil(duration * targetFps)), maxFrames);
    const frames: ArrayBuffer[] = [];
    const delayMs: number[] = [];
    const step = 1000 / targetFps;

    for (let i = 0; i < total; i++) {
      // 最終フレームが duration ちょうどだとシークが返らないことがあるため、わずかに手前を狙う。
      const t = Math.min((i * step) / 1000, Math.max(0, duration - 1e-3));
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      keyOutBackground(image.data, width, height, options.colorKey);
      ctx.putImageData(image, 0, 0);
      frames.push(await canvasToPngArrayBuffer(canvas));
      delayMs.push(Math.round(step));
      options.onProgress?.(i + 1, total);
    }

    return { frames, delayMs, width, height };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * メタデータ待ち。読めなければ「実際に読めなかった」ことだけを根拠にエラーにする。
 *
 * **タイムアウトは必須**: `loadedmetadata` も `error` も発火しない壊れ方をした素材があり、
 * その場合ここで待ち続けると呼び出し側(SpritesetAddFlow)の「取り込み中」が解除されず
 * 画面が固まる。シーク待ちと同じ上限で打ち切る。
 */
function waitForMetadata(video: HTMLVideoElement, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    const cleanup = (): void => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(videoLoadFailureMessage('unreadable', fileName)));
    }, SEEK_TIMEOUT_MS);
    video.onloadedmetadata = () => {
      cleanup();
      resolve();
    };
    video.onerror = () => {
      cleanup();
      reject(new Error(videoLoadFailureMessage('unreadable', fileName)));
    };
  });
}

/**
 * duration を確定させる。MediaRecorder 由来の webm 等は `duration` が Infinity のまま
 * メタデータが来ることがあるため、その場合は一度大きな位置へシークして確定させる
 * (Chromium で知られた挙動への対処)。
 */
async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }
  await new Promise<void>((resolve) => {
    // waitForMetadata と同様にタイマーIDを保持し、先に解決した側が確実にもう一方をクリアする
    // (無くても resolve の二重呼び出し自体は無害だが、書き方をこのファイル内で統一する)。
    // 宣言順序も waitForMetadata に揃える(done定義 → timer設定 → イベントハンドラ登録)。
    // 逆順(イベントハンドラ登録が先)だと、仕様上は無いはずの同期発火が万一起きた場合に
    // timer が TDZ で未初期化のまま参照され例外になりうる(reviewer指摘・2026-07-30)。
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, SEEK_TIMEOUT_MS);
    video.ondurationchange = () => {
      if (Number.isFinite(video.duration)) {
        done();
      }
    };
    video.currentTime = 1e101;
  });
  video.ondurationchange = null;
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('動画の長さを判定できませんでした。別のファイルで試してください。');
  }
  video.currentTime = 0;
  return video.duration;
}

/** 指定時刻へシークして `seeked` を待つ。返らない素材で固まらないよう上限を設ける。 */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`動画の ${time.toFixed(2)} 秒目を取り出せませんでした(シークが返りません)。`));
    }, SEEK_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      video.onseeked = null;
    };
    video.onseeked = () => {
      cleanup();
      resolve();
    };
    video.currentTime = time;
  });
}

/** canvas を PNG(可逆・アルファ厳密)の ArrayBuffer にする。 */
function canvasToPngArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('フレームをPNGへ変換できませんでした。'));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });
}
