/**
 * CharacterRenderer のファクトリ(FR-5 / basic-design.md 5.1 `createRenderer`)。
 * manifest.renderType で実装を選ぶ。EmotionEngine/呼び出し側は形式を意識しない。
 *
 * basic-design.md 5.1 の擬似コードは同期関数だが、ここでは **async** にしている。理由:
 * Live2D は `pixi-live2d-display` を import した瞬間にCubism外部ランタイム未ロードだと例外を投げる
 * (environments.md)ため、(1)ランタイム存在を確認してから(2)Live2DRendererを**動的import**する必要が
 * あり、動的importは非同期だから。スプライトセットは重い依存が無いので同期生成できるが、戻り値の型を
 * 揃えるため両分岐とも Promise で返す。
 *
 * 対称性(CLAUDE.md原則4): 両 renderType に対して必ず対応する実装を返す。live2dのランタイム事前判定は
 * Live2D固有の正当な非対称(cubism-runtime.ts 参照)。
 */

import type { CharacterRenderer, RendererContext } from './CharacterRenderer';
import { SpriteSetRenderer } from './SpriteSetRenderer';
import { isCubismRuntimeAvailable } from './cubism-runtime';
import type { Manifest } from '../../../shared/manifest';

export async function createRenderer(
  manifest: Manifest,
  ctx: RendererContext,
): Promise<CharacterRenderer> {
  if (manifest.renderType === 'live2d') {
    if (!isCubismRuntimeAvailable(manifest.cubismVersion)) {
      const label = manifest.cubismVersion === 'cubism4' ? 'Cubism 4/5' : 'Cubism 2';
      throw new Error(
        `${label} ランタイムが未導入のため Live2D モデルを描画できません(live2dcubismcore.js / live2d.min.js の同梱が必要)`,
      );
    }
    // ランタイム確認後にのみ import(pixi-live2d-display はランタイム未ロードだと import で落ちる)。
    const { Live2DRenderer } = await import('./Live2DRenderer');
    return new Live2DRenderer(manifest, ctx);
  }
  return new SpriteSetRenderer(manifest, ctx);
}
