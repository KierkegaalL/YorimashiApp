/**
 * Claude Code hooks 連携(FR-2)の共有契約。正本は docs/api.md 1章 / basic-design.md 7.1。
 *
 * ここに置く理由: イベント名の一覧は **Code Adapter(Main)の受信側**と、
 * **オンボーディング(FR-14/#10)が利用者へ提示する `.claude/settings.json` テンプレート**の
 * 両方が使う。二重に書くと片方だけ増減させたときに、UIは案内しているのにアプリが解釈しない
 * (またはその逆)という食い違いが起きる。
 *
 * > **注意**: ここで扱うのは**アプリの利用者側**の Claude Code が発火する hooks であり、
 * > このリポジトリ自身の開発用 hooks(`.claude/settings.json`)とは別物(CLAUDE.md / api.md 1.2)。
 *
 * 形式非依存: hooks は Live2D/スプライトセットのどちらも意識しない(EmotionEngine へ
 * 状態キーを渡すだけで CharacterRenderer に触れない)。よって対称性チェック(CLAUDE.md原則4)
 * の対象外。
 */

/**
 * アプリが解釈する hooks イベント(api.md 1.1 の表)。
 *
 * **実在性は実測で確認済み**(Claude Code 2.1.205 のバイナリ内ヘルプ表):
 *   `| PostToolUseFailure | Tool name | Run after tool fails |`
 * `PostToolUse` は「Run after **successful** tool」であり、失敗時は発火しない。
 * したがって失敗検知は `PostToolUseFailure` に依存する(この2つは対で実装する)。
 *
 * Claude Code はこれ以外にも PermissionRequest / PreCompact / PostCompact / SessionStart /
 * SubagentStop 等を発火するが、api.md 1.1 が対象外としているため**受け取っても無視する**
 * (勝手に感情へ結びつけない。増やす場合は Notion 正本の更新を伴う)。
 */
export const HOOK_EVENT_NAMES = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'UserPromptSubmit',
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

export function isHookEventName(value: string): value is HookEventName {
  return (HOOK_EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * `POST /hook` が受け取るペイロード。Claude Code が stdin へ渡す JSON がそのまま届く
 * (dispatch.sh は薄いプロキシで、加工は最小限。api.md 1.3)。
 *
 * **信頼できない入力として扱う**: ローカルサーバーは 127.0.0.1 限定 + トークン認証済みだが、
 * 中身の形は Claude Code のバージョンに依存するため、全フィールドを optional の unknown として
 * 受け、Code Adapter 側で型を確かめてから使う。
 */
export interface HookEventPayload {
  /** dispatch.sh が付与するイベント名(api.md 1.3)。 */
  hookEventName?: unknown;
  /** Claude Code が stdin JSON に含めるイベント名(実測: 2.1.205 に文字列として存在)。 */
  hook_event_name?: unknown;
  /** 発火元プロジェクトの作業ディレクトリ。watchedProjectPaths の絞り込みに使う。 */
  cwd?: unknown;
  /** ツール名(PreToolUse / PostToolUse / PostToolUseFailure)。 */
  tool_name?: unknown;
  session_id?: unknown;
  [key: string]: unknown;
}

/**
 * ペイロードからイベント名を解決する。
 *
 * `hookEventName`(dispatch.sh が付与)を優先し、無ければ Claude Code 由来の
 * `hook_event_name` を見る。**両対応にするのは、dispatch.sh が jq を持たない環境で
 * イベント名を付与できずに素通しする経路があるため**(api.md 1.3 の jq 前提は
 * jq 未導入の macOS では成立しない)。片方しか見ないと、その環境で全イベントが
 * 黙って捨てられ「アプリが無反応」になる。
 *
 * @returns 解釈対象のイベント名。対象外・不明なら null。
 */
export function resolveHookEventName(payload: HookEventPayload): HookEventName | null {
  const candidates = [payload.hookEventName, payload.hook_event_name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isHookEventName(candidate)) {
      return candidate;
    }
  }
  return null;
}
