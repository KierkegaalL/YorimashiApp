/**
 * hooksイベントログ(FR-11)の共有契約。
 * 正本: docs/data.md 4章(1行あたりのフィールド)/ docs/basic-design.md 6.3。
 *
 * 「ログ」という語がこのリポジトリでは二重に使われるので区別する:
 *  - **本モジュールが扱うのは、アプリの利用者側のClaude Codeが発火したhooksイベントの記録**
 *    (FR-2で受信したもの)。会話ペインの `@作業ログ` 参照(C-23)もここを読む。
 *  - `console.log` 等のアプリ自身の診断出力は別物で、ここには入らない。
 *
 * 形式非依存: hooksイベントは Live2D/スプライトセットのどちらも意識しない
 * (shared/hook-events.ts と同じ理由)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import type { HookEventName } from './hook-events';

/**
 * JSONL 1行ぶん。**フィールドは data.md 4章と一対一**(勝手に増やさない)。
 *
 * `exit_code` について(実測メモ):
 * Claude Code 2.1.205 のバイナリ内ドキュメントが示す hooks の stdin JSON は
 * `session_id` / `tool_name` / `tool_input` / `tool_response`(PostToolUseのみ)であり、
 * **`exit_code` は定義されていない**。したがって多くのイベントでこの値は付かない。
 * 付いていれば拾うが、**無いものを推測で埋めない**(失敗の判定は `PostToolUseFailure`
 * というイベント名そのものが担う。shared/hook-events.ts の注記参照)。
 */
export interface HookLogEntry {
  hookEventName: HookEventName;
  tool_name?: string;
  exit_code?: number;
  /** プロジェクト名を含むフルパス。**エクスポート時のみ仮名化**し、生ログは非マスクで保つ。 */
  filePath?: string;
  /** ISO8601。 */
  timestamp: string;
}

/** ログタブ(FR-7)が描画に使うスナップショット。 */
export interface HookLogSnapshot {
  /** 新しい順。件数は `limit` で頭打ちにする(全件をIPCで運ばない)。 */
  entries: HookLogEntry[];
  /** ファイル内の有効な総件数(表示件数より多いことがある)。 */
  totalCount: number;
  /** 保持日数(config.logging.retentionDays)。画面の説明文に出す。 */
  retentionDays: number;
  /** ログファイルの絶対パス。**説明のために見せるだけ**で、Rendererから書き込みはしない。 */
  filePath: string;
  /** 読み出しに失敗した理由(null なら正常)。**空とエラーを混同しない**ために持つ。 */
  error: string | null;
}

/** エクスポート(共有用・パス仮名化)の結果。 */
export type HookLogExportResult =
  | { status: 'saved'; path: string; entryCount: number }
  /** 保存ダイアログをキャンセルした。 */
  | { status: 'canceled' }
  /** 書き出す行が無かった(ファイルは作らない)。 */
  | { status: 'empty' }
  | { status: 'failed'; message: string };

/** 消去の結果。`canceled` は確認ダイアログで「やめる」を選んだ場合。 */
export type HookLogClearResult =
  | { status: 'cleared'; removedCount: number }
  | { status: 'canceled' }
  | { status: 'failed'; message: string };
