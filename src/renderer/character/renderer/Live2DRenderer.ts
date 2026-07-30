/**
 * Live2D形式の CharacterRenderer(FR-5)。pixi-live2d-display(v0.4.0)+ PixiJS v6 で描画する。
 *
 * ⚠️ 実行前提と本環境での検証限界(constraints.md「動作確認済みと自己申告しない」):
 * - **Cubism外部ランタイムが window に必要**。cubism4(=Cubism 5含む)は `window.Live2DCubismCore`、
 *   cubism2 は `window.Live2D`(それぞれ`live2dcubismcore.min.js` / `live2d.min.js`。Live2D公式から
 *   取得、npmに無い)。**このモジュール自身は `pixi-live2d-display` の値を一切importしない**
 *   (`Live2DModel`/`MotionPriority`は型のみ参照する)。実体は `load-live2d-module.ts` が
 *   **モデルの版に対応するサブパス**(`pixi-live2d-display/cubism4` または `/cubism2`)を
 *   動的importして`live2d`として注入する。裸の`'pixi-live2d-display'`(cubism2/cubism4両方を
 *   同梱した単一バンドル)を使うと、実際に使わない側のランタイムまで要求される実機バグを
 *   過去に踏んだため(load-live2d-module.ts の経緯コメント参照)、版別サブパスに限定している。
 *   createRenderer が**対応する版のランタイム存在を確認した後に** `loadLive2DModule` → 本モジュールの
 *   動的 import、の順で呼ぶ(静的 import しない)。
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
 * 持続と再発火(lipsync.md ③・決着済み): Live2Dは `loop` の概念を持たず、モーションが尽きると idle
 * グループへ自動フォールバックする。`thinking` 等を寿命ぶん持続させるため、**本Rendererが
 * `motionFinish` を購読して同じ状態のモーションを撃ち直す**(再発火の実装主体は EmotionEngine では
 * なく Renderer)。理由:
 *  - EmotionEngine は Main プロセスにあり**モーションの長さを知らない**。Main から WS 越しに撃つと
 *    長さ不明のまま固定間隔で叩く盲目的ポーリングになり、再生中のモーションを切る/無駄な通信を生む。
 *  - SpriteSetRenderer では持続が「素材(アニメーションWebPのループ回数)」という Renderer 側に閉じた
 *    関心事になっている。Live2D も同じ層で閉じるのが対称(下記「責務分担」)。
 *  - `CharacterRenderer` インターフェースを変えずに済む(basic-design.md 5.1 に影響しない)。
 *
 * **責務分担(対称性チェック・CLAUDE.md原則4)**: EmotionEngine は状態の**寿命**(sustain/release・
 * reactionDurationMs・returnTo)を持ち、Renderer は**その状態を映し続ける方法**を持つ。契約は両形式で
 * 対称 =「setState された状態を、次の setState まで映し続ける」。手段だけが素材の性質で異なる
 * (spriteset=素材に焼き込んだループ / Live2D=再発火)。この非対称は正当。SpriteSetRenderer 側にも
 * 対応するコメントを置いてある。
 *
 * **実測(v0.4.0 のバンドル読解。ここでの再発火の作りはこの2点に依存する)**:
 *  1. `motionFinish` はライブラリの `MotionManager.update()` 内で、`state.complete()` と idle
 *     フォールバック(`startRandomMotion(idle, IDLE)`)の**直前に同期発火**する。この時点では
 *     `state.currentGroup/currentIndex` がまだ**終了したモーションを指している**ため、ハンドラ内で
 *     同期的に同じモーションを撃つと `reserve()` が "Motion is already playing" で**拒否する**
 *     (感情に単一モーションを割り当てた場合は候補が尽き、再発火が一切効かなくなる)。
 *     → よって再発火は**次のタスクへ回す**(同期で撃たない)。
 *  2. `reserve()` は `priority >= FORCE(3)` のとき優先度チェックを丸ごとスキップする。
 *     → **`MotionPriority.FORCE` で撃つ**ことで、その間にライブラリが開始した idle モーションを
 *       競合状態に依存せず確実に上書きできる。
 *
 * **Cubism4 の `setIsLoop` を使わない理由**: cubism4 バンドルの motion は `setIsLoop(true)` で
 * ネイティブにループでき(終了判定自体が立たない)魅力的だが、**cubism2 のモーション実体は外部ランタイム
 * (`live2d.min.js`)のクラスでバンドルから存在を確認できない**(lipsync.md ②と同じ限界)。採用すると
 * 検証できないまま Cubism2/Cubism4 の新たな非対称を作る。`motionFinish` + FORCE は**両バージョン共通の
 * 基底 `MotionManager`** の機能だけで成立するため、こちらを採る。
 */

import { Application, Ticker } from 'pixi.js';
import type { Live2DModel } from 'pixi-live2d-display';

import {
  type CharacterRenderer,
  type RendererContext,
  type SetStateOptions,
  toEmotionState,
} from './CharacterRenderer';
import {
  hasOwnLive2dMapping,
  resolveLive2dMapping,
  type Live2dManifest,
} from '../../../shared/manifest';
import { MotionRefirer } from './motion-refire';
import { FALLBACK_STATE, type EmotionState } from '../../../shared/emotions';
import type { Live2DModule } from './load-live2d-module';

