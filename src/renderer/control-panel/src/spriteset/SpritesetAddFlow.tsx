/**
 * スプライトセットの新規追加フロー(FR-5 第2段階b-2)。
 * **UIの正本**: docs/mockups/control-panel.jsx L985-1080(「モーションをAIで生成」セクション)。
 *
 * 画面の流れは正本どおり3段:
 *  1. 下絵を選ぶ → クロマグリーン合成した `background_key.png` を保存(Mainのネイティブダイアログ)
 *  2. 感情ごとに、外部AIへ渡すプロンプトをコピー → 生成された mp4/webm を「取り込む」
 *     (Renderer でデコード + 色キー抜き。spriteset-pipeline.md 手順4前段・中段)
 *  3. 「このモデルを追加する」→ Main でアニメーションWebPへエンコードして登録(手順4後段)
 *
 * **idle だけ必須**(C-18)。他は未取込でよく、実行時に idle へフォールバックする。
 *
 * 動画ファイルは `<input type="file">` でユーザーが明示選択した `File` を直接扱う
 * (**Renderer から Main へパスを渡さない**。Chromium しかデコードできないため、
 * バイト列は Renderer 側に留まり、Main へ渡すのは色キー抜き済みのPNGフレームだけ)。
 *
 * Live2D に対応物を持たない正当な非対称(Live2Dは完成済みモデルをフォルダ取り込みするだけ)。
 */

import { useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Copy, ImagePlus, Sparkles, Upload } from 'lucide-react';

import { useTheme } from '../theme';
import { Row, Section } from '../panel-ui';
import { EMOTION_STATES, FALLBACK_STATE, type EmotionState } from '../../../../shared/emotions';
import { buildExternalInstruction, CLIP_PROMPTS } from '../../../../shared/spriteset/clip-prompts';
import type { ModelManageSnapshot } from '../../../../shared/model-manage';
import type { SpritesetImportPayload } from '../../../../shared/spriteset/import-payload';
import { decodeAndKeyVideo, type DecodedClip } from './decode-video';

/** モックアップ(confirmAddSpritesetModel)どおりの既定名。名前の変更は後続タスク。 */
const DEFAULT_MODEL_NAME = '新しいモデル';

export interface SpritesetAddFlowProps {
  /** 取り込み完了時に更新後のスナップショットを親へ返す。 */
  onImported: (snapshot: ModelManageSnapshot) => void;
  /** エラーの表示は親(ModelTab)のエラー欄に集約する。 */
  onError: (message: string) => void;
}

