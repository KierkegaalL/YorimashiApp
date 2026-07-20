/**
 * EmotionEngine (FR-4) — 全10状態(Mood 3 + Reaction 7)の権威ある実行時状態を管理する。
 *
 * 正本:
 * - 状態集合: src/shared/emotions.ts(全10状態の単一の情報源)
 * - 挙動: docs/basic-design.md 5.2(Notion正本のミラー)
 * - 詳細設計: docs/detailed-design/lipsync.md(sustain/release・持続)、
 *   docs/detailed-design/emotion-classification.md(分類器はtrigger()を呼ぶだけ)
 *
 * 設計の要点:
 * - Mood(idle/confident/tired)とReaction(7種)の2層。描画に渡す「解決状態」は
 *   Reactionがあればそれ、無ければMood(basic-design.md 5.2)。
 * - 優先度: panic > proud > worried > happy > curious > thinking > idle系。
 *   再生中の高優先Reactionは低優先Reactionに割り込まれない(emotion-classification.md 論点2)。
 * - sustain付きReactionはreactionDurationMsのタイマーを起動せず、明示release()まで持続する
 *   (lipsync.md。Chat Adapterのthinking・無操作中のsleepy)。
 * - Moodはテキストではなくsuccess/failのstreakから決まる(emotion-classification.md 論点1)。
 *
 * 形式非依存: このエンジンはLive2D/スプライトセットのどちらも意識しない
 *   (EmotionEngineはrenderer.setState(key)を呼ぶだけ。basic-design.md 5.1)。
 *   よって対称性チェック(CLAUDE.md原則4)の対象外である。
 *
 * このモジュールはMainプロセスに置く(権威ある状態を1つ持ち、後にWS /ws で配信する。
 * basic-design.md 7.2)。GUIを伴わない検証のため、タイマーは注入可能にしてある
 *   (.claude/rules/build-commands.md「サンドボックスで可能な検証」)。
 */

import {
  REACTION_PRIORITY,
  type EmotionSnapshot,
  type MoodState,
  type ReactionState,
  isReactionState,
} from '../shared/emotions';

/** EmotionEngineが参照する設定(config.emotionEngine のサブセット)。 */
export interface EmotionEngineConfig {
  /** 非sustainのReactionがMoodへ自動復帰するまでのms(既定3000)。 */
  reactionDurationMs: number;
  /** 同一Reactionの連発を抑制するms(既定1500)。 */
  cooldownMs: number;
  /** 無操作でsleepyへ移行するまでのms(既定300000=5分)。 */
  idleTimeoutMs: number;
  /** この回数だけ連続失敗するとMoodがtiredになる(既定3)。 */
  failStreakThreshold: number;
  /** この回数だけ連続成功するとMoodがconfidentになる(既定3)。 */
  successStreakThreshold: number;
}

// EmotionSnapshot(描画側へ渡す解決済み状態)はMain/Renderer共有契約のため
// src/shared/emotions.ts に定義し、ここでは再エクスポートのみ行う。
export type { EmotionSnapshot };

export interface TriggerOptions {
  /**
   * trueにするとreactionDurationMsのタイマーを起動せず、release()まで持続する。
   * Chat Adapterのthinking(応答完了まで)・無操作中のsleepyで使う(lipsync.md)。
   */
  sustain?: boolean;
  /**
   * このtriggerに限りcooldownMsを上書きする。
   * UserPromptSubmitの「クールダウン短め」(basic-design.md 7.1)に使う。
   */
  cooldownMs?: number;
}

export type EmotionListener = (snapshot: EmotionSnapshot) => void;

/**
 * タイマーの抽象(注入可能)。既定はグローバルのsetTimeout/clearTimeout。
 * テストではfakeなスケジューラを渡して時間を決定的に進められる。
 */
export interface Scheduler {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const defaultScheduler: Scheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export class EmotionEngine {
  private mood: MoodState = 'idle';
  private reaction: ReactionState | null = null;
  private sustained = false;

  private successStreak = 0;
  private failStreak = 0;

  /** Reactionキーごとの最後に受理したtrigger時刻(cooldown判定用)。 */
  private readonly lastTriggerAt = new Map<ReactionState, number>();

  private reactionTimer: unknown = null;
  private idleTimer: unknown = null;

  private readonly listeners = new Set<EmotionListener>();
  private disposed = false;
  private lastEmitted: EmotionSnapshot | null = null;