export class Live2DRenderer implements CharacterRenderer {
  private readonly manifest: Live2dManifest;
  private readonly ctx: RendererContext;
  /** createRenderer が版別サブパスから解決して渡す実体(冒頭コメント参照)。 */
  private readonly live2d: Live2DModule;

  private app: Application | null = null;
  private model: Live2DModel | null = null;
  private container: HTMLElement | null = null;
  private currentState: EmotionState = FALLBACK_STATE;
  private destroyed = false;

  /** 持続中の再発火(lipsync.md ③)。判断はpixi非依存の motion-refire.ts に置いてある。 */
  private readonly refirer: MotionRefirer;
  /** motionFinish の購読解除に使う(destroy でリスナを残さない)。 */
  private motionFinishHandler: (() => void) | null = null;

  constructor(manifest: Live2dManifest, ctx: RendererContext, live2d: Live2DModule) {
    this.manifest = manifest;
    this.ctx = ctx;
    this.live2d = live2d;
    // PixiJSのTickerを登録する(モーション更新に必要。ライブラリの要求)。生成のたびに呼んでも
    // 副作用は無い(内部は単なる参照の再代入。registerTicker実装で確認済み)ため冪等性ガードは不要。
    this.live2d.Live2DModel.registerTicker(Ticker);
    this.refirer = new MotionRefirer({
      // 自前の割当を持つ状態だけ再発火する。idle へフォールバックした状態(割当なし)は、映っているのが
      // idle のモーションなので撃ち直さない(ライブラリのidleローテーションに委ねる。manifest.ts参照)。
      resolveMotion: (state) =>
        hasOwnLive2dMapping(this.manifest, state)
          ? (resolveLive2dMapping(this.manifest, state).motion ?? null)
          : null,
      // FORCE で撃つ理由: reserve() は priority>=FORCE のとき優先度チェックをスキップするため、
      // その間にライブラリが開始した idle モーションを競合状態に依存せず上書きできる(ヘッダの実測2)。
      fireMotion: (motion) => {
        void this.model?.motion(motion, undefined, this.live2d.MotionPriority.FORCE).catch((err: unknown) => {
          console.error(`[live2d] motion の再発火に失敗しました(${this.currentState}/${motion}):`, err);
        });
      },
    });
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
    // 保留中の再発火は「前の状態」のものなので捨てさせる(古い状態を映さない)。
    this.refirer.setState(this.currentState);
    if (this.model) {
      this.applyState(this.currentState);
    }
  }

  destroy(): void {
    this.destroyed = true;
    // 保留中の再発火を取り消してから破棄する(破棄後のモデルへ撃たない)。
    this.refirer.dispose();
    if (this.model) {
      if (this.motionFinishHandler) {
        this.model.internalModel.motionManager.off('motionFinish', this.motionFinishHandler);
        this.motionFinishHandler = null;
      }
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
      const model = await this.live2d.Live2DModel.from(url);
      if (this.destroyed || !this.app) {
        model.destroy();
        return;
      }
      this.model = model;
      // モーションが尽きたら同じ状態を撃ち直す(lipsync.md ③)。ハンドラ内では同期で撃たず、
      // MotionRefirer が次のタスクへ回す(ヘッダの実測1)。
      const handler = (): void => this.refirer.onMotionFinish();
      model.internalModel.motionManager.on('motionFinish', handler);
      this.motionFinishHandler = handler;
      this.app.stage.addChild(model);
      this.fitModel(model);
      this.applyState(this.currentState);
      this.ctx.onReady?.();
    } catch (err) {
      this.ctx.onError?.(err);
    }
  }

  /**
   * モデルをコンテナに収まる最大スケールで中央配置する(contain相当)。
   *
   * `loadModel()`内で一度だけ呼ぶ(`app.renderer`のresizeイベントは購読しない)。
   * ウィンドウサイズは`baseResolution × displaySize`で決まり、キャラクター表示ウィンドウは
   * アクティブモデルが変わるたびに`character-window.ts`の`applyActiveModel()`が
   * `setSize()`→`loadURL()`で丸ごと再読込する(=Live2DRendererごと作り直す)ため、
   * 実行中にコンテナだけがリサイズされる経路が現状無い(対称性チェック:
   * SpriteSetRendererの`<img>`はCSSのobject-fit:containで自動追従するが、これは
   * コンテナリサイズ非対応=Live2D側の実装漏れではなく、現状そのリサイズ自体が
   * 起こらないための対称性チェック対象外)。将来`general.displaySize`のライブ編集
   * (再読込を伴わない動的リサイズ)を実装する場合は、ここで`resize`購読を追加すること。
   */
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
      // 状態変更による初回発火は通常優先度(index/priority 省略)。以降、モーションが尽きるたびの
      // 再発火は MotionRefirer が FORCE で撃つ(上記ヘッダ・lipsync.md③)。
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
