/**
 * Live2D の「持続中のモーション再発火」ポリシー(FR-4/FR-5 / lipsync.md ③)。
 *
 * Live2D は `loop` の概念を持たず、モーションが尽きるとライブラリが idle グループへ自動フォールバック
 * する。`thinking` 等を寿命ぶん持続させるには、尽きるたび同じ状態のモーションを撃ち直す必要がある
 * (実装主体は Renderer。理由は Live2DRenderer.ts のヘッダ)。**その「いつ撃つ/撃たない」の判断だけ**を
 * この純粋モジュールへ切り出す。
 *
 * **なぜ切り出すか**: `Live2DRenderer` は `pixi-live2d-display` を import した時点で Cubism 外部ランタイム
 * (`window.Live2DCubismCore` / `window.Live2D`)を要求し、**サンドボックスの Node からは import すら
 * できない**(environments.md / constraints.md)。ポリシーをここへ分離すると、時間・発火・解決を注入した
 * オフスクリーン検証が可能になり、「実描画できないから未検証」で終わらせずに済む。実描画(WebGL/Cubism)
 * の確認は引き続きユーザーが行う。
 *
 * 形式非依存ではない(Live2D 専用)が、これは**正当な非対称**である。スプライトセットの持続は素材
 * (アニメーションWebPのループ回数)に焼き込み済みで、Renderer 側に判断が要らない
 * (SpriteSetRenderer.ts のコメント参照)。両形式の**契約**は「setState された状態を次の setState まで
 * 映し続ける」で対称であり、その手段だけが素材の性質で異なる。
 */

import { FALLBACK_STATE, type EmotionState } from '../../../shared/emotions';

/**
 * 再発火の最小間隔(ms)。**前回の再発火**からこれより短い間隔で次の終了が来たときは撃たず、
 * ライブラリ本来の idle フォールバックへ委ねる(安全弁)。長さ0/極端に短いモーションや割当先が
 * 壊れているモデルで毎tick撃ち続けると、非機能要件(Reaction再生中もCPU10%未満)を破りうるため。
 * 正常なモーション(通常数秒)はこの閾値に当たらない。当たった場合は「表示は崩れないが持続しない」
 * degrade になる(黙って無限ループするより正直)。
 */
export const MIN_REFIRE_INTERVAL_MS = 200;

/** 保留中の再発火を取り消す関数。 */
export type CancelScheduled = () => void;

export interface MotionRefirerDeps {
  /** 状態に対応するモーション名を返す(割当が無ければ null)。 */
  resolveMotion: (state: EmotionState) => string | null;
  /** 実際にモーションを撃つ(呼び出し側が MotionPriority.FORCE で発火する)。 */
  fireMotion: (motion: string) => void;
  /**
   * 次のタスクへ回す。**同期で撃ってはならない**: `motionFinish` の時点ではライブラリの
   * `state.currentGroup/currentIndex` がまだ終了したモーションを指しており、同じモーションを
   * 同期で撃つと `reserve()` に "Motion is already playing" で拒否される(実測。Live2DRenderer.ts)。
   * 既定は `setTimeout(fn, 0)`。検証では同期実行に差し替える。
   */
  schedule?: (fn: () => void) => CancelScheduled;
  /** 現在時刻(ms)。検証で固定するため注入可能にしている。 */
  now?: () => number;
}

function defaultSchedule(fn: () => void): CancelScheduled {
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

/**
 * `motionFinish` を受けて、同じ状態のモーションを撃ち直すかを判断する。
 *
 * 撃たない条件:
 * - 破棄済み
 * - 現在の状態が `idle`(= FALLBACK_STATE) — **ライブラリ本来の idle グループのランダムローテーションに
 *   委ねる**。idle のときに idle へフォールバックするのは正しい挙動で、1本を固定で撃ち続けると
 *   待機の多様性を殺す
 * - その状態にモーション割当が無い(表情のみ等)
 * - すでに再発火が保留中(多重発火の防止)
 * - 前回の再発火から `MIN_REFIRE_INTERVAL_MS` 未満(安全弁)
 */
export class MotionRefirer {
  private readonly deps: Required<MotionRefirerDeps>;

  private currentState: EmotionState = FALLBACK_STATE;
  private cancelPending: CancelScheduled | null = null;
  private lastRefireAt = 0;
  private disposed = false;

  constructor(deps: MotionRefirerDeps) {
    this.deps = {
      schedule: defaultSchedule,
      now: () => Date.now(),
      ...deps,
    };
  }

  /**
   * 描画状態が変わったことを通知する(Renderer の setState から呼ぶ)。
   * 保留中の再発火は**古い状態のもの**なので捨てる。最小間隔の計測もリセットし、
   * 直前の状態での再発火タイミングが新しい状態の初回再発火を巻き添えにしないようにする。
   */
  setState(state: EmotionState): void {
    if (this.currentState === state) {
      return;
    }
    this.currentState = state;
    this.clearPending();
    this.lastRefireAt = 0;
  }

  /** ライブラリの `motionFinish` を受けたときに呼ぶ。 */
  onMotionFinish(): void {
    if (this.disposed || this.cancelPending !== null) {
      return;
    }
    const state = this.currentState;
    if (state === FALLBACK_STATE) {
      return; // idle はライブラリのローテーションに委ねる
    }
    if (this.deps.resolveMotion(state) === null) {
      return; // モーション割当なし(表情のみ等)
    }
    this.cancelPending = this.deps.schedule(() => {
      this.cancelPending = null;
      this.fireIfStillValid(state);
    });
  }

  /** 破棄。保留中の再発火を取り消す。 */
  dispose(): void {
    this.disposed = true;
    this.clearPending();
  }

  // ── 内部 ───────────────────────────────────────────

  private fireIfStillValid(state: EmotionState): void {
    // schedule された後に破棄・状態変更が起きていれば撃たない(古い状態を映さない)。
    if (this.disposed || this.currentState !== state) {
      return;
    }
    // モーションは schedule 後に再解決する(その間に manifest 差し替え等で変わりうるため)。
    const motion = this.deps.resolveMotion(state);
    if (motion === null) {
      return;
    }
    const now = this.deps.now();
    if (this.lastRefireAt !== 0 && now - this.lastRefireAt < MIN_REFIRE_INTERVAL_MS) {
      return; // 安全弁: idle フォールバックへ委ねる
    }
    this.lastRefireAt = now;
    this.deps.fireMotion(motion);
  }

  private clearPending(): void {
    if (this.cancelPending) {
      this.cancelPending();
      this.cancelPending = null;
    }
  }
}