  constructor(
    private readonly config: EmotionEngineConfig,
    private readonly scheduler: Scheduler = defaultScheduler,
  ) {
    this.armIdleTimer();
  }

  /**
   * Reactionを発火する。優先度・cooldownにより抑制されることがある。
   * @returns 実際に発火(状態変更)したらtrue、抑制されたらfalse。
   */
  trigger(reaction: ReactionState, options: TriggerOptions = {}): boolean {
    this.assertNotDisposed();

    // sleepy以外のReactionは「操作があった」ことを意味する。
    // sleepyそのものの発火(無操作タイマー由来)ではidleタイマーを再武装しない。
    if (reaction !== 'sleepy') {
      this.registerActivity();
    }

    // cooldown: 同一Reactionが直近cooldownMs以内に受理されていれば抑制する。
    // 以下のいずれかに該当する場合のみバイパスする(このcooldown判定自体は
    // EmotionEngine独自の調停ロジックであり、emotion-classification.mdの
    // スコアリング優先順位とは別物)。
    //   ①現在アクティブなReactionが無い(this.reaction === null)。
    //     sustain Reactionがreleaseされた直後などに、同じ状態を即座に
    //     出し直せるようにするため。
    //   ②今回のreactionが、現在アクティブなReactionより厳密に高優先。
    //     そのreaction自身の直近のcooldownに関わらず、より緊急な状態への
    //     割り込みを許す(例: panicが短時間内に再度必要になった場合)。
    const cooldownMs = options.cooldownMs ?? this.config.cooldownMs;
    const last = this.lastTriggerAt.get(reaction);
    const now = this.scheduler.now();
    const withinCooldown = last !== undefined && now - last < cooldownMs;
    const higherThanActive =
      this.reaction === null ||
      REACTION_PRIORITY[reaction] > REACTION_PRIORITY[this.reaction];
    if (withinCooldown && !higherThanActive) {
      return false;
    }

    // 優先度: 再生中のReactionより低い優先度では割り込まない。
    // 同一・高優先なら差し替える(同一の場合はタイマー/sustainの再設定になる)。
    if (
      this.reaction !== null &&
      REACTION_PRIORITY[reaction] < REACTION_PRIORITY[this.reaction]
    ) {
      return false;
    }

    this.lastTriggerAt.set(reaction, now);
    this.reaction = reaction;
    this.sustained = options.sustain === true;

    this.clearReactionTimer();
    if (!this.sustained) {
      this.reactionTimer = this.scheduler.setTimeout(() => {
        this.reactionTimer = null;
        // Reactionが自然消滅してMoodへ戻る。この時点でidleタイマーを必ず
        // 再武装する(下記settleToIdle参照)。武装しないと、無操作5分の
        // 満了時にちょうど本Reactionがブロック要因でsleepy化に失敗した場合、
        // 誰もidleタイマーを再開できず無操作検知が恒久的に止まる。
        this.settleToIdle();
        this.emit();
      }, this.config.reactionDurationMs);
    }

    this.emit();
    return true;
  }

  /**
   * sustain付きで発火したReactionを解除し、Moodへ戻す。
   * 現在アクティブなReactionがkeyと一致する場合のみ作用する(それ以外はno-op)。
   *
   * no-opが重要な理由: Chat Adapterはthinkingをsustainで発火し、finally相当で必ず
   * release('thinking')を呼ぶ(lipsync.md)。だが応答中にpanic(APIエラー)が割り込んで
   * thinkingを差し替えている場合があり、そのときrelease('thinking')はpanicを消してはならない。
   */
  release(key: ReactionState): void {
    this.assertNotDisposed();
    if (this.reaction !== key) {
      return;
    }
    this.clearReactionTimer();
    // 解除理由(sleepyの復帰か、thinkingの完了か等)を問わずidleタイマーを
    // 再武装する。特定keyに限定すると、他のsustain Reaction(例:
    // Chat Adapterのthinking)がidleタイマーをブロックしたまま解除された際に
    // 誰も再武装できず、無操作検知(sleepy)が恒久的に止まる不具合になる。
    this.settleToIdle();
    this.emit();
  }

