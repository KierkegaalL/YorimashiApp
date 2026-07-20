/**
 * モード設定タブ(FR-7)の Code Adapter セクションが読み書きする設定の Main↔Renderer 共有契約。
 * 対応する設定は config.codeAdapter(監視対象パス・ポート番号)と
 * config.emotionEngine.failStreakThreshold(連続失敗で焦り始める回数)。
 * UIの正: docs/mockups/control-panel.jsx L1183-1193(Code Adapter の Section)。
 *
 * **watchedProjectPaths への追加は Renderer から任意の配列で行わせない**。
 * dispatch.sh の書き込み先を「利用者がネイティブダイアログで明示選択したフォルダ」に限定する
 * 不変条件(onboarding-service.ts「このダイアログだけが watchedProjectPaths の入口」)を守るため、
 * 追加はダイアログ経由(CodeSettingsChooseProject)に限り、`CodeSettingsPatch` は
 * ポートとしきい値だけを扱う。削除は特定パス指定で安全なので別経路(CodeSettingsRemoveProject)で許す。
 *
 * 形式非依存: Code Adapter は EmotionEngine へ状態キーを渡すだけで Live2D/スプライトセットの
 * どちらも意識しない。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

/**
 * モード設定タブへ返す Code Adapter の現在値。
 *
 * `serverPort`(設定値=希望ポート)と `actualPort`(実際に待ち受けているポート)を**区別して持つ**。
 * ローカルサーバーはポート競合時に別ポートへフォールバックし、変更は起動時にしか反映されない
 * (environments.md)。両者を1つにまとめると「設定した番号で動いている」という嘘になりうるため、
 * UIは実ポートを併記して「変更は再起動後に反映」と示す。
 */
export interface CodeSettingsSnapshot {
  /** 監視対象プロジェクトの絶対パス群。**空配列 = 絞り込みなし(全プロジェクトに反応)**(code-adapter.ts)。 */
  watchedProjectPaths: string[];
  /** config に保存された希望ポート。次回の起動時にこの番号でバインドを試みる。 */
  serverPort: number;
  /** 実際に待ち受けているポート。サーバー未起動なら null。 */
  actualPort: number | null;
  /** この回数だけ連続失敗すると Mood が tired になる(config.emotionEngine.failStreakThreshold)。 */
  failStreakThreshold: number;
}

/**
 * モード設定タブからの変更要求。**watchedProjectPaths は含めない**(上記の不変条件)。
 * 指定したキーだけを更新する。
 */
export interface CodeSettingsPatch {
  serverPort?: number;
  failStreakThreshold?: number;
}

// ── 検証の単一の情報源(Main の受理と Renderer の入力チェックで同じ規則を使う) ──────────

/** TCPポート番号の下限(1)。0 は「任意の空きポート」を意味しOSが割り当てるため設定値としては拒否する。 */
export const SERVER_PORT_MIN = 1;
/** TCPポート番号の上限(65535)。 */
export const SERVER_PORT_MAX = 65535;
/** 連続失敗しきい値の下限(1)。0 だと「0回失敗で tired」になり無意味なため拒否する。 */
export const FAIL_STREAK_MIN = 1;
/** 連続失敗しきい値の上限(100)。青天井を許すと事実上「tired にならない」設定を作れてしまう。 */
export const FAIL_STREAK_MAX = 100;

/** ポート番号が有効か(整数かつ [SERVER_PORT_MIN, SERVER_PORT_MAX])。 */
export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= SERVER_PORT_MIN && value <= SERVER_PORT_MAX;
}

/** 連続失敗しきい値が有効か(整数かつ [FAIL_STREAK_MIN, FAIL_STREAK_MAX])。 */
export function isValidFailStreak(value: number): boolean {
  return Number.isInteger(value) && value >= FAIL_STREAK_MIN && value <= FAIL_STREAK_MAX;
}
