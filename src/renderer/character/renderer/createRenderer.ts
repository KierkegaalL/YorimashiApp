/**
 * CharacterRenderer のファクトリ(FR-5 / basic-design.md 5.1 `createRenderer`)。
 * manifest.renderType で実装を選ぶ。EmotionEngine/呼び出し側は形式を意識しない。
 *
 * basic-design.md 5.1 の擬似コードは同期関数だが、ここでは **async** にしている。理由:
 * Live2D は `pixi-live2d-display` を import した瞬間にCubism外部ランタイム未ロードだと例外を投げる
 * (environments.md)ため、(1)ランタイム存在を確認してから(2)対応する版のみを**動的import**する必要が
 * あり、動的importは非同期だから。スプライトセットは重い依存が無いので同期生成できるが、戻り値の型を
 * 揃えるため両分岐とも Promise で返す。
 *
 * **⚠️ 実機検証で判明した訂正(2026-07-30)**: 当初は裸の`'pixi-live2d-display'`(cubism2/cubism4両方
 * 同梱の単一バンドル)を使い、両方のランタイムを確認・ロードしていた。しかしこれは
 * 「実際に描画するモデルの版に関わらず両方が要る」という不必要に重い要求で、cubism4専用モデルしか
 * 使わない開発者にもcubism2ランタイム(`live2d.min.js`)の入手を強いていた。`pixi-live2d-display`が
 * 提供する**版別サブパス**(`pixi-live2d-display/cubism4` / `/cubism2`)へ切り替え、
 * **モデルが実際に使う版だけ**を確認・ロードするようにした(load-live2d-module.ts参照)。
 *
 * 対称性(CLAUDE.md原則4): 両 renderType に対して必ず対応する実装を返す。live2dのランタイム事前判定は
 * Live2D固有の正当な非対称(cubism-runtime.ts 参照)。
 */

import type { CharacterRenderer, RendererContext } from './CharacterRenderer';
import { SpriteSetRenderer } from './SpriteSetRenderer';
import { isCubismRuntimeAvailable } from './cubism-runtime';
import { loadCubismRuntime } from './load-cubism-runtime';
import { loadLive2DModule } from './load-live2d-module';
import type { Manifest } from '../../../shared/manifest';

const RUNTIME_FILE_NAME: Record<'cubism4' | 'cubism2', string> = {
  cubism4: 'live2dcubismcore.min.js',
  cubism2: 'live2d.min.js',
};

export async function createRenderer(
  manifest: Manifest,
  ctx: RendererContext,
): Promise<CharacterRenderer> {
  if (manifest.renderType === 'live2d') {
    // 開発者が配置していれば読み込む(load-cubism-runtime.ts参照)。未配置でも例外にはならず、
    // 直後の isCubismRuntimeAvailable が false のままなので、正直な「未導入」エラーへ落ちる。
    // **モデルが実際に使う版だけ**を確認・ロードする(訂正コメント参照。もう一方の版は不要)。
    await loadCubismRuntime(manifest.cubismVersion);
    if (!isCubismRuntimeAvailable(manifest.cubismVersion)) {
      const label = manifest.cubismVersion === 'cubism4' ? 'Cubism 4/5' : 'Cubism 2';
      throw new Error(
        `${label} ランタイムが未導入のため Live2D モデルを描画できません` +
          `(${RUNTIME_FILE_NAME[manifest.cubismVersion]} の同梱が必要)`,
      );
    }
    // ランタイム確認後にのみ import(pixi-live2d-display はランタイム未ロードだと import で落ちる)。
    // モデルの版に対応するサブパスだけを解決する(load-live2d-module.tsの経緯コメント参照)。
    const [live2dModule, { Live2DRenderer }] = await Promise.all([
      loadLive2DModule(manifest.cubismVersion, ctx.token),
      import('./Live2DRenderer'),
    ]);
    return new Live2DRenderer(manifest, ctx, live2dModule);
  }
  return new SpriteSetRenderer(manifest, ctx);
}
