/**
 * スプライトセットの色キー抜き(FR-5 / spriteset-pipeline.md 論点2「境界連結判定」)。
 *
 * **境界連結フラッドフィル**: 画像の四辺を種に、クロマグリーンとの色距離がしきい値以内の画素だけを
 * 4近傍へ展開する。縁から到達できた画素集合だけを背景と見なし、**縁から到達できない内部の
 * グリーン系画素(緑の髪飾り・瞳のハイライト等)は背景色に近くても保護する**。これが「境界連結判定」の
 * 要点で、単純な色一致では抜けてしまう内部の緑を守る。到達集合を1px膨張してエッジの中間色
 * (グリーンスピル)を巻き込んでから、その画素のアルファを0にする。
 *
 * **Electron非依存の純粋関数**(RGBAのフラットな配列にのみ依存)。オフスクリーンで検証できる
 * (build-commands.md「サンドボックスで可能な検証」)。実行時は Renderer 側で `ImageData.data`
 * (既にRGBA)に対して呼ぶ(spriteset-pipeline.md 手順4中段: デコード→キー抜き→IPC転送→エンコード)。
 * sharp を経由しない(画像ライブラリの機能とは無関係な幅優先探索でしかないため。論点2)。
 *
 * **形式非対称は正当**: 色キー抜きはスプライトセットの生成パイプライン専用で、Live2D に対応物を
 * 持たない(Live2Dは完成済みモデルを取り込むだけ。spriteset-pipeline.md / constraints.md 既知の非対称)。
 */

/**
 * 合成に使うクロマグリーン(手順2の合成と手順4の抜きで**同一値**を使う)。背景は自分で生成するため
 * 厳密に一致させられる。値は緑スクリーンの慣用色(RGB 0,177,64)に置いた実装上の既定であり、
 * **確定値ではない**(色距離しきい値・膨張量とあわせて要件定義書「未確定事項」に残るチューニング対象。
 * spriteset-pipeline.md 実装時TODO)。
 */
export const CHROMA_GREEN = { r: 0, g: 177, b: 64 } as const;

/**
 * 背景と見なす色距離(RGBユークリッド距離 sqrt(dr²+dg²+db²))の上限。既定80は暫定で、チューニング対象。
 */
export const DEFAULT_COLOR_DISTANCE = 80;

/** 背景マスクの膨張量(px)。既定1(手順2「1px膨張」)。チューニング対象。 */
export const DEFAULT_DILATE = 1;

export interface ColorKeyOptions {
  /** クロマグリーンの色(既定 CHROMA_GREEN)。合成側と必ず同一値にすること。 */
  key?: { r: number; g: number; b: number };
  /** 色距離しきい値(既定 DEFAULT_COLOR_DISTANCE)。 */
  threshold?: number;
  /** 膨張回数=px(既定 DEFAULT_DILATE)。0で膨張なし。 */
  dilate?: number;
}

/**
 * 境界連結フラッドフィルで背景(クロマグリーン)を透過させる。`rgba` のアルファを**破壊的に**書き換える
 * (呼び出し側で `ImageData.data` を渡す想定)。`width`×`height` は `rgba.length === width*height*4` と整合すること。
 *
 * @returns 背景と判定して透過させた画素数(検証・チューニングの手がかり)。
 */
export function keyOutBackground(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: ColorKeyOptions = {},
): number {
  const key = options.key ?? CHROMA_GREEN;
  const threshold = options.threshold ?? DEFAULT_COLOR_DISTANCE;
  const dilate = options.dilate ?? DEFAULT_DILATE;
  const thresholdSq = threshold * threshold;
  const n = width * height;
  if (rgba.length < n * 4) {
    throw new Error(`rgba が width*height*4 より短い(期待 ${n * 4}, 実際 ${rgba.length})`);
  }
  const mask = new Uint8Array(n); // 1 = 背景

  const nearKey = (idx: number): boolean => {
    const o = idx * 4;
    const dr = rgba[o] - key.r;
    const dg = rgba[o + 1] - key.g;
    const db = rgba[o + 2] - key.b;
    return dr * dr + dg * dg + db * db <= thresholdSq;
  };

  // 四辺を種に BFS(4近傍)。キュー(head 進行)で再帰を避け、800×800(64万画素)でもスタックを溢れさせない。
  const queue = new Int32Array(n);
  let tail = 0;
  const seed = (idx: number): void => {
    if (mask[idx] === 0 && nearKey(idx)) {
      mask[idx] = 1;
      queue[tail++] = idx;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x); // 上辺
    seed((height - 1) * width + x); // 下辺
  }
  for (let y = 0; y < height; y++) {
    seed(y * width); // 左辺
    seed(y * width + width - 1); // 右辺
  }

  for (let head = 0; head < tail; head++) {
    const idx = queue[head];
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) seed(idx - 1);
    if (x < width - 1) seed(idx + 1);
    if (y > 0) seed(idx - width);
    if (y < height - 1) seed(idx + width);
  }

  // 1px 膨張を dilate 回。1パスぶんの追加画素をまず集めてから反映し、同一パス内で連鎖膨張させない
  // (色に関係なくマスクの外周へ広げる=グリーンスピルを巻き込むのが目的なので nearKey は見ない)。
  for (let d = 0; d < dilate; d++) {
    const add: number[] = [];
    for (let idx = 0; idx < n; idx++) {
      if (mask[idx] !== 1) continue;
      const x = idx % width;
      const y = (idx - x) / width;
      if (x > 0 && mask[idx - 1] === 0) add.push(idx - 1);
      if (x < width - 1 && mask[idx + 1] === 0) add.push(idx + 1);
      if (y > 0 && mask[idx - width] === 0) add.push(idx - width);
      if (y < height - 1 && mask[idx + width] === 0) add.push(idx + width);
    }
    for (const idx of add) mask[idx] = 1;
  }

  let cleared = 0;
  for (let idx = 0; idx < n; idx++) {
    if (mask[idx] === 1) {
      rgba[idx * 4 + 3] = 0;
      cleared++;
    }
  }
  return cleared;
}
