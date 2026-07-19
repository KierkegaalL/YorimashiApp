/**
 * Live2D形式の CharacterRenderer(FR-5)。pixi-live2d-display(v0.4.0)+ PixiJS v6 で描画する。
 *
 * ⚠️ 実行前提と本環境での検証限界(constraints.md「動作確認済みと自己申告しない」):
 * - **Cubism外部ランタイムが window に必要**。cubism4(=Cubism 5含む)は `window.Live2DCubismCore`、
 *   cubism2 は `window.Live2D`(live2dcubismcore.js / live2d.min.js。Live2D公式から取得、npmに無い。
 *   environments.md)。**未ロードだと `pixi-live2d-display` は import 時点で例外を投げる**ため、この
 *   モジュールは createRenderer が**ランタイム存在を確認した後に動的 import** する(静的 import しない)。
 * - PixiJSは**v6のAPIで書く**(v8のContainerとは別クラス。environments.md)。`Ticker`を登録する。
 * - 実際の描画・モーション駆動はWebGL+GUIを要し、本サンドボックスでは実行できない。ロジック構造は
 *   ライブラリAPI/実測(A2: dev-assetsのHaru/Shizuku定義)に基づくが、**実描画の最終確認は実機で行う**。
 *
 * アセット認証の未決(実装時TODO): `GET /models/*` は `X-App-Token` ヘッダ認証(security.md)。
 * pixi-live2d-display はモデル定義(model3.json/model.json)とその参照アセット(moc3/テクスチャ/
 * motion/expression)を**自前のローダで相対URL解決して取得する**ため、Rendererからヘッダを載せる経路が
 * 素直に無い。スプライトセット側(fetch→Blob)と同じ手は使えない。ローダへのヘッダ注入 or /models の
 * 認証方式見直し(WSと同じ ?token= 許容等)を**実機で切り分けて決める**。ここでは素のURLで組み立て、
 * この認証経路は未解決として残す(推測でローダ差し替えを書かない)。
 *
 * 持続の非対称(lipsync.md ③): Live2Dは `loop` の概念を持たず、モーションが尽きると idle グループへ
 * 自動フォールバックする。`thinking` 等を寿命ぶん持続させる「尽きるたび再発火」は EmotionEngine 責務で
 * **要決着**(lipsync.md 実装時TODO)。本Rendererの setState は指定モーションを1回発火するだけに留め、
 * 再発火は実装しない(黙って片方=スプライトセットのloopだけ対応する事故を避けるための明示)。
 */

import { Application, Ticker } from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';

import {
  type CharacterRenderer,
  type RendererContext,
  type SetStateOptions,
  toEmotionState,
} from './CharacterRenderer';
import { resolveLive2dMapping, type Live2dManifest } from '../../../shared/manifest';
import { FALLBACK_STATE, type EmotionState } from '../../../shared/emotions';

// PixiJSのTickerを登録する(モーション更新に必要。ライブラリの要求)。
// ランタイム判定は cubism-runtime.ts(pixiを一切importしない)に置き、createRendererが本モジュールを
// 動的importする前に確認する。ここに置くとimport時点でランタイム不在だと落ちるため分離している。
Live2DModel.registerTicker(Ticker);

export class Live2DRenderer implements CharacterRenderer {
  private readonly manifest: Live2dManifest;
  private readonly ctx: RendererContext;

  private app: Application | null = null;
  private model: Live2DModel | null = null;
  private container: HTMLElement | null = null;
  private currentState: EmotionState = FALLBACK_STATE;
  private destroyed = false;

  constructor(manifest: Live2dManifest, ctx: RendererContext) {
    this.manifest = manifest;
    this.ctx = ctx;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    // 透過(FR-6): backgroundAlpha 0。ウィンドウサイズ(#4で baseResolution×displaySize)に追従。
    this.app = new Application({
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    container.appendChild(this.app.view as unknown as HTMLCanvasElement);
    void this.loadModel();
  }

  setState(stateKey: string, _opts?: SetStateOptions): void {
    // crossfade はモーション/表情のフェード(model3.json/pixi側のfade時間)に委ねるため opts は未使用。
    this.currentState = toEmotionState(stateKey);
    if (this.model) {
      this.applyState(this.currentState);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.model) {
      this.model.destroy();
      this.model = null;
    }
    if (this.app) {
      // view(canvas)ごと破棄してWebGLコンテキストを解放する。
      this.app.destroy(true, { children: true, texture: true, baseTexture: true });
      this.app = null;
    }
    this.container = null;
  }

  // ── 内部 ───────────────────────────────────────────

  private async loadModel(): Promise<void> {
    try {
      const url = `${this.ctx.assetBaseUrl}/${this.manifest.modelFile}`;
      const model = await Live2DModel.from(url);
      if (this.destroyed || !this.app) {
        model.destroy();
        return;
      }
      this.model = model;
      this.app.stage.addChild(model);
      this.fitModel(model);
      this.applyState(this.currentState);
      this.ctx.onReady?.();
    } catch (err) {
      this.ctx.onError?.(err);
    }
  }

  /** モデルをコンテナに収まる最大スケールで中央配置する(contain相当)。 */
  private fitModel(model: Live2DModel): void {
    if (!this.container) {
      return;
    }
    const cw = this.container.clientWidth || model.width;
    const ch = this.container.clientHeight || model.height;
    const scale = Math.min(cw / model.width, ch / model.height);
    model.scale.set(scale);
    model.anchor.set(0.5, 0.5);
    model.position.set(cw / 2, ch / 2);
  }

  private applyState(state: EmotionState): void {
    if (!this.model) {
      return;
    }
    const mapping = resolveLive2dMapping(this.manifest, state);
    // motion/expression とも null 可(専用割当なし=idleへ畳んだ後もnullなら何もしない)。
    // motion()/expression() は非同期(アセット取得)。rejectを捨てると未処理rejectionになるため必ず捕捉する。
    //
    // 失敗時の扱いが SpriteSetRenderer と非対称なのは正当: スプライトセットはクリップ=表示の全体で、
    // 取得失敗は「何も映らない」致命状態なので onError(シーンを error 表示に倒す)へ流す。一方 Live2D の
    // motion/expression は既に表示済みモデルへの差分で、失敗しても直前のポーズは残る(致命ではない)。
    // モデルごと error 表示に倒してキャラを隠すのは過剰なので、ここでは console.error で正直にログするに留める
    // (黙って握りつぶさない=constraints.md「嘘をつかない」)。致命的なモデルロード失敗は loadModel() が onError で扱う。
    if (mapping.motion) {
      // 第2引数(priority)省略で通常再生。持続中の再発火は行わない(上記ヘッダ・lipsync.md③)。
      void this.model.motion(mapping.motion).catch((err: unknown) => {
        console.error(`[live2d] motion 再生に失敗しました(${state}/${mapping.motion}):`, err);
      });
    }
    if (mapping.expression) {
      void this.model.expression(mapping.expression).catch((err: unknown) => {
        console.error(`[live2d] expression 適用に失敗しました(${state}/${mapping.expression}):`, err);
      });
    }
  }
}
