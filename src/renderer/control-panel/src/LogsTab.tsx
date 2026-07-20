/**
 * ログタブ(FR-11)。UIの正: docs/mockups/control-panel.jsx L1348-1393。
 *
 * 表示するのは**受信済みのhooksイベント**だけで、件数が0なら0と言う(モックアップの
 * サンプル4行を焼き付けない。constraints.md「アプリが自分の状態について嘘をつかない」)。
 *
 * ## モックアップとの意図的な差分(理由を明記)
 *
 * モックアップは全行に「成功 / 失敗」の2値バッジを出しているが、これはサンプル4行が
 * 前提の見た目で、そのまま実装すると嘘になる:
 *  - `Notification` や `Stop` に成否は無い(モックアップは Notification を「成功」と描いている)
 *  - `PreToolUse` はツールが**始まった**だけで、まだ成否が決まっていない
 * そこで**バッジの形・位置・配色はモックアップのまま**、文言と色をイベントごとに正しくする
 * (成功=mint / 失敗=朱 / それ以外=中間色)。成否が決まるのは PostToolUse(成功)と
 * PostToolUseFailure(失敗)だけで、これは Claude Code 側の仕様(shared/hook-events.ts の実測)。
 *
 * 形式非依存: hooksイベントの表示は Live2D/スプライトセットのどちらにも分岐しない。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { useCallback, useEffect, useState } from 'react';

import { useTheme } from './theme';
import { Section, Row, PanelButton } from './panel-ui';
import type { HookEventName } from '../../../shared/hook-events';
import type { HookLogEntry, HookLogSnapshot } from '../../../shared/hook-log';

/** バッジの意味。成否が定まるイベントだけを ok/fail にする(上記の差分理由)。 */
type BadgeKind = 'ok' | 'fail' | 'neutral';

/**
 * イベントごとの表示。`Record<HookEventName, …>` なので、shared/hook-events.ts に
 * イベントを足すとここが型エラーになる(受信だけ実装して画面に出し忘れるのを防ぐ)。
 */
const EVENT_BADGES: Record<HookEventName, { label: string; kind: BadgeKind }> = {
  PreToolUse: { label: '開始', kind: 'neutral' },
  PostToolUse: { label: '成功', kind: 'ok' },
  PostToolUseFailure: { label: '失敗', kind: 'fail' },
  Notification: { label: '通知', kind: 'neutral' },
  Stop: { label: '停止', kind: 'neutral' },
  UserPromptSubmit: { label: '送信', kind: 'neutral' },
};

/** 操作結果の一言(成功・失敗どちらも黙らせない)。 */
interface ActionNotice {
  tone: 'info' | 'error';
  text: string;
}

