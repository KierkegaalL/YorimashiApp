/**
 * hooksイベントログ(FR-11)の記録・保持・エクスポート・消去。
 *
 * 正本:
 * - 1行のフィールド: docs/data.md 4章 / docs/basic-design.md 6.3
 * - 保持期間・パーミッション: 要件定義書 4.11(7日保持で自動削除・0600)
 * - 仮名化エクスポート: 同上(「生ログは非マスクのまま保持」)
 *
 * 設計上の判断(いずれも正本に明記が無いためここで決めて書き残す):
 *
 * 1. **何を記録するか** — `CodeAdapter.handle()` の結果が `applied` または
 *    `ignored-inactive-adapter` のものだけを記録する。
 *    - `applied`: 灯里が反応したイベント。当然記録する。
 *    - `ignored-inactive-adapter`: **利用者は作業している**(灯里がChat側を向いていただけ)。
 *      ログは「灯里の反応の記録」ではなく「利用者の作業の記録」なので落とさない。
 *    - `ignored-unknown-event`: `hookEventName` を型として書けない(HookLogEntry の
 *      イベント名は閉じた union)。api.md 1.1 が対象外としているイベントを勝手に記録しない。
 *    - `ignored-unwatched-path`: **利用者自身が watchedProjectPaths で除外したプロジェクト**。
 *      そのフルパスを7日間ディスクに残すのは、除外した意図に反する。
 *      → この判断は **CodeAdapter.handle() が監視パスを activeAdapter より先に判定すること**に
 *      依存している(逆順だと activeAdapter が chat の間は除外判定に到達せず、除外した
 *      プロジェクトのパスが `ignored-inactive-adapter` として記録されてしまう)。
 *      code-adapter.ts 側にも同じ理由を書いてある。
 *    - `failed`: EmotionEngine の駆動に失敗しただけで、イベント自体は届いている……が、
 *      dispose 中(終了処理)にしか起きないため、その時点でファイルを触らない。
 *
 * 2. **同期書き込みにする** — 追記は `appendFileSync` 1回。hooks は利用者のClaude Codeの
 *    実行経路上にあるため(dispatch.sh は2秒でタイムアウト)遅延が許されないが、
 *    **実測で1行あたり数十μs**であり、非同期キュー(順序保証と終了時フラッシュが要る)を
 *    導入する理由が無い。失敗しても決して例外を投げない(可用性NFR)。
 *
 * 3. **保持期間の自動削除** — 起動時に1回 + 6時間ごとに走らせる。常駐アプリなので
 *    「起動時だけ」では何日でも動き続けた場合に古い行が残る。
 *
 * 形式非依存: hooksイベントの記録は Live2D/スプライトセットのどちらにも分岐しない
 * (shared/hook-events.ts と同じ理由)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ConfigStore } from '../config-store';
import { tryChmod600 } from '../fs-permissions';
import { resolveWithinBase } from '../local-server/safe-path';
import type { HookEventPayload } from '../../shared/hook-events';
import type { HookHandleResult } from '../code-adapter/code-adapter';
import type { HookLogEntry, HookLogSnapshot } from '../../shared/hook-log';

/** ログタブへ一度に渡す最大件数(全件をIPCで運ばない)。 */
export const LOG_SNAPSHOT_LIMIT = 200;

/** 保持期間チェックの間隔。常駐したままでも古い行が残らないようにする。 */
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** `hookEventLogPath` が userData の外を指していた場合のフォールバック(既定値と同じ)。 */
const FALLBACK_LOG_REL_PATH = 'logs/hook-events.jsonl';

export interface HookEventLogDeps {
  configStore: ConfigStore;
  userDataDir: string;
  /** 追記時の通知(ログタブの自動更新に使う)。呼び出し側でスロットルする。 */
  onAppended?: () => void;
}

