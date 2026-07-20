/**
 * 利用者のプロジェクトの `.claude/settings.json` に貼り付けてもらう hooks 設定の生成
 * (api.md 1.2 のテンプレート。オンボーディング FR-14 がコピー用に提示する)。
 *
 * **アプリはこのファイルを書き込まない。** 利用者の既存ファイルであり、既にhooksが
 * 設定されている可能性がある。上書きすると既存の設定を破壊するため、生成するのは
 * 「貼り付けてもらうテキスト」までに留める(onboarding.md 論点3の決定)。
 * 新規ファイルである `dispatch.sh` の配置だけはアプリが行う(dispatch-script.ts)。
 *
 * > **注意**: ここで扱うのは**アプリの利用者側のプロジェクト**の `.claude/settings.json`
 * > であり、このリポジトリ自身の開発用hooksとは別物(CLAUDE.md / api.md 1.2の注記)。
 */

import { HOOK_EVENT_NAMES, type HookEventName } from '../../shared/hook-events';

/**
 * プロジェクトルートから見た dispatch.sh の配置先。**テンプレートの `command` と
 * 実際の書き込み先の単一の情報源**にする(片方だけ変えると、案内どおりに貼っても
 * スクリプトが見つからない状態になる)。
 */
export const DISPATCH_SCRIPT_REL_PATH = '.claude/hooks/dispatch.sh';

/**
 * イベントごとの matcher(api.md 1.2)。ツール名で絞れるイベントだけが matcher を持つ。
 *
 * `Record<HookEventName, ...>` にしてあるため、shared/hook-events.ts に7つ目のイベントを
 * 足すとここが型エラーになる。受信側(code-adapter.ts)だけ増やしてテンプレートに出し忘れる、
 * という片側だけの実装漏れを型で防ぐための構造。
 */
const EVENT_MATCHERS: Record<HookEventName, string | null> = {
  PreToolUse: '*',
  PostToolUse: '*',
  PostToolUseFailure: '*',
  Notification: null,
  Stop: null,
  UserPromptSubmit: null,
};

interface HookCommandEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string }>;
}

/**
 * `.claude/settings.json` に追記する hooks 設定を生成する。
 *
 * `$CLAUDE_PROJECT_DIR` は Claude Code がプロジェクトルートへ展開する変数。絶対パスを
 * 焼き込まないことで、プロジェクトを移動・複製しても設定がそのまま効く。
 */
export function buildHooksSettingsSnippet(): string {
  const hooks: Record<string, HookCommandEntry[]> = {};

  for (const event of HOOK_EVENT_NAMES) {
    const matcher = EVENT_MATCHERS[event];
    const commands: HookCommandEntry['hooks'] = [
      { type: 'command', command: `$CLAUDE_PROJECT_DIR/${DISPATCH_SCRIPT_REL_PATH} ${event}` },
    ];
    // matcher を持つイベントでは matcher を先に置く(api.md 1.2 の並びに合わせる。
    // 利用者が見比べる対象であり、キー順が違うと同じものだと分かりにくいため)。
    hooks[event] = [matcher !== null ? { matcher, hooks: commands } : { hooks: commands }];
  }

  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}
