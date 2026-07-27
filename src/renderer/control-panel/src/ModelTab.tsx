/**
 * モデル管理タブ(FR-5/FR-7)。UIの正: docs/mockups/control-panel.jsx L805-1179。
 * 正本: docs/detailed-design/model-mapping-ui.md。
 *
 * **実装済み**(第1段階=スロット管理 / 第2段階a=Live2D取り込み / 第2段階b=スプライトセット生成 /
 * 第3段階 Track A=マッピング編集):
 *  - セット中のモデル一覧(形式バッジ・使用中表示・削除のインライン確認)
 *  - モードによる自動切替(2体セット時のみ。トグル + Code/Chat の入れ替え)
 *  - 0体のときの空状態
 *  - **追加するモデルの形式**の選択(モックアップ L931-)。スプライトセットが標準の入口
 *  - **Live2D モデルのフォルダ / zip 取り込み**(いずれもネイティブダイアログ)
 *  - **スプライトセットの生成フロー**(SpritesetAddFlow: 下絵→background_key.png→動画取り込み→登録)
 *  - **感情↔モーション/クリップ対応の編集**(MappingEditor: Live2Dはモーション/表情の割り当て+自動、
 *    スプライトセットはクリップ削除。model-mapping-ui.md 第3段階 Track A)
 *  - **モデル名の変更**(一覧の名前をクリックしてインライン編集。鉛筆アイコンで導線を示す)。
 *    **モックアップ自体には編集導線が無い**(既定名のまま登録するのみ)が、変更手段が無いのは
 *    FR-5の趣旨に合わない実装漏れだったため追加した。
 *
 * **未実装は正直にそう出す**(偽データ・使えないUIを置かない):
 *  - **ドラッグ&ドロップ**での取り込み。モックアップは「フォルダか zip をドロップして追加」だが、
 *    実装しているのは**ネイティブダイアログでの選択**なので、画面には「選んで追加」と書く。
 * (zip 取り込み・クリップ差し替え=Track B・プレビュー枠=Track C はいずれも実装済み)
 *
 * **「使用中」は解決結果(activeModelId)で描く**。manualActiveId から推測して描くと、
 * 自動切替オン時や未設定時のフォールバックとずれる(constraints.md「嘘をつかない」)。
 *
 * 形式非依存: Live2D/スプライトセットのスロットを同じ経路で扱う(renderType はバッジの
 * 見た目にだけ使い、操作の分岐には使わない)。**上限2体・削除・アクティブ解決は両形式共通**
 * であり、片方だけの分岐を持たない(CLAUDE.md原則4の対称性はこれで保たれる)。
 */

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Circle,
  FileArchive,
  FolderOpen,
  Image,
  Layers,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';

import { useTheme } from './theme';
import { Row, Section, Switch } from './panel-ui';
import {
  MAX_MODEL_NAME_LENGTH,
  MAX_MODEL_SLOTS,
  type ModelManageSnapshot,
  type ModelSlotView,
} from '../../../shared/model-manage';
import { SpritesetAddFlow } from './spriteset/SpritesetAddFlow';
import { MappingEditor } from './MappingEditor';

/** 追加できるモデル形式(モックアップ L933-936)。スプライトセットを標準の入口にする。 */
const ADD_FORMATS = [
  { key: 'spriteset', label: 'スプライトセット', icon: Image, hint: '画像1枚から', badge: 'おすすめ' },
  { key: 'live2d', label: 'Live2D モデル', icon: Layers, hint: 'フォルダ / zip', badge: '上級者向け' },
] as const;

type AddFormat = (typeof ADD_FORMATS)[number]['key'];

