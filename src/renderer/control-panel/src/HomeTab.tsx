/**
 * ホームタブ(FR-7 / FR-1・FR-2)。UIの正: docs/mockups/control-panel.jsx L757-803。
 *  - 現在のモード … 使用中アダプタの切替(L759-774。FR-1)
 *  - Code Adapter の状態 … 接続ポート・直近のイベント(L776-787。FR-2)
 *  - 表示中のモデル … 解決済みアクティブモデルとクリックスルー状態(L789-801)
 *
 * **一目で現状を確認する画面**であって、設定の編集面ではない(編集はモード/モデル/全体設定の
 * 各タブが持つ)。唯一の操作要素はアダプタ切替で、これはモックアップどおり。
 *
 * **「嘘をつかない」ための扱い**(constraints.md):
 *  - アダプタは **App が持つ config の写し**を受け取る(このタブで別途購読しない)。Renderer 内に
 *    同じ値の情報源を2つ作ると、会話ペインの `/code` や Tray からの切替でどちらかが古くなる。
 *  - 接続ポートは**設定値ではなく実際に待ち受けているポート**(`actualPort`)を出す。競合時は
 *    フォールバックするため設定値を出すと嘘になる(code-settings.ts)。未起動は「待受なし」と出す。
 *  - 直近のイベントは、1件も無いときに「まだありません」と出す(空とエラーを区別する)。
 *  - モデルは `activeModelId`(解決結果)で判定する。`manualActiveId`(設定値)から推測しない
 *    (model-manage.ts の注記どおり、両者は食い違いうる)。
 *  - モックアップの `version`(「3/10クリップ・変換済み」等)はデモ用の文字列で、実際の
 *    `ModelSlotView` に対応物が無い。ModelTab.tsx と**同じ規則**で形式由来の `detail`
 *    (Cubism版 / WebPクリップ)に置き換える(2箇所で違う書き方をしない)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも同じ経路で表示する(`renderType` を
 * バッジと `detail` の文言に使うだけで、取得・解決の分岐を持たない)。ModelTab と同じ
 * 「両形式が同じ経路を通る」形の対称性(model-manage.ts)。
 */

import { useEffect, useState } from 'react';
import { ArrowLeftRight, ChevronRight, Image, Layers } from 'lucide-react';

import { useTheme } from './theme';
import { ErrorNotice, Placeholder, Row, Section } from './panel-ui';
import { formatModelDetail } from './catalog';
import type { AdapterMode } from './types';
import type { CodeSettingsSnapshot } from '../../../shared/code-settings';
import type { GeneralSettingsSnapshot } from '../../../shared/general-settings';
import type { HookLogEntry, HookLogSnapshot } from '../../../shared/hook-log';
import { MAX_MODEL_SLOTS, type ModelManageSnapshot } from '../../../shared/model-manage';

export interface HomeTabProps {
  /** App が持つ config の写し(FR-1)。ここで再購読しない(冒頭コメント参照)。 */
  adapterMode: AdapterMode;
  onSetAdapterMode: (mode: AdapterMode) => void;
  /** モデル行のシェブロンからモデルタブへ送る。 */
  onOpenModelTab: () => void;
}

export function HomeTab({
  adapterMode,
  onSetAdapterMode,
  onOpenModelTab,
}: HomeTabProps): React.JSX.Element {
  return (
    <>
      <AdapterSection adapterMode={adapterMode} onSetAdapterMode={onSetAdapterMode} />
      <CodeAdapterStatusSection />
      <ActiveModelSection adapterMode={adapterMode} onOpenModelTab={onOpenModelTab} />
    </>
  );
}

// ── 現在のモード(FR-1) ────────────────────────────────────────────────