export function LogsTab(): React.JSX.Element {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<HookLogSnapshot | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.yorimashi?.logs;
    if (!api) {
      return;
    }
    try {
      setSnapshot(await api.get());
    } catch (err) {
      setNotice({ tone: 'error', text: `ログを読み込めませんでした: ${messageOf(err)}` });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 新着は「更新があった」だけが飛んでくるので、その都度読み直す(表示はファイルが正)。
    const unsubscribe = window.yorimashi?.logs.onChanged(() => void refresh());
    return () => unsubscribe?.();
  }, [refresh]);

  const handleExport = async (): Promise<void> => {
    const api = window.yorimashi?.logs;
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.export();
      switch (result.status) {
        case 'saved':
          setNotice({ tone: 'info', text: `${result.entryCount}件を書き出しました: ${result.path}` });
          break;
        case 'empty':
          setNotice({ tone: 'info', text: '書き出せるイベントがまだありません。' });
          break;
        case 'canceled':
          setNotice(null);
          break;
        case 'failed':
          setNotice({ tone: 'error', text: `書き出しに失敗しました: ${result.message}` });
          break;
      }
    } catch (err) {
      setNotice({ tone: 'error', text: `書き出しに失敗しました: ${messageOf(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async (): Promise<void> => {
    const api = window.yorimashi?.logs;
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      // 確認ダイアログはMain(ネイティブ)が出す。ここでは結果だけを扱う。
      const result = await api.clear();
      switch (result.status) {
        case 'cleared':
          setNotice({ tone: 'info', text: `${result.removedCount}件を消去しました。` });
          await refresh();
          break;
        case 'canceled':
          setNotice(null);
          break;
        case 'failed':
          setNotice({ tone: 'error', text: `消去に失敗しました: ${result.message}` });
          break;
      }
    } catch (err) {
      setNotice({ tone: 'error', text: `消去に失敗しました: ${messageOf(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const entries = snapshot?.entries ?? [];
  const retentionDays = snapshot?.retentionDays ?? null;

  return (
    <>
      <Section
        title="hooks イベントログ"
        hint={
          retentionDays === null
            ? undefined
            : `${retentionDays}日を過ぎたイベントは自動で削除されます。${
                snapshot && snapshot.totalCount > entries.length
                  ? `全${snapshot.totalCount}件のうち直近${entries.length}件を表示しています。`
                  : ''
              }`
        }
      >
        {snapshot === null ? (
          <Row label="読み込み中…" last />
        ) : snapshot.error !== null ? (
          // 「まだ無い」と「読めない」を同じ表示にしない。
          <Row label="ログを読み込めませんでした" sub={snapshot.error} last />
        ) : entries.length === 0 ? (
          <Row
            label="まだイベントを受け取っていません"
            sub="Claude Code で作業すると、ここに記録されます(Code Adapter選択時)。"
            last
          />
        ) : (
          entries.map((entry, index) => (
            <LogRow
              key={`${entry.timestamp}-${index}`}
              entry={entry}
              last={index === entries.length - 1}
            />
          ))
        )}
      </Section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PanelButton onClick={() => void handleExport()} disabled={busy}>
          エクスポート(共有用・パスをマスク)
        </PanelButton>
        <PanelButton onClick={() => void handleClear()} disabled={busy} subdued>
          ログを消去する
        </PanelButton>
      </div>

      {notice && (
        <div
          style={{
            fontFamily: "'M PLUS 1 Code', sans-serif",
            fontSize: 11.5,
            color: notice.tone === 'error' ? theme.warnText : theme.inkDim,
            marginTop: 8,
            lineHeight: 1.6,
            wordBreak: 'break-all',
          }}
        >
          {notice.text}
        </div>
      )}

      <div
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 11.5,
          color: theme.iconInactive,
          marginTop: 8,
          lineHeight: 1.6,
        }}
      >
        エクスポートしたファイルは、プロジェクト名を project-a / project-b のような仮名に置き換えています。元のログ(このアプリ内)はそのまま残ります。
      </div>
    </>
  );
}

function LogRow({ entry, last }: { entry: HookLogEntry; last: boolean }): React.JSX.Element {
  const theme = useTheme();
  // 未知のイベント名が混ざったログ(古い形式・手で編集した等)でも落とさない。
  const badge = EVENT_BADGES[entry.hookEventName] ?? { label: '—', kind: 'neutral' as BadgeKind };
  const colors =
    badge.kind === 'ok'
      ? { color: theme.mint, background: theme.mintTag }
      : badge.kind === 'fail'
        ? { color: theme.sealRed, background: theme.sealRedTag }
        : { color: theme.inkDim, background: theme.bgRaised };

  return (
    <Row
      label={entry.hookEventName}
      sub={`${formatTime(entry.timestamp)} ・ ${entry.tool_name ?? '—'}${
        entry.exit_code === undefined ? '' : ` ・ exit ${entry.exit_code}`
      }`}
      last={last}
    >
      <span
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
          ...colors,
        }}
      >
        {badge.label}
      </span>
    </Row>
  );
}

/** ISO8601 → ローカル時刻 HH:MM:SS。解釈できない値はそのまま出す(捏造しない)。 */
function formatTime(timestamp: string): string {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) {
    return timestamp;
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
