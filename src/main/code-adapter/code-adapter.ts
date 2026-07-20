/**
 * Code Adapter(FR-2)。利用者側のClaude Codeが発火したhooksイベントを
 * ローカルサーバー(`POST /hook`)経由で受け取り、EmotionEngineを駆動する。
 *
 * 正本:
 * - イベント↔呼び出しの対応: docs/api.md 1.1 / docs/basic-design.md 7.1
 * - 通信方式・非ブロッキング要件: docs/api.md 1.3(dispatch.shは常にexit 0、curlは2秒)
 *
 * **Chat Adapterとの決定的な違い**: Chat側のthinkingはsustain付きで、応答完了まで持続し
 * release()で明示解除する(lipsync.md)。**Code側のthinkingは一過性**で、
 * reactionDurationMsで自然消滅する。PreToolUseに対応する「終わり」のイベントは
 * PostToolUse/PostToolUseFailureだが、ツールが中断・クラッシュした場合に**どちらも来ない**
 * 経路が存在し、sustainにするとthinkingが永久固着する。正本(api.md 1.1)も
 * `engine.trigger('thinking')` とだけ書いており sustain を指定していない。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(EmotionEngineへ状態キーを渡すだけで
 * CharacterRendererに触れない)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 *
 * 可用性(非機能要件): このクラスは**決して例外を投げない**。hooksは利用者のClaude Codeの
 * 実行経路上にあり、ここで落ちるとローカルサーバーのレスポンスが遅れて利用者の作業を妨げうる。
 * 解釈できない入力は黙って捨てるのではなく、警告ログに残したうえで無視する。
 */

import path from 'node:path';

import type { EmotionEngine } from '../emotion-engine';
import type { ConfigStore } from '../config-store';
import {
  resolveHookEventName,
  type HookEventName,
  type HookEventPayload,
} from '../../shared/hook-events';

/**
 * UserPromptSubmitのクールダウン(ms)。api.md 1.1「クールダウンを短めに設定」の具体値。
 * 既定のcooldownMs(1500)のままだと、送信直後にNotification等が続いたときに
 * 「送信に反応する」というこのイベント本来の役割が抑制されやすいため短くする。
 */
export const USER_PROMPT_COOLDOWN_MS = 500;

export interface CodeAdapterDeps {
  engine: EmotionEngine;
  configStore: ConfigStore;
}

/** 受信したイベントの処理結果(検証・ログ・将来のFR-11で使う)。 */
export type HookHandleResult =
  /** EmotionEngineを駆動した。 */
  | { status: 'applied'; event: HookEventName }
  /** 解釈対象外のイベント、または名前を解決できなかった。 */
  | { status: 'ignored-unknown-event' }
  /** activeAdapterがcodeでないため適用しなかった(FR-1)。 */
  | { status: 'ignored-inactive-adapter'; event: HookEventName }
  /** watchedProjectPathsの対象外プロジェクトからの発火だった。 */
  | { status: 'ignored-unwatched-path'; event: HookEventName; cwd: string }
  /** EmotionEngineの駆動に失敗した(disposed等)。 */
  | { status: 'failed'; event: HookEventName; error: unknown };

export class CodeAdapter {
  constructor(private readonly deps: CodeAdapterDeps) {}

  /**
   * `POST /hook` のペイロードを1件処理する。LocalServerの`onHookEvent`へ渡す。
   * **同期・軽量**に保つ(dispatch.shは2秒でタイムアウトするため、ここで待たない)。
   */
  handle(payload: HookEventPayload): HookHandleResult {
    const event = resolveHookEventName(payload);
    if (event === null) {
      // Claude Codeはapi.md 1.1が対象としない他イベント(PreCompact等)も発火しうる。
      // 想定内なのでwarnにしない。
      return { status: 'ignored-unknown-event' };
    }

    const config = this.deps.configStore.current;

    // **監視対象の絞り込みを先に見る**(activeAdapterより前)。感情の駆動だけを考えるなら
    // どちらが先でも結果は同じ(どちらも適用しない)だが、この戻り値は FR-11 のログが
    // 「記録するか否か」の判断に使う。順序を逆にすると、activeAdapterがchat(既定値)の間は
    // watchedProjectPaths の判定に到達せず、**利用者が明示的に除外したプロジェクトの
    // フルパスがログに残る**(hook-event-log.ts の記録対象の判断が前提を失う)。
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
    if (!this.isWatchedProject(cwd)) {
      return { status: 'ignored-unwatched-path', event, cwd: cwd ?? '' };
    }

    // FR-1: 灯里が「何に」反応するかはユーザーが選ぶ。Chatを選んでいる間にCode側の
    // イベントで感情を動かすと、Chat AdapterのthinkingがPreToolUseに割り込まれる等の
    // 取り合いが起きる。適用しないだけで、受信そのものは成功として204を返す
    // (dispatch.sh側をエラーにしても利用者には何もできないため)。
    if (config.activeAdapter !== 'code') {
      return { status: 'ignored-inactive-adapter', event };
    }

    try {
      this.apply(event);
      return { status: 'applied', event };
    } catch (error) {
      // EmotionEngineがdispose済み(終了処理と競合)等。可用性のため握って返す。
      console.warn('[code-adapter] failed to apply hook event:', event, error);
      return { status: 'failed', event, error };
    }
  }

  /** イベント→EmotionEngine呼び出し(api.md 1.1の表をそのまま写したもの)。 */
  private apply(event: HookEventName): void {
    const { engine } = this.deps;
    switch (event) {
      case 'PreToolUse':
        // 一過性(sustainにしない)。冒頭のコメント参照。
        engine.trigger('thinking');
        return;
      case 'PostToolUse':
        // Claude Codeの仕様上、成功時のみ発火する(実測で確認: 2.1.205の
        // ヘルプ表が「Run after successful tool」と記載)。
        engine.onToolResult(true);
        return;
      case 'PostToolUseFailure':
        engine.onToolResult(false);
        return;
      case 'Notification':
        engine.trigger('curious');
        return;
      case 'UserPromptSubmit':
        engine.trigger('curious', { cooldownMs: USER_PROMPT_COOLDOWN_MS });
        return;
      case 'Stop':
        // Moodのみidle寄りへ重心移動する。Reactionには触れない(basic-design.md 7.1)。
        engine.onSessionStop();
        return;
    }
  }

  /**
   * `codeAdapter.watchedProjectPaths` による絞り込み。
   *
   * **空配列(既定)は「絞り込み無し=全て受け入れる」**とする。正本に明示が無いため
   * ここで決めて明記する(黙って決めない): 既定値が空である以上、空を「何も受け付けない」
   * と解釈すると、オンボーディングを完了せずhooksだけ手で設定した利用者に対して
   * アプリが完全に無反応になる。「設定されていない＝制限していない」の方が驚きが小さい。
   *
   * 判定はパスの前方一致ではなく**ディレクトリ境界での包含**で行う。文字列の前方一致だと
   * `/work/app` の設定が `/work/app-backup` にも一致してしまう。
   */
  private isWatchedProject(cwd: string | null): boolean {
    const watched = this.deps.configStore.current.codeAdapter.watchedProjectPaths;
    if (watched.length === 0) {
      return true;
    }
    if (cwd === null || cwd.length === 0) {
      // 絞り込みが設定されているのに発火元が分からない場合は、対象外として扱う
      // (別プロジェクトのイベントで灯里が動く方が、無反応より紛らわしい)。
      return false;
    }
    const target = path.resolve(cwd);
    return watched.some((base) => {
      const resolved = path.resolve(base);
      return target === resolved || target.startsWith(resolved + path.sep);
    });
  }
}