  /**
   * ツール実行/応答の成否を通知し、streakを更新してMoodを再計算する
   *   (Code AdapterのPostToolUse(Failure)、Chat Adapterの成否。両Adapterで共有)。
   *
   * Mood遷移: 成功はfailStreakを、失敗はsuccessStreakを0に戻す。
   *   successStreak >= 閾値 → confident / failStreak >= 閾値 → tired / それ以外 → idle。
   *   毎回再計算するため、逆側のstreakが途切れた時点でidleへ戻る
   *   (例: tired中に1回成功するとfailStreak=0・successStreak=1でidle)。
   *
   * TODO(FR-2 Code Adapter実装時): basic-design.md 7.1の`Stop`イベント
   * (「Moodのみidle寄りに重心移動」)に対応する専用APIが未実装。Stopは成功/失敗の
   * 二値評価ではなく「ターン終了時に緩やかにidleへ寄せる」という別概念のため、
   * onToolResult()を流用しない。Code Adapter実装(#9)でstreakの緩和方法
   * (例: 半減させる等)を併せて設計する。
   */
  onToolResult(success: boolean): void {
    this.assertNotDisposed();
    this.registerActivity();

    if (success) {
      this.successStreak += 1;
      this.failStreak = 0;
    } else {
      this.failStreak += 1;
      this.successStreak = 0;
    }

    let nextMood: MoodState = 'idle';
    if (this.successStreak >= this.config.successStreakThreshold) {
      nextMood = 'confident';
    } else if (this.failStreak >= this.config.failStreakThreshold) {
      nextMood = 'tired';
    }

    if (nextMood !== this.mood) {
      this.mood = nextMood;
      this.emit();
    }
  }

  /**
   * ユーザー/システムの操作があったことを通知する。無操作タイマーを再武装し、
   * sleepyがアクティブなら解除する。trigger()/onToolResult()内部でも呼ばれるため、
   * 明示呼び出しは「Reactionを伴わない操作」(パネル操作等)のために用意している。
   */
  notifyActivity(): void {
    this.assertNotDisposed();
    this.registerActivity();
  }

  getSnapshot(): EmotionSnapshot {
    return {
      mood: this.mood,
      reaction: this.reaction,
      state: this.reaction ?? this.mood,
      sustained: this.sustained,
    };
  }

  /** スナップショットの変更を購読する。戻り値の関数で解除。 */
  subscribe(listener: EmotionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** タイマーを全て止める。ウィンドウ終了時等に呼ぶ。 */
  dispose(): void {
    this.disposed = true;
    this.clearReactionTimer();
    this.clearIdleTimer();
    this.listeners.clear();
  }

  // ── 内部 ──────────────────────────────────────────

  /** 操作があったときの共通処理: 無操作タイマー再武装 + sleepy解除。 */
  private registerActivity(): void {
    if (this.reaction === 'sleepy') {
      // release('sleepy')がclearReactionTimer→reaction=null→armIdleTimer→emitまで
      // 一貫して行う(armIdleTimerは冪等なので二重武装の実害は無い)。
      this.release('sleepy');
      return;
    }
    this.armIdleTimer();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (this.disposed) {
      return;
    }
    this.idleTimer = this.scheduler.setTimeout(() => {
      this.idleTimer = null;
      // 無操作が続いた: sleepyをsustainで発火する(操作があるまで持続)。
      this.trigger('sleepy', { sustain: true });
    }, this.config.idleTimeoutMs);
  }

  private clearReactionTimer(): void {
    if (this.reactionTimer !== null) {
      this.scheduler.clearTimeout(this.reactionTimer);
      this.reactionTimer = null;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      this.scheduler.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * ReactionをnullにしてMoodへ戻し、idleタイマーを再武装する。
   * reactionTimerのクリアは呼び出し元の責務(既にタイマー発火後で不要、
   * またはrelease()が先にclearReactionTimer()を呼んでいる)。
   */
  private settleToIdle(): void {
    this.reaction = null;
    this.sustained = false;
    this.armIdleTimer();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    // 実質的な変化が無ければ通知しない(不要な再描画を避ける)。
    if (
      this.lastEmitted !== null &&
      this.lastEmitted.state === snapshot.state &&
      this.lastEmitted.mood === snapshot.mood &&
      this.lastEmitted.reaction === snapshot.reaction &&
      this.lastEmitted.sustained === snapshot.sustained
    ) {
      return;
    }
    this.lastEmitted = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('EmotionEngine is disposed');
    }
  }
}

/** 文字列がReactionStateかを判定する(Adapterがイベント名から発火する際に使う)。 */
export { isReactionState };
