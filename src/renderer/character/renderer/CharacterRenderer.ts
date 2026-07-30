/**
 * CharacterRenderer 抽象化(FR-5 / basic-design.md 5.1)。
 *
 * EmotionEngine(Main)が算出した状態は WS でこの Renderer へ届き、`setState(key)` を呼ぶだけで
 * 形式を意識せず描画できる。Live2D形式とスプライトセット形式の差はこのインターフェースの背後に
 * 隠す(Live2DRenderer / SpriteSetRenderer)。
 *
 * 対称性(CLAUDE.md原則4): 両実装が mount/setState/destroy をペアで実装する。形式固有の非対称は
 * 各実装のコメントに理由を明記する(例: Live2Dは `loop` の概念を持たない=lipsync.md ③、
 * スプライトセットはリップシンク原理的不可=lipsync.md 論点3。いずれも正当な非対称)。
 */

import { EMOTION_STATES, FALLBACK_STATE, type EmotionState } from '../../../shared/emotions';

export interface SetStateOptions {
  /** クロスフェード時間(ms)。省略時は DEFAULT_CROSSFADE_MS。 */
  crossfadeMs?: number;
}

/** basic-design.md 5.1 の CharacterRenderer 抽象。 */
export interface CharacterRenderer {
  /** 描画先コンテナに実体をマウントし、初期状態(idle)を表示する。アセット読込は非同期に進む。 */
  mount(container: HTMLElement): void;
  /** 描画状態を切り替える。未知キーは idle にフォールバックする(C-18)。 */
  setState(stateKey: string, opts?: SetStateOptions): void;
  /** マウント解除し、確保したリソース(オブジェクトURL・WebGLコンテキスト等)を解放する。 */
  destroy(): void;
}

export const DEFAULT_CROSSFADE_MS = 200;

/** 両レンダラー共通の生成時コンテキスト。 */
export interface RendererContext {
  /**
   * このモデルのアセット配信ベースURL(末尾スラッシュ無し)。
   * 例: `http://127.0.0.1:8765/models/<installedDir>`。ローカルサーバーの `GET /models/*`。
   */
  assetBaseUrl: string;
  /** モデルid(`ModelSlot.installedDir`)。Live2DRendererが実サイズ報告(IPC)で使う。 */
  modelId: string;
  /**
   * `/models/*` 認証トークン(security.md 3章)。載せ方は形式ごとに異なる:
   * SpriteSetRendererはfetch→Blobでヘッダに載せる。Live2DRendererはpixi-live2d-displayの
   * 内部ローダ(テクスチャは`<img src>`相当)がヘッダを送れないため、クエリトークンとして載せる
   * (WSと同じ理由・同じキー。shared/ws-messages.ts の `TOKEN_QUERY_KEY`)。
   */
  token: string;
  /** 読込・再生の致命的な失敗(モデル不正・ランタイム不在等)。UIが「未描画」を正直に示すために使う。 */
  onError?: (err: unknown) => void;
  /** 最初の状態の描画準備が整ったとき。 */
  onReady?: () => void;
}

/**
 * 任意の文字列キーを既知の EmotionState に narrow する。未知キーは idle(C-18)。
 * WS 由来のキーは基本 EmotionState だが、インターフェースが string を受けるため防御的に畳む。
 */
export function toEmotionState(key: string): EmotionState {
  return (EMOTION_STATES as readonly string[]).includes(key)
    ? (key as EmotionState)
    : FALLBACK_STATE;
}