export function ModelTab(): React.JSX.Element {
  const theme = useTheme();
  const [snapshot, setSnapshot] = useState<ModelManageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 削除確認中のモデルid(同時に1つだけ。モックアップの deleteConfirmId と同じ考え方)。 */
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  /**
   * 名前編集中のモデルid(同時に1つだけ)。**モックアップ自体に編集導線は無い**(既定名固定で
   * 登録するのみ)が、既定名`新しいモデル`のまま変更手段が無いのはFR-5の趣旨に合わない実装漏れの
   * ため、削除確認と同じ「行内で完結する一時状態」のパターンで追加する。
   */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** 取り込み中(ネイティブダイアログ→複製の間)。二重起動と誤操作を防ぐ。 */
  // どちらの取り込みが実行中か(両方のボタンを同時に押させない)。null=実行中でない。
  const [importing, setImporting] = useState<'folder' | 'zip' | null>(null);
  /** 追加するモデルの形式(モックアップの addFormat。既定はスプライトセット)。 */
  const [addFormat, setAddFormat] = useState<AddFormat>('spriteset');

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
            renaming={renamingId === slot.id}
            onSelect={() => void run((api) => api.setActive(slot.id))}
            onAskDelete={() => setDeleteConfirmId(slot.id)}
            onCancelDelete={() => setDeleteConfirmId(null)}
            onConfirmDelete={() => {
              setDeleteConfirmId(null);
              void run((api) => api.delete(slot.id));
            }}
            onStartRename={() => setRenamingId(slot.id)}
            onCancelRename={() => setRenamingId(null)}
            onConfirmRename={(name) => {
              setRenamingId(null);
              void run((api) => api.rename(slot.id, name));
            }}
          />
        ))}
        {!isFull && (
          <Row
            label="空きスロット"
            // 文言はモックアップ(L898)のまま。右側は下の追加導線を指す(同一画面で矛盾したメッセージを出さない)。
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
              ↓「追加するモデルの形式」から
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

      {/* モデルの追加。モックアップ(L931-1080)どおり、まず形式を選ばせてから形式別のフローを出す。
          スプライトセットを既定(標準の入口・おすすめ)にするのも正本の指定。 */}
      {!isFull && (
        <Section title="追加するモデルの形式" hint="迷ったら「スプライトセット」がおすすめです。画像1枚から始められます。">
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
            {ADD_FORMATS.map((opt) => {
              const active = addFormat === opt.key;
              const Icon = opt.icon;
              const badgeColor = opt.badge === 'おすすめ' ? theme.mint : theme.accent;
              const badgeTag = opt.badge === 'おすすめ' ? theme.mintTag : theme.accentTag;
              return (
                <button
                  key={opt.key}
                  onClick={() => setAddFormat(opt.key)}
                  style={{
                    flex: 1,
                    cursor: 'pointer',
                    borderRadius: 12,
                    padding: '10px 8px',
                    border: active ? `2px solid ${theme.accent}` : `1px solid ${theme.line}`,
                    background: active ? theme.accentTag : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    position: 'relative',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: -8,
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: badgeColor,
                      background: badgeTag,
                      borderRadius: 999,
                      padding: '2px 7px',
                    }}
                  >
                    {opt.badge}
                  </span>
                  <Icon size={16} color={active ? theme.accent : theme.iconInactive} style={{ marginTop: 6 }} />
                  <span
                    style={{
                      fontFamily: "'M PLUS 1 Code', sans-serif",
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: active ? theme.ink : theme.inkDim,
                    }}
                  >
                    {opt.label}
                  </span>
                  <span style={{ fontSize: 10, color: theme.iconInactive }}>{opt.hint}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {/* Live2D: フォルダ取り込みと zip 取り込み(要件定義書「フォルダ/zipドロップで取り込み」)。
          **ドラッグ&ドロップは未実装**なので「選んで追加」と書く(無い操作を書くと偽UIになる)。 */}
      {!isFull && addFormat === 'live2d' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Live2dImportButton
            icon={<FolderOpen size={18} color={theme.iconInactive} />}
            label="モデルフォルダを選んで追加"
            hint="model3.json / model.json を含むフォルダ"
            busy={importing === 'folder'}
            disabled={importing !== null}
            onClick={() => {
              setImporting('folder');
              void run((api) => api.importLive2d()).finally(() => setImporting(null));
            }}
          />
          <Live2dImportButton
            icon={<FileArchive size={18} color={theme.iconInactive} />}
            label="zip を選んで追加"
            hint="展開して取り込む(安全でないパスは拒否)"
            busy={importing === 'zip'}
            disabled={importing !== null}
            onClick={() => {
              setImporting('zip');
              void run((api) => api.importLive2dArchive()).finally(() => setImporting(null));
            }}
          />
        </div>
      )}

      {!isFull && addFormat === 'spriteset' && (
        <SpritesetAddFlow onImported={setSnapshot} onError={(m) => setError(m === '' ? null : m)} />
      )}

      {isFull && (
        <div
          style={{
            fontFamily: "'M PLUS 1 Code', sans-serif",
            fontSize: 12,
            color: theme.iconInactive,
            textAlign: 'center',
            padding: '8px 4px',
            lineHeight: 1.6,
          }}
        >
          モデルは2体までです。入れ替えるには、どちらかを削除してください。
        </div>
      )}

      {/* 感情↔モーション/クリップ対応の編集(第3段階 Track A)。0体のときは MappingEditor 内で
          「モデルがまだありません」を出す。プレビュー枠(論点1)は Track C(後続)。 */}
      <MappingEditor slots={slots} />

      {/* 直前の操作が部分的にしか達成できなかった場合の申告(例: 設定からは外せたがファイルが消せない)。
          Main のコンソールにだけ出すと、利用者には「消えた」ようにしか見えない(嘘をつかない)。 */}
      {snapshot.warning !== null && <ErrorNotice message={snapshot.warning} />}
      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}

interface Live2dImportButtonProps {
  icon: React.ReactNode;
  label: string;
  hint: string;
  /** このボタンの取り込みが実行中。 */
  busy: boolean;
  /** どちらかの取り込みが実行中(両方を同時に押させない)。 */
  disabled: boolean;
  onClick: () => void;
}

/**
 * Live2D の取り込み口(フォルダ / zip)。見た目を揃えるため共通化している。
 * **どちらもネイティブダイアログで選ばせる**(Renderer はパスもファイル実体も扱わない。security.md)。
 * SSR検証のため export する。
 */
export function Live2dImportButton({
  icon,
  label,
  hint,
  busy,
  disabled,
  onClick,
}: Live2dImportButtonProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        padding: 16,
        borderRadius: 14,
        cursor: disabled ? 'default' : 'pointer',
        border: `1.5px dashed ${theme.dashedBorder}`,
        background: 'transparent',
        color: theme.inkDim,
        fontFamily: "'M PLUS 1 Code', sans-serif",
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {icon}
      {busy ? '取り込み中…' : label}
      <span style={{ fontSize: 11, color: theme.iconInactive, textAlign: 'center' }}>{hint}</span>
    </button>
  );
}

interface ModelNameEditorProps {
  initial: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/**
 * モデル名のインライン編集。**最終的な検証(前後空白の除去・空文字拒否・上限長)は Main 側**
 * (`parseModelName`)が正であり、二重に実装しない。ただし**上限文字数だけは`maxLength`で
 * UI側にも反映する**(検証ロジックの複製ではなく、Main側が許す範囲をそもそも入力させない
 * ためのUX。上限を超えて入力→確定→Main側で拒否→入力内容が消える、という事故を防ぐ)。
 *
 * ここで扱う「送信するかどうか」の分岐(Enterで確定・Escapeでキャンセル・blurは確定扱い)は
 * `parseModelName`の空文字拒否とは**別の関心事**: 空欄のまま確定しようとした場合、Main側の
 * エラー(「モデル名を入力してください」)を一往復させるのではなく、**その場でキャンセル扱いに
 * 畳んで無変更として振る舞う**(空欄はほぼ確実に「消しかけて確定し忘れた」であり、エラー表示より
 * 「元に戻す」方が自然なため)。
 *
 * SSR検証のため export する。
 */
export function ModelNameEditor({ initial, onConfirm, onCancel }: ModelNameEditorProps): React.JSX.Element {
  const theme = useTheme();
  const [value, setValue] = useState(initial);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      onCancel(); // 空欄での確定は「消しかけ」とみなし、無変更(キャンセル)として扱う
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* eslint 的な自動フォーカスの代わりに autoFocus を使う(このタブに専用フォーカス管理は無い)。 */}
      <input
        autoFocus
        maxLength={MAX_MODEL_NAME_LENGTH}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            submit();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={submit}
        style={{
          font: 'inherit',
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 14,
          color: theme.ink,
          background: theme.bgRaised,
          border: `1px solid ${theme.accent}`,
          borderRadius: 6,
          padding: '2px 6px',
          width: 160,
        }}
      />
      {/* mousedown で確定/取消を先に処理する(input の blur が先に発火して submit と競合するのを防ぐ)。 */}
      <button
        aria-label="名前を確定"
        onMouseDown={(e) => e.preventDefault()}
        onClick={submit}
        style={{ display: 'flex', cursor: 'pointer', background: 'transparent', border: 'none', padding: 2 }}
      >
        <Check size={14} color={theme.mint} />
      </button>
      <button
        aria-label="名前の変更を取り消す"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCancel}
        style={{ display: 'flex', cursor: 'pointer', background: 'transparent', border: 'none', padding: 2 }}
      >
        <X size={14} color={theme.iconInactive} />
      </button>
    </div>
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
  /** 名前編集中か。true の間はラベルをテキスト入力に差し替える。 */
  renaming: boolean;
  onSelect: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  /** 確定時に呼ぶ。前後空白の除去・空文字/上限長の拒否は Main 側(parseModelName)で行う。 */
  onConfirmRename: (name: string) => void;
}

function ModelRow({
  slot,
  last,
  isActive,
  showRadio,
  showAssignedTag,
  single,
  confirming,
  renaming,
  onSelect,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onStartRename,
  onCancelRename,
  onConfirmRename,
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
      label={
        renaming ? (
          <ModelNameEditor initial={slot.name} onConfirm={onConfirmRename} onCancel={onCancelRename} />
        ) : (
          <button
            onClick={onStartRename}
            aria-label={`${slot.name}の名前を変更`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
            }}
          >
            {slot.name}
            <Pencil size={11} color={theme.iconInactive} />
          </button>
        )
      }
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