export function SpritesetAddFlow({ onImported, onError }: SpritesetAddFlowProps): React.JSX.Element {
  const theme = useTheme();
  /** background_key.png を保存できたか(モックアップの imageUploaded に対応)。 */
  const [backgroundKeyPath, setBackgroundKeyPath] = useState<string | null>(null);
  const [clips, setClips] = useState<Partial<Record<EmotionState, DecodedClip>>>({});
  /** 取り込み中の感情(デコードは重いので1件ずつ)。 */
  const [decoding, setDecoding] = useState<EmotionState | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** どの感情に対してファイル選択を開いたか。 */
  const pendingState = useRef<EmotionState | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const busy = decoding !== null || submitting;

  const saveBackgroundKey = (): void => {
    const api = window.yorimashi?.models;
    if (!api) {
      return;
    }
    void api
      .makeBackgroundKey()
      .then((result) => {
        if (result.saved) {
          setBackgroundKeyPath(result.path);
          onError('');
        }
        // キャンセルは何も起きない(嘘の成功表示をしない)。
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : '画像を合成できませんでした。');
      });
  };

  const pickVideo = (state: EmotionState): void => {
    pendingState.current = state;
    fileInput.current?.click();
  };

  const onFileChosen = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    const state = pendingState.current;
    // 同じファイルを続けて選べるよう毎回クリアする。
    event.target.value = '';
    pendingState.current = null;
    if (!file || state === null) {
      return;
    }
    setDecoding(state);
    setProgress({ done: 0, total: 0 });
    void decodeAndKeyVideo(file, { onProgress: (done, total) => setProgress({ done, total }) })
      .then((clip) => {
        setClips((prev) => ({ ...prev, [state]: clip }));
        onError('');
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : '動画を取り込めませんでした。');
      })
      .finally(() => {
        setDecoding(null);
        setProgress(null);
      });
  };

  const submit = (): void => {
    const api = window.yorimashi?.models;
    const idle = clips[FALLBACK_STATE];
    if (!api || !idle) {
      return;
    }
    const payload: SpritesetImportPayload = { name: DEFAULT_MODEL_NAME, clips };
    setSubmitting(true);
    void api
      .importSpriteset(payload)
      .then((snapshot) => {
        // 取り込めたらドラフトを空に戻す(モックアップ confirmAddSpritesetModel と同じ)。
        setClips({});
        setBackgroundKeyPath(null);
        onImported(snapshot);
        onError('');
      })
      .catch((err: unknown) => {
        onError(err instanceof Error ? err.message : 'モデルを追加できませんでした。');
      })
      .finally(() => setSubmitting(false));
  };

  const idleReady = clips[FALLBACK_STATE] !== undefined;

  // 段1: まだ background_key.png を作っていない。
  if (backgroundKeyPath === null) {
    return (
      <>
        <button
          onClick={saveBackgroundKey}
          style={{
            width: '100%',
            padding: 16,
            borderRadius: 14,
            cursor: 'pointer',
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
          <ImagePlus size={20} color={theme.iconInactive} />
          画像ファイルを1枚選んでアップロード
          <span style={{ fontSize: 11, color: theme.iconInactive }}>
            PNG / JPG(透過推奨)・ 動画ファイルの用意は不要です
          </span>
        </button>
      </>
    );
  }

  // 段2-3: 生成用の画像ができた。感情ごとに動画を取り込む。
  // hint内の「正方形(1:1)・800×800px程度」は、実測や正本の決定事項ではない。
  // spriteset-importer.tsはidleの実寸をそのままbaseResolutionにするだけで寸法の上限・
  // アスペクト比を検証しておらず、docs/data.mdの800×800はmanifest.jsonのJSON記載例が
  // たまたまその値というだけで推奨値の根拠ではない。ウィンドウサイズが
  // `baseResolution × displaySize` で決まる(character-window.md 論点2決着済み)ため、
  // 極端に大きい・縦横比の偏った画像を避けるための、この実装時点でのUX上の目安に過ぎない。
  // **UI正本(docs/mockups/control-panel.jsx)のhintには解像度の言及が無い**。次回モックアップ
  // 更新時に反映するかは未判断(Memory.mdの「選び直す」文言と同様の申し送り扱い)。
  return (
    <>
      <Section
        title="モーションをAIで生成"
        hint="外部サービスに渡す画像は、背景を自動でクロマグリーンに合成しています(そのまま使ってください)。画像の解像度は正方形(1:1)・800×800px程度を推奨します(idleの実寸がそのままキャラクター表示ウィンドウの基準解像度になるため、大きすぎるとメモリ・処理負荷が増えます)。生成されたmp4/webmを「取り込む」で選ぶと、背景の色キー抜き+WebP変換を自動で行います。プロンプトはコピーして調整できます。idleだけは必須、他は未設定でもidleにフォールバックします。"
      >
        <Row
          label="外部サービスへ渡す画像"
          sub={`background_key.png ・ クロマグリーン合成済み(保存先: ${backgroundKeyPath})`}
          last={false}
        >
          {/* モックアップ(L1010-1016)はここを「保存」としているが、あちらは onClick を持たない
              静的モック。このボタンが実際に行うのは**元画像を選び直して合成・保存をやり直す**
              ことなので、「保存」と書くと「今の画像をもう一度保存するだけ」と誤解される
              (押すと別画像に差し替わりうる)。実際の動作に合わせて「選び直す」と表示する。 */}
          <button onClick={saveBackgroundKey} style={pillStyle(theme.line, theme.inkDim)}>
            <ImagePlus size={11} /> 選び直す
          </button>
        </Row>
        {EMOTION_STATES.map((state, i) => {
          const clip = clips[state];
          const done = clip !== undefined;
          const isDecoding = decoding === state;
          const { label, prompt } = CLIP_PROMPTS[state];
          const isLastRow = i === EMOTION_STATES.length - 1;
          return (
            <div key={state} style={{ borderBottom: isLastRow ? 'none' : `1px solid ${theme.line}` }}>
              <Row
                label={label}
                sub={
                  done
                    ? `${state}.webp ・ ${clip.frames.length}フレーム ・ ${clip.width}×${clip.height}`
                    : isDecoding
                      ? progress && progress.total > 0
                        ? `取り込み中… ${progress.done}/${progress.total}フレーム`
                        : '取り込み中…'
                      : `「${prompt}」・ mp4/webmを選ぶ`
                }
                last
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {done ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.mint, fontSize: 11.5 }}>
                      <CheckCircle2 size={14} /> 取込済
                    </span>
                  ) : (
                    <>
                      <button
                        title="プロンプトをコピー"
                        disabled={busy}
                        onClick={() => {
                          void navigator.clipboard.writeText(prompt).catch(() => {
                            onError('プロンプトをコピーできませんでした。');
                          });
                        }}
                        style={pillStyle(theme.line, busy ? theme.iconInactive : theme.inkDim, busy)}
                      >
                        <Copy size={11} /> コピー
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => pickVideo(state)}
                        style={{
                          ...pillStyle(busy ? theme.line : theme.accent, busy ? theme.iconInactive : theme.accent, busy),
                          background: busy ? 'transparent' : theme.accentTag,
                          fontWeight: 600,
                        }}
                      >
                        <Upload size={11} /> {isDecoding ? '取込中…' : '取り込む'}
                      </button>
                    </>
                  )}
                </div>
              </Row>
              {/* 上のプロンプトは感情ごとの動きの差分のみの短文。外部AIツールにそのまま貼り付けて
                  期待どおりのモーションを作らせるには、背景・カメラ固定などの技術的な制約
                  (色キー抜きが成立する条件)を含む完成形の指示文が要る。取込済になったら不要。
                  **UI正本(docs/mockups/control-panel.jsx L1007-1046)には無い要素**
                  (モックアップは「コピー」「取り込む」の2ボタンのみ)。外部AIツール利用者から
                  実際に要望があり追加した機能で、正本側への反映はまだ行っていない
                  (次回モックアップ更新時に追記予定)。 */}
              {!done && (
                <div style={{ padding: '0 16px 14px 16px' }}>
                  <button
                    title="外部AIツール向けの指示文をコピー(背景・カメラ固定などの制約込み)"
                    disabled={busy}
                    onClick={() => {
                      void navigator.clipboard.writeText(buildExternalInstruction(state)).catch(() => {
                        onError('指示文をコピーできませんでした。');
                      });
                    }}
                    style={{
                      ...pillStyle(theme.line, busy ? theme.iconInactive : theme.inkDim, busy),
                      width: '100%',
                      justifyContent: 'center',
                    }}
                  >
                    <ClipboardList size={11} /> 指示文をコピー
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <button
        disabled={!idleReady || busy}
        onClick={submit}
        style={{
          width: '100%',
          padding: 13,
          borderRadius: 12,
          marginTop: 4,
          border: 'none',
          cursor: idleReady && !busy ? 'pointer' : 'not-allowed',
          background: idleReady && !busy ? theme.accent : theme.dashedBorder,
          color: idleReady && !busy ? theme.bgPanel : theme.iconInactive,
          fontFamily: "'M PLUS 1 Code', sans-serif",
          fontSize: 13,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Sparkles size={15} />
        {submitting
          ? 'WebPへ変換しています…'
          : idleReady
            ? 'このモデルを追加する'
            : 'まずidleを取り込んでください'}
      </button>

      <input
        ref={fileInput}
        type="file"
        accept="video/*"
        onChange={onFileChosen}
        style={{ display: 'none' }}
      />
    </>
  );
}

/** モックアップの小さな丸ボタン(Row 右側)の共通スタイル。 */
function pillStyle(border: string, color: string, disabled = false): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: `1px solid ${border}`,
    borderRadius: 999,
    padding: '4px 8px',
    color,
    fontSize: 11,
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
  };
}
