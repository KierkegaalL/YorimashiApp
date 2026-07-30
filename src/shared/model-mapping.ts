/**
 * 感情↔モーション/クリップ対応の編集(FR-5 モデル管理タブ 第3段階)の Main↔Renderer 共有契約。
 * UIの正: docs/mockups/control-panel.jsx L1098-1177、正本: docs/detailed-design/model-mapping-ui.md
 * (論点2=Live2Dの選択UI / 論点3=スプライトセットの削除導線 / 論点4=自動マッピング)。
 *
 * マッピングの**正本は各モデルの manifest.json**(CLAUDE.md原則3 / constraints.md 正本一覧)。
 * 編集はすべて manifest.json への書き込みで、config.json には複製しない。ここはその manifest を
 * 「編集画面が要る形」に写した表示・更新契約にすぎない。
 *
 * 形式で構造が異なる(対称だが非同型。manifest.ts の live2d/spriteset と同じ非対称):
 * - live2d: 状態ごとに `{ motion, expression }` の2値を、モデルが持つ候補から選ぶ(論点2)。
 * - spriteset: 状態ごとに1クリップ。編集は差し替え(Track B)と削除(このTrack A)で、候補の概念は無い。
 *
 * **Renderer にファイルパスは渡さない**(model-manage.ts と同じ方針。表示に不要で、Renderer 由来の
 * パスを信じる経路を作らない)。候補名(モーション/表情のグループ名)は表示・選択に要るので渡すが、
 * これらは manifest / モデル定義ファイル内の**キー**であってファイルシステム上のパスではない。
 */

import type { EmotionState } from './emotions';

// ── Live2D ──────────────────────────────────────────

/** 1状態ぶんの Live2D マッピング(現在値)。未割当は motion/expression とも null。 */
export interface Live2dMappingEntry {
  state: EmotionState;
  /** 割り当て中のモーショングループ名(未割当は null)。 */
  motion: string | null;
  /** 割り当て中の表情名(未割当は null)。 */
  expression: string | null;
}

/**
 * Live2D モデルのマッピング編集詳細。`motions`/`expressions` はモデル定義ファイルから
 * 再列挙した**選択肢**(論点2 列挙元)。取り込み時に列挙したものと同じだが、config には
 * 保存していない(表示のたびに列挙し直す。少数のキー配列なので安価)。
 */
export interface Live2dMappingDetail {
  renderType: 'live2d';
  modelId: string;
  /** 選べるモーショングループ名(空配列もありうる)。 */
  motions: string[];
  /** 選べる表情名(空配列もありうる)。 */
  expressions: string[];
  /** 全10状態ぶん(EMOTION_STATES 順)。未割当も含めて必ず10件。 */
  entries: Live2dMappingEntry[];
  /**
   * idle(待機)にモーションの割り当てが無い場合の警告文(無ければ null)。expression の有無は
   * 判定に含めない(Live2DRenderer.applyState() は motion が無ければ再生自体を行わないため)。
   * idle はモーション終了後のフォールバック先(C-18)のため、motion 未設定だと固まりうる
   * (lipsync.md)。取り込み時(model-importer.ts の `autoMapLive2d` 由来)と同じ判定を、
   * 自動再割り当て(autoRestoreAll/autoRestoreState)・手動編集(setLive2dEntry)の結果にも
   * 一貫して適用する(取り込み時だけ警告して編集時は無警告、という非対称を無くす)。
   */
  warning: string | null;
}

// ── スプライトセット ─────────────────────────────────

/** 1状態ぶんのスプライトセットクリップ(現在値)。 */
export interface SpritesetMappingEntry {
  state: EmotionState;
  /** クリップが割り当たっているか(false は未割当=実行時 idle へフォールバック。C-18)。 */
  mapped: boolean;
  /** ループ再生か(mapped のときのみ意味を持つ)。 */
  loop: boolean;
  /** 一過性クリップ再生後の戻り先(なければ null)。 */
  returnTo: EmotionState | null;
}

/**
 * スプライトセットモデルのマッピング編集詳細。Live2D と違い**候補の概念が無い**
 * (クリップは生成フローで感情ごとに1:1で作られる。論点4)。編集は差し替え(Track B・
 * decode-video.ts 再利用)と削除(このTrack A)で、削除は idle 以外のみ(C-18)。
 *
 * **`warning` フィールドを持たない(正当な非対称)**: Live2D の `warning` は「idle に
 * モーションの割り当てが無い」状態を検知するためのものだが、スプライトセットは
 * `MappingService.deleteSpritesetClip` が idle の削除自体を拒否し(C-18)、取り込み
 * (`SpritesetImporter.importSpriteset`)も idle クリップを必須にしているため、
 * 「idle が空になる」状態が構造的に発生しない。
 */
export interface SpritesetMappingDetail {
  renderType: 'spriteset';
  modelId: string;
  /** 全10状態ぶん(EMOTION_STATES 順)。未割当も含めて必ず10件。 */
  entries: SpritesetMappingEntry[];
}

// ── 判別ユニオン ─────────────────────────────────────

export type ModelMappingDetail = Live2dMappingDetail | SpritesetMappingDetail;

/**
 * Live2D の1状態を更新するときのペイロード(preload→Main)。motion/expression は
 * `null`(未割当)か、モデルが持つ候補名のいずれか。**Main 側で候補に含まれることを検証する**
 * (Renderer 由来の値をそのまま manifest へ書かない。mapping-service.ts)。
 */
export interface Live2dEntryPatch {
  motion: string | null;
  expression: string | null;
}
