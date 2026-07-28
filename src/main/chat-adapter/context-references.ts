/**
 * @参照(C-23 / chat-pane.md 論点7)の文脈組立。
 *
 * ユーザーが明示選択した**固定の3対象**(作業ログ・表示中のモデル・設定)だけを扱う。
 * **本文の文字列から任意のパスやキーを解決することは一切しない**(security.md 6章)。これは
 * ツール呼び出しでもagentic機能でもなく、あらかじめ決められた読み出し関数を呼ぶだけの
 * 限定的な文脈参照であり、要件定義書10章のagentic線引きの外側にある。
 *
 * **Electron非依存**(`AppConfig`/`HookLogSnapshot`の型と`resolveActiveModel`だけを使う純粋関数)。
 * GUIを伴わない検証ができる(.claude/rules/build-commands.md)。
 *
 * 形式非依存: 「表示中のモデル」はLive2D/スプライトセットのどちらのスロットも同じ関数で
 * フォーマットする(renderTypeで分岐はするが、両形式が同じ経路を通るため対称性は保たれる)。
 */

import { resolveActiveModel } from '../model/active-model';
import { MAX_MODEL_SLOTS } from '../../shared/model-manage';
import type { AppConfig } from '../../shared/config-schema';
import type { AtReferenceKey } from '../../shared/chat';
import type { HookLogSnapshot } from '../../shared/hook-log';

/**
 * 「作業ログ」参照で取り込む件数。直近のみに絞る(全件を毎回APIへ送ると入力が肥大化し、
 * かつ大半は今回の会話と無関係になるため)。**実測に基づく値ではない暫定値**。
 */
export const LOG_REFERENCE_LIMIT = 5;

export interface ContextReferenceDeps {
  /** 参照時点の config(呼び出し側が configStore.current を渡す)。 */
  config: AppConfig;
  /**
   * 作業ログの直近スナップショットを取る(HookEventLog.getSnapshot相当)。
   * ログがまだ初期化されていない場合は null を返す関数を渡すこと(推測で埋めない)。
   */
  getLogSnapshot: (limit: number) => HookLogSnapshot | null;
}

/**
 * 選択されたキー群から文脈テキストを組み立てる。選択が無ければ null(参照なし=送信本文は
 * ユーザー入力のみ)。
 *
 * 各ブロックは `[参照: ラベル]`〜`[/参照]` で囲む。ユーザーが実際にタイプした文面と混ざって
 * 「ユーザー自身がこの文面を書いた」ように見えないようにするため(APIへ送る内容とRendererが
 * 表示する内容の非対称は shared/chat.ts の ChatTurn の設計コメントと同じ理屈)。
 */
export function assembleReferencedContext(
  keys: readonly AtReferenceKey[],
  deps: ContextReferenceDeps,
): string | null {
  if (keys.length === 0) {
    return null;
  }
  return keys.map((key) => formatBlock(key, deps)).join('\n\n');
}

function formatBlock(key: AtReferenceKey, deps: ContextReferenceDeps): string {
  switch (key) {
    case 'logs':
      return wrap('作業ログ(直近hooks)', formatLogs(deps.getLogSnapshot(LOG_REFERENCE_LIMIT)));
    case 'model':
      return wrap('表示中のモデル', formatModel(deps.config));
    case 'settings':
      return wrap('設定', formatSettings(deps.config));
    default:
      // AtReferenceKey は union なので網羅性はTSが検査する。実行時に来たら不正な呼び出し元。
      return wrap(key, '(不明な参照キーです)');
  }
}

function wrap(label: string, body: string): string {
  return `[参照: ${label}]\n${body}\n[/参照]`;
}

function formatLogs(snapshot: HookLogSnapshot | null): string {
  if (snapshot === null) {
    return '(ログはまだ初期化されていません)';
  }
  if (snapshot.error !== null) {
    // 読めなかった事実を正直に伝える(黙って空扱いにしない。constraints.md「嘘をつかない」)。
    return `(ログの読み出しに失敗しました: ${snapshot.error})`;
  }
  if (snapshot.entries.length === 0) {
    return '(記録されたイベントはまだありません)';
  }
  return snapshot.entries
    .map((e) => {
      const parts = [e.timestamp, e.hookEventName];
      if (e.tool_name !== undefined) {
        parts.push(e.tool_name);
      }
      if (e.exit_code !== undefined) {
        parts.push(`exit=${e.exit_code}`);
      }
      return `- ${parts.join(' ')}`;
    })
    .join('\n');
}

function formatModel(config: AppConfig): string {
  const active = resolveActiveModel(config);
  if (active === null) {
    return '(モデルは未導入です)';
  }
  const formatLabel = active.renderType === 'live2d' ? 'Live2D' : 'スプライトセット';
  const cubismDetail =
    active.renderType === 'live2d' && active.cubismVersion !== undefined
      ? ` / ${active.cubismVersion === 'cubism2' ? 'Cubism 2' : 'Cubism 4/5'}`
      : '';
  return `${active.name}(${formatLabel}${cubismDetail})`;
}

/**
 * **APIキーは含めない**(security.md 5章「APIキーを扱うのはMainのみ」)。
 * `watchedProjectPaths`も実パスではなく件数のみにする(「作業ログ」参照は元々パスを含む
 * 設計だが=data.md 4章、こちらは設定の要約が目的で、ファイルパスを追加で載せる理由が無いため)。
 */
function formatSettings(config: AppConfig): string {
  const paths = config.codeAdapter.watchedProjectPaths;
  return [
    `activeAdapter: ${config.activeAdapter}`,
    `chatAdapter.mode: ${config.chatAdapter.mode}`,
    `chatAdapter.model: ${config.chatAdapter.model}`,
    `codeAdapter.serverPort: ${config.codeAdapter.serverPort}`,
    `codeAdapter.watchedProjectPaths: ${
      paths.length === 0 ? '絞り込みなし(すべてのプロジェクトに反応)' : `${paths.length}件`
    }`,
    `model.autoSwitchByMode: ${config.model.autoSwitchByMode}`,
    `model.slots: ${config.model.slots.length}/${MAX_MODEL_SLOTS}`,
  ].join('\n');
}