export class HookEventLog {
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: HookEventLogDeps) {}

  /**
   * ログファイルの絶対パス。`config.logging.hookEventLogPath` は利用者が編集しうるので、
   * **userData 配下に収まることを毎回検証する**(security.md 6章と同じ考え方)。
   * 外を指していた場合は既定の相対パスへ落とし、警告を残す(黙って従わない)。
   */
  get filePath(): string {
    const configured = this.deps.configStore.current.logging.hookEventLogPath;
    const resolved = resolveWithinBase(this.deps.userDataDir, configured);
    if (resolved === null) {
      console.warn(
        `[hook-log] logging.hookEventLogPath が userData の外を指しています(${configured})。既定値を使います。`,
      );
      return path.join(this.deps.userDataDir, FALLBACK_LOG_REL_PATH);
    }
    return resolved;
  }

  /** 起動時の掃除と定期掃除を開始する。 */
  start(): void {
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    // 掃除のためだけにアプリの終了を待たせない。
    this.pruneTimer.unref?.();
  }

  dispose(): void {
    if (this.pruneTimer !== null) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  /**
   * 受信したhooksイベントを1件記録する(記録対象外なら何もしない)。
   * **決して例外を投げない**(hooks の経路上で呼ばれるため。冒頭の判断2)。
   */
  record(payload: HookEventPayload, result: HookHandleResult): void {
    if (result.status !== 'applied' && result.status !== 'ignored-inactive-adapter') {
      return;
    }
    const entry: HookLogEntry = {
      hookEventName: result.event,
      timestamp: new Date().toISOString(),
    };
    const toolName = readString(payload['tool_name']);
    if (toolName !== null) {
      entry.tool_name = toolName;
    }
    const filePath = readFilePath(payload);
    if (filePath !== null) {
      entry.filePath = filePath;
    }
    const exitCode = readExitCode(payload);
    if (exitCode !== null) {
      entry.exit_code = exitCode;
    }

    this.append(entry);
  }

  /** ログタブ用のスナップショット(新しい順・最大 LOG_SNAPSHOT_LIMIT 件)。 */
  getSnapshot(limit = LOG_SNAPSHOT_LIMIT): HookLogSnapshot {
    const target = this.filePath;
    const retentionDays = this.deps.configStore.current.logging.retentionDays;
    const read = this.readEntries();
    if (read.error !== null) {
      return { entries: [], totalCount: 0, retentionDays, filePath: target, error: read.error };
    }
    // 新しい順。ファイルは追記なので末尾が最新。
    const newestFirst = read.entries.slice().reverse();
    return {
      entries: newestFirst.slice(0, Math.max(0, limit)),
      totalCount: read.entries.length,
      retentionDays,
      filePath: target,
      error: null,
    };
  }

  /**
   * 共有用の仮名化を施した本文(JSONL)を作る。**生ログには手を触れない**(要件4.11)。
   * 対応表はこの1回の呼び出し内でのみ有効(毎回振り直す)。
   */
  buildMaskedExport(): { body: string; entryCount: number } {
    const read = this.readEntries();
    const masker = new ProjectPathMasker(
      this.deps.configStore.current.codeAdapter.watchedProjectPaths,
    );
    const lines = read.entries.map((entry) => {
      const masked: HookLogEntry = { ...entry };
      if (masked.filePath !== undefined) {
        masked.filePath = masker.mask(masked.filePath);
      }
      return JSON.stringify(masked);
    });
    return {
      body: lines.length === 0 ? '' : `${lines.join('\n')}\n`,
      entryCount: lines.length,
    };
  }

  /**
   * ログを消去する。ファイルごと消さずに**空にする**(0600のファイルを残しておけば、
   * 次の追記でパーミッションが緩い状態から始まらない)。
   *
   * @returns 消した件数。失敗時は例外(呼び出し側が利用者へ伝える)。
   */
  clear(): number {
    const removed = this.readEntries().entries.length;
    this.writeAll('');
    return removed;
  }

  // ── 内部 ──────────────────────────────────────────────

  /** 1行追記する。失敗は握る(hooks の経路を止めない)。 */
  private append(entry: HookLogEntry): void {
    const target = this.filePath;
    try {
      // ログはフルパスを含むため、ディレクトリごと所有者限定にする(data.md 3章)。
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const existed = fs.existsSync(target);
      fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      if (!existed) {
        // 既存ファイルには効かないが、新規作成時に umask で緩んだ場合に締め直す。
        tryChmod600(target);
      }
      this.deps.onAppended?.();
    } catch (err) {
      console.warn('[hook-log] 追記に失敗しました:', err);
    }
  }

  /**
   * ファイル全体を読んで有効な行だけを返す(古い順)。
   * 壊れた行は捨てるが、**ファイル自体が読めない場合は空と区別して error を返す**
   * (「ログが無い」と「読めない」を同じ表示にしない。constraints.md「嘘をつかない」)。
   */
  private readEntries(): { entries: HookLogEntry[]; error: string | null } {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], error: null }; // 未作成 = まだ1件も受けていない。正常
      }
      return { entries: [], error: err instanceof Error ? err.message : String(err) };
    }

    const entries: HookLogEntry[] = [];
    for (const line of raw.split('\n')) {
      const entry = parseEntry(line);
      if (entry !== null) {
        entries.push(entry);
      }
    }
    return { entries, error: null };
  }

  /** 全文を書き直す(一時ファイル + rename でアトミックに)。 */
  private writeAll(body: string): void {
    const target = this.filePath;
    const tmp = `${target}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, target);
    tryChmod600(target);
  }

  /**
   * `retentionDays` より古い行を削除する(要件4.11「7日保持で自動削除」)。
   * 削除すべき行が無ければ**ファイルを書き換えない**(毎回の書き戻しを避ける)。
   */
  private prune(): void {
    try {
      const retentionDays = this.deps.configStore.current.logging.retentionDays;
      const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const read = this.readEntries();
      if (read.error !== null) {
        return; // 読めないものを消しにいかない
      }
      const kept = read.entries.filter((entry) => {
        const at = Date.parse(entry.timestamp);
        // 日付を解釈できない行は**残す**(消す判断の根拠が無いため。安全側)。
        return Number.isNaN(at) || at >= threshold;
      });
      if (kept.length === read.entries.length) {
        return;
      }
      this.writeAll(kept.map((entry) => JSON.stringify(entry)).join('\n') + (kept.length > 0 ? '\n' : ''));
      console.log(`[hook-log] 保持期間(${retentionDays}日)を過ぎた ${read.entries.length - kept.length} 件を削除しました`);
    } catch (err) {
      console.warn('[hook-log] 保持期間の整理に失敗しました:', err);
    }
  }
}

/**
 * プロジェクト名の仮名化(要件4.11「プロジェクト名を仮名化したエクスポート」)。
 *
 * `watchedProjectPaths` を既知のプロジェクトルートとして `project-a` / `project-b` … に
 * 置き換える(長いパスから先に照合するので、入れ子のプロジェクトでも深い方が勝つ)。
 *
 * **どのルートにも属さないパス**(watchedProjectPaths が空=絞り込み無し、が既定なので
 * 普通に起こる)は、ファイル名だけを残して `project-unknown/<basename>` にする。
 * アプリはプロジェクトの境界を知らないため、**知らないものを推測で分類しない**という判断。
 * 別々のプロジェクトが同じ仮名に潰れるのは情報の欠落であって漏洩ではない(ディレクトリ部分は
 * すべて落ちる)。ファイル名を残すのは、仮名化の対象が**プロジェクト名/パス**だからである。
 */
class ProjectPathMasker {
  private readonly roots: string[];
  private readonly assigned = new Map<string, string>();

  constructor(watchedProjectPaths: readonly string[]) {
    this.roots = watchedProjectPaths
      .map((p) => path.resolve(p))
      .sort((a, b) => b.length - a.length);
  }

  mask(filePath: string): string {
    const resolved = path.resolve(filePath);
    for (const root of this.roots) {
      if (resolved === root || resolved.startsWith(root + path.sep)) {
        const alias = this.aliasFor(root);
        const rest = resolved.slice(root.length).replace(/^[/\\]+/, '');
        return rest.length === 0 ? alias : `${alias}/${rest}`;
      }
    }
    return `project-unknown/${path.basename(resolved)}`;
  }

  /** 出現順に project-a, project-b, … を割り当てる(z を超えたら project-aa 等)。 */
  private aliasFor(root: string): string {
    const existing = this.assigned.get(root);
    if (existing !== undefined) {
      return existing;
    }
    const alias = `project-${indexToLetters(this.assigned.size)}`;
    this.assigned.set(root, alias);
    return alias;
  }
}

/** 0→a, 1→b, … 25→z, 26→aa。仮名が枯渇しないようにする。 */
function indexToLetters(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** JSONL 1行を HookLogEntry として読む。壊れていれば null。 */
function parseEntry(line: string): HookLogEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  const eventName = raw['hookEventName'];
  const timestamp = raw['timestamp'];
  if (typeof eventName !== 'string' || typeof timestamp !== 'string') {
    return null;
  }
  const entry: HookLogEntry = {
    hookEventName: eventName as HookLogEntry['hookEventName'],
    timestamp,
  };
  if (typeof raw['tool_name'] === 'string') {
    entry.tool_name = raw['tool_name'];
  }
  if (typeof raw['filePath'] === 'string') {
    entry.filePath = raw['filePath'];
  }
  if (typeof raw['exit_code'] === 'number') {
    entry.exit_code = raw['exit_code'];
  }
  return entry;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 記録するパスを決める。
 *
 * `tool_input.file_path` を第一候補にする(**実測**: Claude Code 2.1.205 のhooksドキュメントが
 * stdin JSON の例として `"tool_input": { "file_path": "/path/to/file.txt" }` を示しており、
 * このリポジトリ自身の開発用hook `.claude/hooks/post-edit-check.sh` も同じ位置を読んで動いている)。
 * 無ければ `cwd`(プロジェクトの作業ディレクトリ)に落とす。Notification/Stop のように
 * ファイルを伴わないイベントでも、どのプロジェクトの出来事かは残したいため。
 */
function readFilePath(payload: HookEventPayload): string | null {
  const toolInput = payload['tool_input'];
  if (typeof toolInput === 'object' && toolInput !== null) {
    const candidate = (toolInput as Record<string, unknown>)['file_path'];
    const asString = readString(candidate);
    if (asString !== null) {
      return asString;
    }
  }
  return readString(payload['cwd']);
}

/**
 * 終了コードを拾う。**無ければ付けない**(shared/hook-log.ts の実測メモ参照:
 * hooks の stdin JSON に `exit_code` は定義されていない)。将来 Claude Code 側が
 * 付けるようになった場合に拾えるよう、素直な2箇所だけを見る。
 */
function readExitCode(payload: HookEventPayload): number | null {
  const top = payload['exit_code'];
  if (typeof top === 'number' && Number.isFinite(top)) {
    return top;
  }
  const response = payload['tool_response'];
  if (typeof response === 'object' && response !== null) {
    const nested = (response as Record<string, unknown>)['exit_code'];
    if (typeof nested === 'number' && Number.isFinite(nested)) {
      return nested;
    }
  }
  return null;
}
