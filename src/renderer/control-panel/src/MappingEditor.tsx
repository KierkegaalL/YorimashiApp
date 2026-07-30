/**
 * 感情↔モーション/クリップ対応の編集(FR-5 モデル管理タブ 第3段階 Track A)。
 * UIの正: docs/mockups/control-panel.jsx L1098-1177、正本: docs/detailed-design/model-mapping-ui.md
 * (論点2=Live2Dの選択UI / 論点3=削除導線 / 論点4=自動マッピングは Live2D のみ)。
 *
 * マッピングの正本は各モデルの manifest.json。ここは `window.yorimashi.models.getMapping()` で
 * 現在値を取り、編集系IPCで書き換えて返ってきた詳細で描き直すだけ(Renderer に判断を持たせない)。
 * 例外は差し替えの**デコード+色キー抜き**だけで、これは Chromium にしかできないため Renderer で行い、
 * 色キー抜き済みPNGフレームを setClip で Main へ渡す(判断ではなく工程分担。取り込みと同じ)。
 *
 * 形式の非対称(正当・正本論点4): Live2D は候補(モーション/表情名)から選び、自動マッピングを持つ。
 * スプライトセットは候補の概念が無く、割り当ては**差し替え/設定(「変更」= Track B)**と**削除(Track A)**。
 * 差し替えは取り込みと同じ decode-video.ts の経路(Renderer でデコード+色キー抜き → Main で WebP 化)を通す。
 * Live2D 側の「変更」に当たるのは setLive2dMapping(モーション/表情の選択)で、そちらはエンコード不要。
 *
 * **プレビュー枠(論点1)= Track C(実装済み)**。Section 先頭に `ModelPreview` を固定し(両形式とも
 * CharacterRenderer を通す=本番と同一経路)、各感情行の ▶ で `setState` する。編集のたびに reloadNonce を
 * 増やして最新 manifest で作り直す。描画コードは ModelPreview 側で動的 import(zod 入りチャンクを Control
 * Panel 起動時に先読みさせない)。**実描画とメモリ実測はサンドボックスで検証不可**でユーザー確認・後続TODO。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Play, RotateCcw, Trash2, Upload } from 'lucide-react';

import { useTheme } from './theme';
import { ErrorNotice, Row, Section } from './panel-ui';
import { decodeAndKeyVideo } from './spriteset/decode-video';
import { ModelPreview, type ModelPreviewHandle } from './ModelPreview';
import { FALLBACK_STATE, type EmotionState } from '../../../shared/emotions';
import { MAX_MODEL_SLOTS, type ModelSlotView } from '../../../shared/model-manage';
import type {
  Live2dMappingDetail,
  Live2dMappingEntry,
  ModelMappingDetail,
  SpritesetMappingEntry,
} from '../../../shared/model-mapping';

export function MappingEditor({ slots }: { slots: ModelSlotView[] }): React.JSX.Element {
  const theme = useTheme();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ModelMappingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 展開中の状態(同時に1つ。モックアップの expandedKey/deleteConfirmId と同じ考え方)。 */
  const [expanded, setExpanded] = useState<EmotionState | null>(null);
  /** 削除確認中の状態(スプライトセット。同時に1つ)。 */
  const [deleteConfirm, setDeleteConfirm] = useState<EmotionState | null>(null);
  /** Section 単位「自動割り当てをやり直す」の確認中(Live2D)。 */
  const [restoreAllConfirm, setRestoreAllConfirm] = useState(false);
  /** 編集IPC実行中(二重操作を防ぐ)。 */
  const [busy, setBusy] = useState(false);
  /** 差し替え動画をデコード中の状態(スプライトセット。重いので1件ずつ)。 */
  const [decoding, setDecoding] = useState<EmotionState | null>(null);
  /** デコード進捗(取り込みUIと同じ表示)。 */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** どの状態のために動画選択を開いたか。 */
  const pendingState = useRef<EmotionState | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  /** プレビュー枠(Track C)。▶ で setState を叩く。 */
  const previewRef = useRef<ModelPreviewHandle | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  /** 編集のたびに増やしてプレビューを最新 manifest で作り直させる。 */
  const [reloadNonce, setReloadNonce] = useState(0);

  // 対象モデル: 明示選択が現存すればそれ、無ければ先頭(削除で消えたら先頭へ落ちる)。
  const target = slots.find((s) => s.id === targetId) ?? slots[0] ?? null;
  const targetKey = target?.id ?? null;

  useEffect(() => {
    // 対象が変わったら展開・確認状態をリセットして読み直す。
    setExpanded(null);
    setDeleteConfirm(null);
    setRestoreAllConfirm(false);
    if (targetKey === null) {
      setDetail(null);
      return;
    }
    const api = window.yorimashi?.models;
    if (!api) {
      setError('この画面からはマッピングを読めません(アプリのウィンドウで開いてください)。');
      return;
    }
    let cancelled = false;
    setDetail(null);
    void api
      .getMapping(targetKey)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'マッピングを読み込めませんでした。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [targetKey]);

  /** 編集IPC → 返ってきた詳細で描き直す共通処理。失敗はエラー表示にとどめる。 */
  const runEdit = async (
    op: (api: NonNullable<typeof window.yorimashi>['models']) => Promise<ModelMappingDetail>,
  ): Promise<void> => {
    const api = window.yorimashi?.models;
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const d = await op(api);
      setDetail(d);
      setError(null);
      // 編集が manifest を書き換えたので、プレビューを最新で作り直す(古い対応を映さない)。
      setReloadNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  /** スプライトセットの差し替え/設定: 動画を選ばせる(実処理は onFileChosen)。 */
  const pickVideo = (state: EmotionState): void => {
    pendingState.current = state;
    fileInput.current?.click();
  };

  /**
   * 選ばれた動画をデコード+色キー抜き(取り込みと同じ decode-video.ts)してから、
   * setClip IPC で Main に渡す。デコードは Chromium にしかできないため Renderer で行う。
   * modelId は選択時の detail を使う(デコード中に対象が変わっても取り違えない)。
   */
  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    const state = pendingState.current;
    const modelId = detail?.renderType === 'spriteset' ? detail.modelId : null;
    // 同じファイルを続けて選べるよう毎回クリアする。
    event.target.value = '';
    pendingState.current = null;
    if (!file || state === null || modelId === null) {
      return;
    }
    setDecoding(state);
    setProgress({ done: 0, total: 0 });
    void decodeAndKeyVideo(file, { onProgress: (done, total) => setProgress({ done, total }) })
      .then((clip) =>
        runEdit((api) =>
          api.setClip(modelId, state, {
            frames: clip.frames,
            delayMs: clip.delayMs,
            width: clip.width,
            height: clip.height,
          }),
        ),
      )
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '動画を取り込めませんでした。');
      })
      .finally(() => {
        setDecoding(null);
        setProgress(null);
      });
  };

  // 0体: 割り当てるモデルが無い(モックアップ L1091-1097)。
  if (slots.length === 0) {
    return (
      <div
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 12.5,
          color: theme.iconInactive,
          textAlign: 'center',
          padding: '20px 4px',
          lineHeight: 1.6,
        }}
      >
        モデルがまだありません。上の「追加するモデルの形式」から追加してください。
      </div>
    );
  }

  const isSpriteset = detail?.renderType === 'spriteset';
  const hint = isSpriteset
    ? '各感情のクリップを別の動画に差し替えたり、未割当の感情に設定できます(取り込みと同じく背景の色キー抜き+WebP変換を自動で行います)。クリップを外すと idle クリップにフォールバックします。'
    : 'モデルごとのモーション名は作者によって違うため、ここで割り当てます。未割当の感情は idle に戻ります。';

  return (
    <>
      <Section title="感情とモーションの対応" hint={detail !== null ? hint : undefined}>
        {/* 上限までセットしている時はどちらのモデルを編集するか選ぶ(モックアップ L1110-1130)。 */}
        {slots.length === MAX_MODEL_SLOTS && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              padding: '10px 16px',
              borderBottom: `1px solid ${theme.line}`,
            }}
          >
            {slots.map((s) => {
              const on = target?.id === s.id;
              // 編集/デコード実行中は対象を切り替えさせない。切り替えを許すと、実行中の操作が
              // 完了した時点で「開始時のモデル」の詳細で別モデルの画面を上書きしうる(表示と実データが
              // 食い違う)。実行中は切替を止めることで、setDetail は常に現在の対象へ反映される。
              const switchDisabled = busy || decoding !== null;
              return (
                <button
                  key={s.id}
                  disabled={switchDisabled}
                  onClick={() => setTargetId(s.id)}
                  style={{
                    cursor: switchDisabled ? 'default' : 'pointer',
                    borderRadius: 999,
                    padding: '4px 10px',
                    border: `1px solid ${on ? theme.accent : theme.line}`,
                    background: on ? theme.accentTag : 'transparent',
                    color: on ? theme.ink : switchDisabled ? theme.iconInactive : theme.inkDim,
                    fontFamily: "'M PLUS 1 Code', sans-serif",
                    fontSize: 11.5,
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}

        {/* プレビュー枠(Track C / 論点1)。Section 先頭に固定し、両形式とも CharacterRenderer を通す。
            編集対象と同じモデルを描き、各行の ▶ で setState する。detail が定まってから mount する。 */}
        {detail !== null && (
          <ModelPreview
            ref={previewRef}
            modelId={detail.modelId}
            reloadNonce={reloadNonce}
            onReadyChange={setPreviewReady}
          />
        )}

        {detail === null ? (
          <Row label="読み込んでいます…" last />
        ) : detail.renderType === 'live2d' ? (
          <Live2dRows
            detail={detail}
            expanded={expanded}
            busy={busy}
            previewReady={previewReady}
            onPreview={(state) => previewRef.current?.setState(state)}
            onToggle={(state) => setExpanded((prev) => (prev === state ? null : state))}
            onSet={(state, patch) => void runEdit((api) => api.setLive2dMapping(detail.modelId, state, patch))}
            onAutoRestore={(state) => void runEdit((api) => api.autoRestoreMapping(detail.modelId, state))}
          />
        ) : (
          <SpritesetRows
            entries={detail.entries}
            expanded={expanded}
            deleteConfirm={deleteConfirm}
            busy={busy || decoding !== null}
            decoding={decoding}
            progress={progress}
            previewReady={previewReady}
            onPreview={(state) => previewRef.current?.setState(state)}
            onToggle={(state) => {
              setExpanded((prev) => (prev === state ? null : state));
              setDeleteConfirm(null);
            }}
            onReplace={(state) => pickVideo(state)}
            onAskDelete={(state) => setDeleteConfirm(state)}
            onCancelDelete={() => setDeleteConfirm(null)}
            onConfirmDelete={(state) => {
              setDeleteConfirm(null);
              void runEdit((api) => api.deleteClip(detail.modelId, state));
            }}
          />
        )}
      </Section>

      {/* スプライトセットの差し替え用(取り込みフローと同じ <input type=file>。Renderer が
          デコードするためパスではなく File を直接扱う)。1つを全行で使い回す。
          **正本 model-mapping-ui.md 論点3 の当初案(dialog.showOpenDialog + 行へのドロップの
          両対応)からは訂正した**: デコードは Chromium でしかできず、showOpenDialog が返す Main 側の
          パス文字列では <video> に読ませられない(File が要る)。正本側も訂正記録済み。 */}
      {isSpriteset && (
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          onChange={onFileChosen}
          style={{ display: 'none' }}
        />
      )}

      {/* Section 単位のやり直し(Live2D のみ。論点4=自動マッピングは Live2D のみ)。 */}
      {detail?.renderType === 'live2d' && (
        <div style={{ marginTop: -18, marginBottom: 28 }}>
          {restoreAllConfirm ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                disabled={busy}
                onClick={() => {
                  setRestoreAllConfirm(false);
                  void runEdit((api) => api.autoRestoreAllMapping(detail.modelId));
                }}
                style={fullButtonStyle(theme.sealRed, theme.bgPanel, busy)}
              >
                全10状態を自動割り当てで上書きする
              </button>
              <button
                disabled={busy}
                onClick={() => setRestoreAllConfirm(false)}
                style={{
                  ...fullButtonStyle('transparent', theme.inkDim, busy),
                  border: `1px solid ${theme.line}`,
                  flex: '0 0 auto',
                  width: 80,
                }}
              >
                取消
              </button>
            </div>
          ) : (
            <button
              disabled={busy}
              onClick={() => setRestoreAllConfirm(true)}
              style={{
                ...fullButtonStyle(theme.bgRaised, theme.ink, busy),
                border: `1px solid ${theme.line}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <RotateCcw size={13} /> 自動割り当てをやり直す(全10状態)
            </button>
          )}
        </div>
      )}

      {error !== null && <ErrorNotice message={error} />}
    </>
  );
}

// ── Live2D 行 ────────────────────────────────────────

interface Live2dRowsProps {
  detail: Live2dMappingDetail;
  expanded: EmotionState | null;
  busy: boolean;
  /** プレビューが操作可能か(▶ の活性)。 */
  previewReady: boolean;
  /** ▶: この状態をプレビュー枠で再生する。 */
  onPreview: (state: EmotionState) => void;
  onToggle: (state: EmotionState) => void;
  onSet: (state: EmotionState, patch: { motion: string | null; expression: string | null }) => void;
  onAutoRestore: (state: EmotionState) => void;
}

// export は分岐描画(候補の select・要設定表示など)をSSRで直接検証するため。
export function Live2dRows({ detail, expanded, busy, previewReady, onPreview, onToggle, onSet, onAutoRestore }: Live2dRowsProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <>
      {detail.entries.map((entry, i, arr) => {
        const isLast = i === arr.length - 1;
        const isOpen = expanded === entry.state;
        const unmapped = entry.motion === null && entry.expression === null;
        return (
          <div
            key={entry.state}
            style={{ borderBottom: isLast && !isOpen ? 'none' : `1px solid ${theme.line}` }}
          >
            <Row
              label={entry.state}
              sub={unmapped ? '未割当' : `${entry.motion ?? '—'} / ${entry.expression ?? '—'}`}
              last
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <PreviewButton onClick={() => onPreview(entry.state)} disabled={!previewReady} />
                <button
                  onClick={() => onToggle(entry.state)}
                  aria-label={`${entry.state}の割り当てを${isOpen ? '閉じる' : '編集する'}`}
                  style={toggleButtonStyle}
                >
                  {unmapped && !isOpen && (
                    <span style={{ fontSize: 11.5, color: theme.sealRed, marginRight: 2 }}>要設定</span>
                  )}
                  {isOpen ? (
                    <ChevronDown size={16} color={theme.iconInactive} />
                  ) : (
                    <ChevronRight size={16} color={theme.iconInactive} />
                  )}
                </button>
              </div>
            </Row>
            {isOpen && (
              <Live2dEntryEditor
                entry={entry}
                motions={detail.motions}
                expressions={detail.expressions}
                busy={busy}
                onSet={(patch) => onSet(entry.state, patch)}
                onAutoRestore={() => onAutoRestore(entry.state)}
                isLast={isLast}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

interface Live2dEntryEditorProps {
  entry: Live2dMappingEntry;
  motions: string[];
  expressions: string[];
  busy: boolean;
  onSet: (patch: { motion: string | null; expression: string | null }) => void;
  onAutoRestore: () => void;
  isLast: boolean;
}

function Live2dEntryEditor({
  entry,
  motions,
  expressions,
  busy,
  onSet,
  onAutoRestore,
  isLast,
}: Live2dEntryEditorProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <div
      style={{
        padding: '4px 16px 14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        // 最終行を展開しているときは Section の角丸に合わせて下罫線を出さない。
        borderBottom: isLast ? 'none' : undefined,
      }}
    >
      <MappingSelect
        label="モーション"
        value={entry.motion}
        options={motions}
        disabled={busy}
        onChange={(motion) => onSet({ motion, expression: entry.expression })}
      />
      <MappingSelect
        label="表情"
        value={entry.expression}
        options={expressions}
        disabled={busy}
        onChange={(expression) => onSet({ motion: entry.motion, expression })}
      />
      <button
        disabled={busy}
        onClick={onAutoRestore}
        style={{
          alignSelf: 'flex-end',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: 'transparent',
          border: `1px solid ${theme.line}`,
          borderRadius: 999,
          padding: '4px 10px',
          color: busy ? theme.iconInactive : theme.inkDim,
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 11,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        <RotateCcw size={11} /> 自動に戻す
      </button>
    </div>
  );
}

interface MappingSelectProps {
  label: string;
  value: string | null;
  options: string[];
  disabled: boolean;
  onChange: (next: string | null) => void;
}

function MappingSelect({ label, value, options, disabled, onChange }: MappingSelectProps): React.JSX.Element {
  const theme = useTheme();
  // 現在値が候補に無い(モデル定義が変わった等)ときも、空表示にせず選択肢へ含めて見せる。
  const opts = value !== null && !options.includes(value) ? [value, ...options] : options;
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 12,
          color: theme.inkDim,
          width: 60,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        style={{
          flex: 1,
          minWidth: 0,
          background: theme.bgRaised,
          border: `1px solid ${theme.line}`,
          borderRadius: 8,
          padding: '7px 10px',
          color: theme.ink,
          fontSize: 12.5,
          fontFamily: "'M PLUS 1 Code', sans-serif",
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <option value="">— (なし)</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── スプライトセット 行 ─────────────────────────────

interface SpritesetRowsProps {
  entries: SpritesetMappingEntry[];
  expanded: EmotionState | null;
  deleteConfirm: EmotionState | null;
  busy: boolean;
  /** デコード中の状態(その行に進捗を出す)。 */
  decoding: EmotionState | null;
  progress: { done: number; total: number } | null;
  /** プレビューが操作可能か(▶ の活性)。 */
  previewReady: boolean;
  /** ▶: この状態をプレビュー枠で再生する。 */
  onPreview: (state: EmotionState) => void;
  onToggle: (state: EmotionState) => void;
  /** 動画を選んで差し替え/設定する。 */
  onReplace: (state: EmotionState) => void;
  onAskDelete: (state: EmotionState) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (state: EmotionState) => void;
}

// export は分岐描画(変更/設定ボタン・削除・idle の必須表示・未割当の要設定)をSSRで直接検証するため。
export function SpritesetRows({
  entries,
  expanded,
  deleteConfirm,
  busy,
  decoding,
  progress,
  previewReady,
  onPreview,
  onToggle,
  onReplace,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: SpritesetRowsProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <>
      {entries.map((entry, i, arr) => {
        const isLast = i === arr.length - 1;
        const isOpen = expanded === entry.state;
        const isIdle = entry.state === FALLBACK_STATE;
        const isDecoding = decoding === entry.state;
        // 素材の再生方法を manifest そのままに表す(モックアップは category から推測していたが、
        // 実データの loop/returnTo で描く方が正直)。
        const sub = !entry.mapped
          ? '未割当'
          : `${entry.state}.webp ・ ${entry.loop ? 'ループ' : entry.returnTo ? `単発→${entry.returnTo}へ復帰` : '単発'}`;
        return (
          <div
            key={entry.state}
            style={{ borderBottom: isLast && !isOpen ? 'none' : `1px solid ${theme.line}` }}
          >
            <Row label={entry.state} sub={sub} last>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* ▶ はプレビュー枠でこの状態を再生する。未割当でも実行時は idle にフォールバックする
                    ので押せてよい(何が映るかを確認できる)。 */}
                <PreviewButton onClick={() => onPreview(entry.state)} disabled={!previewReady} />
                {/* idle は必須(C-18)、未割当は要設定。どちらも編集は可能なのでバッジ+トグルを併置する
                    (idle は「変更」だけ・削除不可、未割当は「設定」で追加できる)。 */}
                {isIdle && <span style={tagStyle(theme.accent, theme.accentTag)}>必須</span>}
                {!entry.mapped && !isIdle && (
                  <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.sealRed }}>
                    要設定
                  </span>
                )}
                <button
                  onClick={() => onToggle(entry.state)}
                  aria-label={`${entry.state}のクリップを${isOpen ? '閉じる' : '編集する'}`}
                  style={toggleButtonStyle}
                >
                  {isOpen ? (
                    <ChevronDown size={16} color={theme.iconInactive} />
                  ) : (
                    <ChevronRight size={16} color={theme.iconInactive} />
                  )}
                </button>
              </div>
            </Row>
            {isOpen && (
              <div
                style={{
                  padding: '2px 16px 14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                {isDecoding ? (
                  <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11.5, color: theme.inkDim }}>
                    {progress && progress.total > 0
                      ? `取り込み中… ${progress.done}/${progress.total}フレーム`
                      : '取り込み中…'}
                  </span>
                ) : (
                  <>
                    {/* idle は削除不可なので理由を添える。他は左に何も置かず変更/削除を右へ寄せない。 */}
                    {isIdle ? (
                      <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, color: theme.iconInactive }}>
                        待機は必須です(差し替えのみ可能)。
                      </span>
                    ) : (
                      <span />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <button
                        disabled={busy}
                        onClick={() => onReplace(entry.state)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          background: 'transparent',
                          border: `1px solid ${theme.line}`,
                          borderRadius: 999,
                          padding: '4px 10px',
                          color: busy ? theme.iconInactive : theme.inkDim,
                          fontFamily: "'M PLUS 1 Code', sans-serif",
                          fontSize: 11,
                          cursor: busy ? 'default' : 'pointer',
                        }}
                      >
                        <Upload size={11} /> {entry.mapped ? '変更' : '設定'}
                      </button>
                      {/* 削除は idle 以外かつ割当済みのみ(未割当は消すものが無い)。 */}
                      {!isIdle && entry.mapped &&
                        (deleteConfirm === entry.state ? (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => onConfirmDelete(entry.state)}
                              style={pillStyle(theme.sealRed, theme.bgPanel, true, busy)}
                            >
                              未割当に戻す
                            </button>
                            <button
                              disabled={busy}
                              onClick={onCancelDelete}
                              style={{ ...pillStyle('transparent', theme.inkDim, false, busy), border: `1px solid ${theme.line}` }}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => onAskDelete(entry.state)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'transparent',
                              border: `1px solid ${theme.line}`,
                              borderRadius: 999,
                              padding: '4px 10px',
                              color: busy ? theme.iconInactive : theme.sealRed,
                              fontFamily: "'M PLUS 1 Code', sans-serif",
                              fontSize: 11,
                              cursor: busy ? 'default' : 'pointer',
                            }}
                          >
                            <Trash2 size={11} /> 削除
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── 小さなスタイル/部品 ─────────────────────────────

const toggleButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  flexShrink: 0,
};

/** 行の ▶(この状態をプレビュー枠で再生)。両形式の行で共有する。 */
function PreviewButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }): React.JSX.Element {
  const theme = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="この状態をプレビュー"
      title={disabled ? 'プレビューの準備中です' : 'この状態をプレビュー'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 4,
        flexShrink: 0,
      }}
    >
      <Play size={14} color={disabled ? theme.iconInactive : theme.accent} />
    </button>
  );
}

function tagStyle(color: string, bg: string): React.CSSProperties {
  return {
    fontFamily: "'M PLUS 1 Code', sans-serif",
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 9px',
    borderRadius: 999,
    color,
    background: bg,
    whiteSpace: 'nowrap',
  };
}

function pillStyle(bg: string, color: string, bold: boolean, disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "'M PLUS 1 Code', sans-serif",
    fontSize: 11,
    fontWeight: bold ? 700 : 400,
    color,
    background: bg,
    border: 'none',
    borderRadius: 999,
    padding: '4px 9px',
    cursor: disabled ? 'default' : 'pointer',
  };
}

function fullButtonStyle(bg: string, color: string, disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '11px',
    borderRadius: 12,
    border: 'none',
    background: bg,
    color,
    fontFamily: "'M PLUS 1 Code', sans-serif",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
  };
}

