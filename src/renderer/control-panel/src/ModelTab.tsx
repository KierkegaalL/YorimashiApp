/**
 * モデル管理タブ(FR-5/FR-7)。UIの正: docs/mockups/control-panel.jsx L805-1179。
 * 正本: docs/detailed-design/model-mapping-ui.md。
 *
 * **実装済み**(第1段階=スロット管理 / 第2段階a=Live2Dフォルダ取り込み):
 *  - セット中のモデル一覧(形式バッジ・使用中表示・削除のインライン確認)
 *  - モードによる自動切替(2体セット時のみ。トグル + Code/Chat の入れ替え)
 *  - 0体のときの空状態
 *  - **Live2D モデルのフォルダ取り込み**(「モデルの追加」セクション。ネイティブダイアログ)
 *
 * **未実装は正直にそう出す**(偽データ・使えないUIを置かない):
 *  - Live2D の **zip 取り込み**・**スプライトセットの生成パイプライン**(spriteset-pipeline.md)
 *  - **感情↔モーション対応の編集**(全10状態のマッピングUI。model-mapping-ui.md)
 *  いずれも後続タスク。
 *
 * **「使用中」は解決結果(activeModelId)で描く**。manualActiveId から推測して描くと、
 * 自動切替オン時や未設定時のフォールバックとずれる(constraints.md「嘘をつかない」)。
 *
 * 形式非依存: Live2D/スプライトセットのスロットを同じ経路で扱う(renderType はバッジの
 * 見た目にだけ使い、操作の分岐には使わない)。**上限2体・削除・アクティブ解決は両形式共通**
 * であり、片方だけの分岐を持たない(CLAUDE.md原則4の対称性はこれで保たれる)。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Circle, FolderOpen, Image, Layers, Trash2 } from 'lucide-react';

import { useTheme } from './theme';
import { Row, Section, Switch } from './panel-ui';
import { MAX_MODEL_SLOTS, type ModelManageSnapshot, type ModelSlotView } from '../../../shared/model-manage';

export function ModelTab(): React.JSX.Element {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<ModelManageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 削除確認中のモデルid(同時に1つだけ。モックアップの deleteConfirmId と同じ考え方)。 */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  /** 取り込み中(ネイティブダイアログ→複製の間)。二重起動と誤操作を防ぐ。 */
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const api = window.yorimashi?.models;
    if (!api) {
      setError('この画面からはモデル設定を読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    void api
      .get()
      .then((s) => {
        if (!cancelled) {
          setSnapshot(s);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'モデル設定を読み込めませんでした。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 操作の共通処理。成功でスナップショットを差し替え、失敗はエラー表示にとどめる。 */
  const run = async (op: (api: NonNullable<typeof window.yorimashi>['models']) => Promise<ModelManageSnapshot>): Promise<void> => {
    const api = window.yorimashi?.models;
    if (!api) {
      return;
    }
    try {
      setSnapshot(await op(api));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました。');
    }
  };

  if (snapshot === null) {
    return error !== null ? <ErrorNotice message={error} /> : <Placeholder text="読み込んでいます…" />;
  }

  const { slots, autoSwitchByMode, activeModelId } = snapshot;
  const isFull = slots.length >= MAX_MODEL_SLOTS;

  return (
    <>
      <Section title={`セット中のモデル(${slots.length}/${MAX_MODEL_SLOTS})`}>
        {slots.map((slot, i) => (
          <ModelRow
            key={slot.id}
            slot={slot}
            last={i === slots.length - 1 && isFull}
            isActive={slot.id === activeModelId}
            showRadio={slots.length === MAX_MODEL_SLOTS && !autoSwitchByMode}
            showAssignedTag={slots.length === MAX_MODEL_SLOTS && autoSwitchByMode}
            single={slots.length === 1}
            confirming={deleteConfirmId === slot.id}
            onSelect={() => void run((api) => api.setActive(slot.id))}
            onAskDelete={() => setDeleteConfirmId(slot.id)}
            onCancelDelete={() => setDeleteConfirmId(null)}
            onConfirmDelete={() => {
              setDeleteConfirmId(null);
              void run((api) => api.delete(slot.id));
            }}
          />
        ))}
        {!isFull && (
          <Row
            label="空きスロット"
            // 文言はモックアップ(L898)のまま。右側は「モデルの追加」セクションが実際に機能する
            // ようになったため、"準備中" ではなく下の追加導線を指す(同一画面で矛盾したメッセージを出さない)。
            sub={slots.length === 0 ? '空きスロットが2つあります' : 'モデルはあと1体セットできます'}
            last
          >
            <span
              style={{
                fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 11.5,
                color: theme.iconInactive,
              }}
            >
              ↓「モデルの追加」から
            </span>
          </Row>
        )}
      </Section>

      {slots.length === MAX_MODEL_SLOTS && (
        <Section
          title="モードによる自動切替"
          hint={
            autoSwitchByMode
              ? '今、Code Adapter とChat Adapterそれぞれに1体ずつ割り当てています。「入れ替える」で対応を逆にできます。'
              : 'オフの間は、上で選んだモデルがモードに関わらずずっと表示されます。'
          }
        >
          <Row label="モードでモデルを切り替える" sub="2体セットしている時だけ使えます" last={!autoSwitchByMode}>
            <Switch
              checked={autoSwitchByMode}
              onChange={(next) => void run((api) => api.setAutoSwitch(next))}
            />
          </Row>
          {/* モックアップ(L914)どおり sub は付けない(現在のモードは Section の hint と憑坐状態帯で分かる)。 */}
          {autoSwitchByMode && (
            <Row label="Code / Chat の対応を入れ替える" last>
              <button
                onClick={() => void run((api) => api.swapAssignment())}
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
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <ArrowLeftRight size={13} /> 入れ替える
              </button>
            </Row>
          )}
        </Section>
      )}

      {/* モデルの追加。Live2Dのフォルダ取り込みは実装済み(第2段階a)。zip取り込みと
          スプライトセット生成は後続。**未実装の導線は正直に「準備中」と出す**(偽UIを置かない)。 */}
      <Section
        title="モデルの追加"
        hint="Live2Dはモデルフォルダ(model3.json/model.jsonを含む)を選ぶと取り込めます。zip取り込みとスプライトセットの生成フローは後続タスクで実装します。"
      >
        <Row
          label="Live2D モデル"
          sub={isFull ? 'スロットが埋まっています(先に削除してください)' : 'モデルフォルダを選んで取り込みます'}
        >
          <button
            disabled={isFull || importing}
            onClick={() => {
              setImporting(true);
              void run((api) => api.importLive2d()).finally(() => setImporting(false));
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'transparent',
              border: `1px solid ${isFull || importing ? theme.line : theme.accent}`,
              borderRadius: 999,
              padding: '5px 11px',
              color: isFull || importing ? theme.iconInactive : theme.accent,
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 12,
              cursor: isFull || importing ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <FolderOpen size={13} /> {importing ? '取り込み中…' : 'フォルダを選ぶ'}
          </button>
        </Row>
        <Row label="スプライトセット" sub="画像からの生成フローは後続タスクで実装します" last>
          <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11.5, color: theme.iconInactive }}>
            準備中
          </span>
        </Row>
      </Section>

      <Section title="感情とモーションの対応" hint="全10状態への割り当て編集は、モデルの取り込みと合わせて後続タスクで実装します。">
        <Row
          label="準備中"
          sub={
            slots.length === 0
              ? 'モデルをセットすると、ここに割り当てが並びます'
              : '現在この画面から割り当てを編集することはできません'
          }
          last
        />
      </Section>

      {/* 直前の操作が部分的にしか達成できなかった場合の申告(例: 設定からは外せたがファイルが消せない)。
          Main のコンソールにだけ出すと、利用者には「消えた」ようにしか見えない(嘘をつかない)。 */}
      {snapshot.warning !== null && <ErrorNotice message={snapshot.warning} />}
      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}

interface ModelRowProps {
  slot: ModelSlotView;
  last: boolean;
  isActive: boolean;
  /** 2体 + 自動切替オフのとき、手動選択のラジオを出す。 */
  showRadio: boolean;
  /** 2体 + 自動切替オンのとき、Code用/Chat用のタグを出す。 */
  showAssignedTag: boolean;
  /** 1体だけのとき(常に使用中)。 */
  single: boolean;
  confirming: boolean;
  onSelect: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function ModelRow({
  slot,
  last,
  isActive,
  showRadio,
  showAssignedTag,
  single,
  confirming,
  onSelect,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: ModelRowProps): React.JSX.Element {
  const theme = useTheme();
  const isLive2d = slot.renderType === 'live2d';
  const FormatIcon = isLive2d ? Layers : Image;
  const formatLabel = isLive2d ? 'Live2D' : 'スプライトセット';
  const formatColor = isLive2d ? theme.accent : theme.mint;
  const formatTag = isLive2d ? theme.accentTag : theme.mintTag;
  // 形式の補足。Live2D は Cubism 版、スプライトセットは版の概念を持たないため出さない
  // (両形式に同じものを無理に書かない。非対称だが形式の性質に由来する)。
  const detail = isLive2d
    ? slot.cubismVersion === 'cubism2'
      ? 'Cubism 2'
      : slot.cubismVersion === 'cubism4'
        ? 'Cubism 4 / 5'
        : 'Cubism 版不明'
    : 'WebPクリップ';

  return (
    <Row
      label={slot.name}
      sub={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10.5,
              fontWeight: 700,
              color: formatColor,
              background: formatTag,
              borderRadius: 999,
              padding: '1px 7px 1px 5px',
            }}
          >
            <FormatIcon size={10} /> {formatLabel}
          </span>
          <span style={{ fontSize: 12, color: theme.inkDim }}>
            {detail}
            {single ? ' ・ 使用中' : ''}
          </span>
        </span>
      }
      last={last}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {showAssignedTag && (
          <span
            style={{
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 9px',
              borderRadius: 999,
              color: slot.assignedAdapter === null ? theme.iconInactive : theme.accent,
              background: slot.assignedAdapter === null ? 'transparent' : theme.accentTag,
              whiteSpace: 'nowrap',
            }}
          >
            {slot.assignedAdapter === 'code'
              ? 'Code 用'
              : slot.assignedAdapter === 'chat'
                ? 'Chat 用'
                : '未割当'}
          </span>
        )}
        {showRadio && (
          <button
            onClick={onSelect}
            aria-label={`${slot.name}を使用中にする`}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              cursor: 'pointer',
              border: `2px solid ${isActive ? theme.accent : theme.dashedBorder}`,
              background: isActive ? theme.accent : 'transparent',
              flexShrink: 0,
            }}
          />
        )}
        {single && <Circle size={9} fill={theme.accent} color={theme.accent} />}
        {confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={onConfirmDelete}
              style={{
                fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: theme.bgPanel,
                background: theme.sealRed,
                border: 'none',
                borderRadius: 999,
                padding: '4px 9px',
                cursor: 'pointer',
              }}
            >
              削除する
            </button>
            <button
              onClick={onCancelDelete}
              style={{
                fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 11,
                color: theme.inkDim,
                background: 'transparent',
                border: `1px solid ${theme.line}`,
                borderRadius: 999,
                padding: '4px 9px',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={onAskDelete}
            aria-label={`${slot.name}を削除`}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Trash2 size={14} color={theme.iconInactive} />
          </button>
        )}
      </div>
    </Row>
  );
}

function Placeholder({ text }: { text: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        fontFamily: "'M PLUS 1 Code', sans-serif",
        fontSize: 13,
        color: theme.inkDim,
        padding: 16,
      }}
    >
      {text}
    </div>
  );
}

function ErrorNotice({ message }: { message: string }): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: 12,
        borderRadius: 10,
        background: theme.sealRedTagSoft,
        border: `1px solid ${theme.line}`,
        marginBottom: 28,
      }}
    >
      <AlertTriangle size={15} color={theme.sealRed} style={{ flexShrink: 0, marginTop: 1 }} />
      <span
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 12,
          color: theme.warnText,
          lineHeight: 1.6,
        }}
      >
        {message}
      </span>
    </div>
  );
}
