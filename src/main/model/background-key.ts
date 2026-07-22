/**
 * スプライトセット生成の手順1-2(FR-5 / spriteset-pipeline.md / basic-design.md 9章):
 * 静止画(透過PNG推奨)を選ばせ、**クロマグリーン背景に合成した `background_key.png` を保存する**。
 * ユーザーはこれを外部の動画生成AIへ渡し、生成された mp4/webm を取り込む(手順3-4)。
 *
 * **ファイル選択・保存はネイティブダイアログに限る**(注入)。Renderer から任意のパスを受け取って
 * 読み書きする経路を作らない(code-settings / onboarding と同じ不変条件)。合成は Main の sharp
 * (spriteset-encode.ts)で行う。**Electron 非依存**でダイアログを注入するため、node で直接
 * 実行してオフスクリーン検証できる(build-commands.md)。
 *
 * Live2D に対応物を持たない正当な非対称(Live2Dは完成済みモデルをフォルダ取り込みするだけで、
 * 素材を外部AIに作らせる工程が無い。spriteset-pipeline.md / constraints.md)。
 */

import fs from 'node:fs';

import type { BackgroundKeyResult } from '../../shared/spriteset/import-payload';
import { compositeOnChromaGreen } from './spriteset-encode';

export type { BackgroundKeyResult };

/** 保存時の既定ファイル名。モックアップ(control-panel.jsx)の表記と揃える。 */
export const BACKGROUND_KEY_FILENAME = 'background_key.png';

export interface BackgroundKeyDeps {
  /** 元になる静止画をネイティブダイアログで選ぶ(キャンセルは null)。 */
  chooseImage: () => Promise<string | null>;
  /** 保存先をネイティブダイアログで選ぶ(キャンセルは null)。 */
  chooseSavePath: (defaultName: string) => Promise<string | null>;
}

/** 静止画を選ばせ、クロマグリーン合成して保存する。 */
export async function makeBackgroundKey(deps: BackgroundKeyDeps): Promise<BackgroundKeyResult> {
  const source = await deps.chooseImage();
  if (source === null) {
    return { saved: false, path: null };
  }
  // 合成に失敗したら(壊れた画像・非対応形式)そのまま例外を投げる。保存先を聞いてから失敗させない。
  const composited = await compositeOnChromaGreen(fs.readFileSync(source));

  const dest = await deps.chooseSavePath(BACKGROUND_KEY_FILENAME);
  if (dest === null) {
    return { saved: false, path: null };
  }
  fs.writeFileSync(dest, composited);
  return { saved: true, path: dest };
}
