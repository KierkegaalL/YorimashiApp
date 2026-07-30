/**
 * 全体設定タブ(FR-7/FR-10)とホームタブが読み書きする設定の Main↔Renderer 共有契約。
 * UIの正: docs/mockups/control-panel.jsx L1255-1346(全体設定)/ L757-803(ホーム)。
 * 対応する設定は config.general(配色テーマ・表示サイズ・クリックスルー・自動起動)と
 * config.emotionEngine(リアクション持続・無操作でsleepyへ移行するまでの時間)。
 *
 * `code-settings.ts` と同じ役割・同じ方針で置く(Main の受理と Renderer の入力チェックで
 * **同じ検証規則を使う**ための単一の情報源)。zod を import しない点も同じで、これは
 * `model-manage.ts` が書いているとおり **依存の向きの問題**: config-schema.ts が
 * こちらの定数を import する(逆向きにすると Renderer が表示サイズの範囲を読むだけで
 * Zod スキーマ一式をバンドルへ取り込む)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(config と EmotionEngine の
 * 設定値であってキャラ描画の分岐に触れない。表示サイズはウィンドウの寸法計算に使われるが、
 * その計算=`resolveWindowSize()` は `baseResolution × displaySize` で**両形式共通**
 * (character-window.md 論点2の決着))。よって対称性チェック(CLAUDE.md原則4)の対象外。
 *
 * **⚠️ `baseResolution × displaySize`という計算式は共通だが、`baseResolution`自体の値の
 * 決め方はLive2D限定で異なる(2026-07-30)**: Live2Dは取り込み時に正確な値を読めない
 * (`model-importer.ts`)ため暫定値で登録され、初回描画時にRendererが実測してMainへ報告し、
 * Mainがアスペクト比の補正と2倍の底上げを行って`baseResolution`を書き換える
 * (`character-window.ts`の`normalizeLive2dBaseResolution`/`LIVE2D_BASE_RESOLUTION_TARGET_MAX`)。
 * 結果、Live2Dは同じ`displaySize`値でもスプライトセット(取り込み時に実寸をそのまま使う)より
 * キャラクターが大きく見える。下記`DISPLAY_SIZE_MAX`のdocコメント参照。
 */

/** 配色テーマの選択肢(要件定義書 C-15: light/dark/system の3モード)。 */
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * 表示サイズ(`config.general.displaySize`)の下限・上限。
 *
 * **モックアップのスライダー(min=20 / max=100)と一致させた値**で、未決事項C6として
 * 決着済み(2026-07-27。Notion正本=basic-design.md 6.1 に反映済み)。常駐マスコットが
 * 画面を占有しすぎず、かつ視認できる範囲という判断。config-schema.ts の
 * `z.number().min(DISPLAY_SIZE_MIN).max(DISPLAY_SIZE_MAX)` がこの定数を使う。
 *
 * **⚠️ C6の「画面を占有しすぎない」判断の前提がLive2D限定で崩れている(2026-07-30)**:
 * C6決着時点では「同じ`displaySize`値なら見た目の占有率も両形式で同じ」という前提だったが、
 * ユーザー要望によりLive2Dの`baseResolution`は実測後にMainが2倍へ底上げする
 * (`character-window.ts`の`LIVE2D_BASE_RESOLUTION_TARGET_MAX`)。結果、Live2Dは同じ
 * `displaySize`値でもスプライトセットより大きな物理ウィンドウ・大きな面積を占有しうる。
 * C6自体を再決着させる変更ではない(`DISPLAY_SIZE_MIN`/`MAX`の値は不変)が、「画面を占有
 * しすぎない」根拠として参照する場合はこの非対称を踏まえること。
 */
export const DISPLAY_SIZE_MIN = 0.2;
export const DISPLAY_SIZE_MAX = 1;

/** 表示サイズが有効か(範囲内の有限数。整数ではないので `Number.isInteger` は使わない)。 */
export function isValidDisplaySize(value: number): boolean {
  return Number.isFinite(value) && value >= DISPLAY_SIZE_MIN && value <= DISPLAY_SIZE_MAX;
}

/** 配色テーマの選択肢に含まれるか。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

/**
 * 全体設定タブへ返す現在値。
 *
 * `autostart` を **config の値と実際のOS登録状態の2つに分けて持つ**。ログイン項目の登録は
 * macOS 側の状態であって config.json とは別物で、外部要因(ユーザーがシステム設定から
 * 直接外す・開発ビルドで登録が効かない)でずれうる。1つにまとめると「ONにしたのに
 * 起動しない」状態を UI が「ON」と表示し続けることになる
 * (constraints.md「アプリが自分の状態について嘘をつかない」)。
 */
export interface GeneralSettingsSnapshot {
  themeMode: ThemeMode;
  /** 0.2〜1.0。UIでは百分率(20〜100%)で見せる。 */
  displaySize: number;
  clickThrough: boolean;
  /** config.general.autostart(利用者の意思)。 */
  autostart: boolean;
  /**
   * OSに実際にログイン項目として登録されているか(`app.getLoginItemSettings().openAtLogin`)。
   * `autostart` と食い違っていれば UI がその旨を出す。取得できない環境では null。
   */
  autostartRegistered: boolean | null;
  /**
   * ログイン項目の登録が実際に機能する環境か。**開発実行(未パッケージ)では機能しない**ため、
   * その場合は false にして UI で断り書きを出す(黙って効かないトグルにしない)。
   */
  autostartSupported: boolean;
  /** リアクションがMoodへ自動復帰するまで(config.emotionEngine.reactionDurationMs)。表示のみ。 */
  reactionDurationMs: number;
  /** 無操作でsleepyへ移行するまで(config.emotionEngine.idleTimeoutMs)。表示のみ。 */
  idleTimeoutMs: number;
}

/**
 * 全体設定タブからの変更要求。指定したキーだけを更新する。
 *
 * `reactionDurationMs` / `idleTimeoutMs` は**含めない**。モックアップ(L1337-1344)が
 * この2つを操作要素ではなく素の数値表示にしているため、編集UIを勝手に足さない
 * (足すならUIの正本=モックアップ側から変える)。
 */
export interface GeneralSettingsPatch {
  themeMode?: ThemeMode;
  displaySize?: number;
  clickThrough?: boolean;
  autostart?: boolean;
}