function AdapterSection({
  adapterMode,
  onSetAdapterMode,
}: {
  adapterMode: AdapterMode;
  onSetAdapterMode: (mode: AdapterMode) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const isCode = adapterMode === 'code';
  return (
    <Section title="現在のモード">
      <Row
        label="使用中のアダプタ"
        sub={isCode ? 'Claude Code の作業を実況します' : '独自チャットで会話します'}
        last
      >
        <button
          onClick={() => onSetAdapterMode(isCode ? 'chat' : 'code')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: theme.bgRaised,
            border: `1px solid ${theme.line}`,
            borderRadius: 999,
            padding: '6px 12px',
            color: theme.ink,
            fontFamily: "'M PLUS 1 Code', sans-serif",
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          {isCode ? 'Code' : 'Chat'}
          <ArrowLeftRight size={13} />
        </button>
      </Row>
    </Section>
  );
}

// ── Code Adapter の状態(FR-2) ─────────────────────────────────────────

/** 「2分前」形式の相対時刻(モックアップ L784 の表記)。未来・不正値は素の時刻へ逃がす。 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return iso; // パースできない値を「今」と誤表示しない
  }
  const diffMs = Date.now() - then;
  if (diffMs < 0) {
    // 端末の時刻変更等。推測せずそのまま時刻を出す。
    return new Date(then).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return 'たった今';
  }
  if (minutes < 60) {
    return `${minutes}分前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}時間前`;
  }
  return `${Math.floor(hours / 24)}日前`;
}

/** 直近1件のイベントを「2分前・PostToolUse」の形にする。 */
function formatLatestEvent(entry: HookLogEntry): string {
  return `${formatRelativeTime(entry.timestamp)}・${entry.hookEventName}`;
}

function CodeAdapterStatusSection(): React.JSX.Element {
  const theme = useTheme();
  const [code, setCode] = useState<CodeSettingsSnapshot | null>(null);
  const [logs, setLogs] = useState<HookLogSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const codeApi = window.yorimashi?.codeAdapter;
    const logsApi = window.yorimashi?.logs;
    if (!codeApi || !logsApi) {
      setError('この画面からは状態を読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    const loadCode = (): void => {
      void codeApi
        .getSettings()
        .then((s) => {
          if (!cancelled) {
            setCode(s);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '接続状態を読み込めませんでした。');
          }
        });
    };
    const loadLogs = (): void => {
      // ログタブと同じスナップショット(Main側で上限件数まで間引かれている)を取り、
      // ここでは先頭1件だけを使う。件数指定の引数は `logs.get()` に無い(preload参照)。
      void logsApi
        .get()
        .then((s) => {
          if (!cancelled) {
            setLogs(s);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'ログを読み込めませんでした。');
          }
        });
    };
    loadCode();
    loadLogs();
    // hooks イベントが届くたびに「直近のイベント」を更新する(ログタブと同じ通知)。
    const unsubscribe = logsApi.onChanged(loadLogs);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (code === null) {
    return error !== null ? <ErrorNotice message={error} /> : <Placeholder text="読み込んでいます…" />;
  }

  const listening = code.actualPort !== null;
  const latest = logs?.entries[0];

  return (
    <>
      <Section title="Code Adapter の状態" hint="hooks からの通知をここで受け取っています。">
        <Row label="接続ポート" last={false}>
          {/* **実ポート**を出す(設定値ではない。競合時にフォールバックするため)。 */}
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              color: listening ? theme.mint : theme.inkDim,
            }}
          >
            {listening ? `:${code.actualPort} ● 待受中` : '待受なし'}
          </span>
        </Row>
        <Row label="直近のイベント" last>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: theme.inkDim,
            }}
          >
            {/* 読み出し失敗・空・在りを区別する(空とエラーを混同しない)。 */}
            {logs?.error !== null && logs?.error !== undefined
              ? '読み出せません'
              : latest
                ? formatLatestEvent(latest)
                : 'まだありません'}
          </span>
        </Row>
      </Section>

      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}

// ── 表示中のモデル ────────────────────────────────────────────────────

function ActiveModelSection({
  adapterMode,
  onOpenModelTab,
}: {
  /**
   * 自動切替(`autoSwitchByMode`)がONのとき、**アダプタが変わると解決されるモデルも変わる**
   * (Main の `resolveActiveModel`)。`models` にはpush購読の仕組みが無いので、この値の変化を
   * 再取得のトリガーにする(同じタブ内のトグルで切り替えられるため、無いと表示が古くなる)。
   */
  adapterMode: AdapterMode;
  onOpenModelTab: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [models, setModels] = useState<ModelManageSnapshot | null>(null);
  const [general, setGeneral] = useState<GeneralSettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const modelsApi = window.yorimashi?.models;
    const generalApi = window.yorimashi?.general;
    if (!modelsApi || !generalApi) {
      setError('この画面からはモデルを読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    void modelsApi
      .get()
      .then((s) => {
        if (!cancelled) {
          setModels(s);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'モデルを読み込めませんでした。');
        }
      });
    void generalApi
      .getSettings()
      .then((s) => {
        if (!cancelled) {
          setGeneral(s);
        }
      })
      .catch(() => {
        // クリックスルーは補足表示にすぎない。取得できなければ触れない(嘘の既定値を出さない)。
      });
    // クリックスルーは Tray・全体設定タブからも変わるため追従する。
    const unsubscribe = generalApi.onChanged((snapshot) => {
      if (!cancelled) {
        setGeneral(snapshot);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // adapterMode が変わったらモデルを取り直す(上記 props のコメント参照)。
  }, [adapterMode]);

  if (models === null) {
    return error !== null ? <ErrorNotice message={error} /> : <Placeholder text="読み込んでいます…" />;
  }

  // 解決結果で判定する(設定値=manualActiveId から推測しない)。
  const active = models.slots.find((s) => s.id === models.activeModelId) ?? null;
  const autoSwitching = models.slots.length === MAX_MODEL_SLOTS && models.autoSwitchByMode;
  const clickThroughNote =
    general === null ? null : general.clickThrough ? 'クリックスルー有効' : 'クリックスルー無効';

  const sub = active
    ? autoSwitching
      ? `${models.activeAdapter === 'code' ? 'Code' : 'Chat'} Adapter 用に自動表示中`
      : [formatModelDetail(active), clickThroughNote].filter((s) => s !== null).join(' ・ ')
    : 'モデルを追加すると、ここに表示されます';

  const FormatIcon = active?.renderType === 'live2d' ? Layers : Image;

  return (
    <>
      <Section title="表示中のモデル">
        <Row
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {active && <FormatIcon size={12} color={theme.iconInactive} />}
              {active?.name ?? '未設定'}
            </span>
          }
          sub={sub}
          last
        >
          {/*
            モックアップ(L799)はここを静的な ChevronRight にしているが、シェブロンは
            「先へ進める」ことを示す記号なので、押せない飾りにせずモデルタブへ送る
            (モデルが0体のときの導線にもなる)。モックにない挙動の追加はこの理由による。
          */}
          <button
            onClick={onOpenModelTab}
            aria-label="モデル管理タブを開く"
            title="モデル管理タブを開く"
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <ChevronRight size={16} color={theme.iconInactive} />
          </button>
        </Row>
      </Section>

      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}
