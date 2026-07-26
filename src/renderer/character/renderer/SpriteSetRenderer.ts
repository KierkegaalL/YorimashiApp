/**
 * スプライトセット形式の CharacterRenderer(FR-5)。事前レンダリング済みのアニメーションWebPを
 * 2レイヤーでクロスフェード再生する(basic-design.md 5.1「WebPクロスフェード再生」)。
 *
 * アセット認証: `GET /models/*` は `X-App-Token` ヘッダ認証(security.md)。`<img src>` は独自ヘッダを
 * 送れないため、**fetch でヘッダ付き取得 → Blob → オブジェクトURL** にしてから `<img>` に渡す
 * (トークンをURLに載せず、127.0.0.1限定+ヘッダ認証の設計を崩さない)。取得済みクリップはキャッシュする。
 *
 * `loop`(manifest.jsonのclip)は**素材の再生方法**で、アニメーションWebPのループ回数として取り込み時に
 * 焼き込まれる(spriteset-pipeline.md)。`<img>`はそのループ設定に従って再生するだけで、ここでは制御しない。
 * `returnTo`(状態遷移)は EmotionEngine の責務で、次のWSスナップショットが次の setState を駆動する
 * (lipsync.md「loopと寿命は直交」)。よってこのRendererは「今どの状態か」だけを描画する純粋な表示器。
 *
 * **持続の責務分担(対称性チェック・CLAUDE.md原則4 / lipsync.md ③)**: EmotionEngine が状態の**寿命**
 * (sustain/release・reactionDurationMs・returnTo)を持ち、Renderer が**その状態を映し続ける方法**を持つ、
 * という分担は両形式で同じ。契約も対称 =「setState された状態を、次の setState まで映し続ける」。
 * ただし**手段は素材の性質で異なり、この非対称は正当**:
 *  - スプライトセット(ここ): 持続は素材に焼き込み済み(`loop`)。**Renderer 側の追加実装は不要**。
 *  - Live2D: 素材にループ概念が無く、モーションが尽きるとライブラリが idle へ自動フォールバックして
 *    しまうため、`Live2DRenderer` が `motionFinish` を購読して**同じ状態を撃ち直す**(MotionRefirer)。
 * 「Live2D 側だけ実装した」のではなく、**スプライトセット側は素材で既に満たしている**ため差分が無い。
 *
 * 非対称の明記(対称性チェック): リップシンクはスプライトセットでは**原理的に不可能**(口が焼き込み済み。
 * lipsync.md 論点3)。したがってインターフェースに口駆動APIは無く、Live2DRendererとの差はここでは現れない。
 */

import {
  type CharacterRenderer,
  type RendererContext,
  type SetStateOptions,
  DEFAULT_CROSSFADE_MS,
  toEmotionState,
} from './CharacterRenderer';
import { resolveClip, type SpritesetManifest } from '../../../shared/manifest';
import { FALLBACK_STATE, type EmotionState } from '../../../shared/emotions';

export class SpriteSetRenderer implements CharacterRenderer {
  private readonly manifest: SpritesetManifest;
  private readonly ctx: RendererContext;

  private layers: [HTMLImageElement, HTMLImageElement] | null = null;
  private activeLayer: 0 | 1 = 0;
  private currentState: EmotionState | null = null;
  /** clip.file → オブジェクトURL。取得済みは再利用し、destroyでまとめてrevokeする。 */
  private readonly objectUrls = new Map<string, string>();
  /** 最新の切替要求だけを反映するためのシーケンス番号(遅い読込が新しい表示を上書きしないように)。 */
  private loadSeq = 0;
  private readyFired = false;
  private destroyed = false;

  constructor(manifest: SpritesetManifest, ctx: RendererContext) {
    this.manifest = manifest;
    this.ctx = ctx;
  }

  mount(container: HTMLElement): void {
    const layerA = this.createLayer();
    const layerB = this.createLayer();
    layerA.style.opacity = '1';
    container.appendChild(layerA);
    container.appendChild(layerB);
    this.layers = [layerA, layerB];
    // 初期状態は idle(C-18)。初回はクロスフェード無しで即表示する。
    this.setState(FALLBACK_STATE, { crossfadeMs: 0 });
  }

  setState(stateKey: string, opts?: SetStateOptions): void {
    if (!this.layers || this.destroyed) {
      return;
    }
    const state = toEmotionState(stateKey);
    if (state === this.currentState) {
      return; // 同一状態への再指定は無視(WSは変化時のみ来るが防御的に)
    }
    this.currentState = state;
    const clip = resolveClip(this.manifest, state);
    const ms = opts?.crossfadeMs ?? DEFAULT_CROSSFADE_MS;
    const seq = ++this.loadSeq;
    void this.showClip(clip.file, ms, seq).catch((err) => {
      // この状態の描画に失敗。currentState を戻して次の指定で再試行できるようにし、正直に通知する。
      if (this.currentState === state) {
        this.currentState = null;
      }
      this.ctx.onError?.(err);
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
    if (this.layers) {
      for (const layer of this.layers) {
        layer.remove();
      }
    }
    this.layers = null;
  }

  // ── 内部 ───────────────────────────────────────────

  private createLayer(): HTMLImageElement {
    const img = new Image();
    img.draggable = false;
    img.decoding = 'async';
    const s = img.style;
    s.position = 'absolute';
    s.inset = '0';
    s.width = '100%';
    s.height = '100%';
    s.objectFit = 'contain';
    s.opacity = '0';
    s.pointerEvents = 'none';
    return img;
  }

  private async showClip(file: string, crossfadeMs: number, seq: number): Promise<void> {
    const url = await this.objectUrlFor(file);
    if (this.destroyed || !this.layers || seq !== this.loadSeq) {
      return; // 既に破棄された/より新しい要求に追い越された
    }
    const incoming = this.layers[1 - this.activeLayer];
    const outgoing = this.layers[this.activeLayer];
    incoming.src = url;
    // デコード完了を待ってから見せることで、フェード中の一瞬の空表示/チラつきを避ける。
    try {
      await incoming.decode();
    } catch {
      // decode非対応/中断時はそのまま進める(表示はできる)。
    }
    if (this.destroyed || !this.layers || seq !== this.loadSeq) {
      return;
    }
    incoming.style.transition = `opacity ${crossfadeMs}ms ease`;
    outgoing.style.transition = `opacity ${crossfadeMs}ms ease`;
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    this.activeLayer = (1 - this.activeLayer) as 0 | 1;
    if (!this.readyFired) {
      this.readyFired = true;
      this.ctx.onReady?.();
    }
  }

  private async objectUrlFor(file: string): Promise<string> {
    const cached = this.objectUrls.get(file);
    if (cached) {
      return cached;
    }
    const res = await fetch(`${this.ctx.assetBaseUrl}/${file}`, {
      headers: { 'X-App-Token': this.ctx.token },
    });
    if (!res.ok) {
      throw new Error(`スプライトクリップの読込に失敗しました: ${file} (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(file, url);
    return url;
  }
}
