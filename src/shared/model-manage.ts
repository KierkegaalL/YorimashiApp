/**
 * モデル管理タブ(FR-5/FR-7)の Main↔Renderer 共有契約。
 * UIの正: docs/mockups/control-panel.jsx L805-1179、正本: docs/detailed-design/model-mapping-ui.md。
 *
 * 扱うのは **config.model のスロット管理**(一覧・削除・アクティブ選択・モードによる自動切替)まで。
 * モデルの**取り込み**(Live2Dフォルダ/zip・スプライトセット生成)と**感情↔モーション対応の編集**は
 * 後続タスク(model-mapping-ui.md / spriteset-pipeline.md)で、専用の契約を別途足す。
 *
 * 形式非依存: Live2D/スプライトセットのどちらのスロットも同じ形で扱う(`renderType` を持つだけで
 * 分岐しない)。**上限2体・アクティブ解決・削除の手順は両形式で完全に共通**であり、
 * 片方だけの分岐を持たない(CLAUDE.md原則4の対称性は「両形式が同じ経路を通る」ことで保たれる)。
 */

/**
 * 同時にセットできるモデルの上限(要件定義書 FR-5: 形式を問わず合計2体)。
 *
 * **単一の情報源はここ**。config-schema.ts の `slots: z.array(...).max(MAX_MODEL_SLOTS)` が
 * これを import して使う(スキーマと画面で別々にハードコードしない)。
 *
 * **依存の向きが逆でないことが重要**: このモジュールは zod を一切 import しない。逆向き
 * (config-schema.ts から値を re-export)にすると、Renderer がこの定数を1つ使うだけで
 * Zod スキーマ定義一式(約700KB)がバンドルへ取り込まれる(実測で確認済み)。
 */
export const MAX_MODEL_SLOTS = 2;

/**
 * モデル表示名の上限文字数。**実測に基づく値ではない暫定値**(モデル一覧の行レイアウトを
 * 崩さないための目安。constraints.md「推測で書かない」の対象になるほどの実装判断ではないが、
 * 検証はしていないことを正直に記録しておく。実素材で狭すぎる/緩すぎると分かれば調整する)。
 *
 * `MAX_MODEL_SLOTS` と同じ理由でここに置く: Main(`parseModelName`での検証)と
 * Renderer(`<input maxLength>`での入力自体の抑止)の**両方が同じ値を参照**する必要があり、
 * 逆向き(Main側からRendererが値を引く)にすると不要な依存が生まれるため。
 */
export const MAX_MODEL_NAME_LENGTH = 40;

/**
 * 一覧に出す1スロット。config.model.slots の ModelSlot から**表示に要るものだけ**を写す。
 * `installedDir` 等のファイルシステム上の位置は Renderer に渡さない(表示に不要で、
 * 渡すと Renderer 由来のパスを信じる経路を作りかねないため)。
 */
export interface ModelSlotView {
  id: string;
  name: string;
  renderType: 'live2d' | 'spriteset';
  /** live2d のみ。'cubism4' は Cubism 5(model3.json形式)も含む。 */
  cubismVersion?: 'cubism2' | 'cubism4';
  /** モードによる自動切替時に、このスロットがどちらのアダプタ担当か(未割当は null)。 */
  assignedAdapter: 'code' | 'chat' | null;
}

/** モデル管理タブへ返す現在の状態。 */
export interface ModelManageSnapshot {
  slots: ModelSlotView[];
  /** 2体セット時にモードでモデルを切り替えるか(config.model.autoSwitchByMode)。 */
  autoSwitchByMode: boolean;
  /** 自動切替オフ時に使うモデル(config.model.manualActiveId)。未指定は null。 */
  manualActiveId: string | null;
  /**
   * **いま実際に描画対象として解決されているモデルの id**(0体なら null)。
   * `manualActiveId` をそのまま出さないのは、解決結果と設定値が食い違いうるため
   * (自動切替オン時は assignedAdapter で決まり、未設定時は先頭へフォールバックする)。
   * UIの「使用中」表示はこの値を使う。設定値から推測して描かない。
   */
  activeModelId: string | null;
  /** 現在のアダプタ(config.activeAdapter)。自動切替時にどちらが選ばれるかの説明に使う。 */
  activeAdapter: 'code' | 'chat';
  /**
   * 直前の操作で**部分的にしか達成できなかったこと**をUIへ伝える(通常は null)。
   *
   * 例: 削除でスロットは外せたがモデルファイルが消せなかった場合。Main のコンソールにしか
   * 出さないと、利用者には「消えた」ようにしか見えないのに実体が残る
   * (constraints.md「アプリが自分の状態について嘘をつかない」)。
   */
  warning: string | null;
}
