/**
 * スプライトセット取り込みで Renderer → Main へ渡す形(FR-5 / spriteset-pipeline.md 手順4)。
 * **工程がプロセスをまたぐ**ため、両側が同じ契約を参照できるよう shared に置く:
 * デコードと色キー抜きは Chromium(Renderer)、アニメーションWebPのエンコードは sharp(Main)。
 *
 * フレームは **PNG の `ArrayBuffer`**(可逆・アルファ厳密)。生RGBAを送らない
 * (800×800×4 ≒ 2.5MB/枚で、30枚なら約77MB になる)。canvas の WebP は quality:1 でも
 * 可逆ではないと実測したため PNG を使う(decode-video.ts 冒頭の訂正)。
 *
 * Live2D に対応物を持たない正当な非対称(Live2Dは完成済みモデルをフォルダ取り込みするだけで、
 * フレーム列を組み立てる工程が無い。spriteset-pipeline.md / constraints.md)。
 */

import type { EmotionState } from '../emotions';

/** 1感情ぶんのクリップ。 */
export interface SpritesetClipPayload {
  /** 色キー抜き済みフレーム(PNG)。1枚以上。 */
  frames: ArrayBuffer[];
  /** 各フレームの表示時間(ms)。frames と同数。 */
  delayMs: number[];
  width: number;
  height: number;
}

/** 取り込み要求。idle は必須(C-18: 全状態のフォールバック先)。 */
export interface SpritesetImportPayload {
  /** スロットに表示するモデル名。 */
  name: string;
  clips: Partial<Record<EmotionState, SpritesetClipPayload>>;
}

/**
 * `background_key.png` の保存結果(手順1-2)。Main が返し Renderer が表示する契約なので shared に置く
 * (preload が main/ の型を参照しないようにするため)。
 */
export interface BackgroundKeyResult {
  /** 保存できたか(選択・保存のどちらかをキャンセルしたら false)。 */
  saved: boolean;
  /** 保存先の絶対パス(saved=false なら null)。「どこへ保存したか」を画面に出すために返す。 */
  path: string | null;
}
