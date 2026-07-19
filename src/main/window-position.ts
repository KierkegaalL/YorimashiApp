/**
 * キャラクター表示ウィンドウの位置解決ロジック(FR-6 / character-window.md 論点1・2)。
 *
 * Electronの `screen` モジュールに依存せず、ディスプレイ情報を引数(DisplayEnv)で受け取る
 * 純粋関数として実装する。理由:
 * - character-window.md の実測(macOSは画面外座標を補正しない)に基づく判定であり、
 *   バグると「モニタを外して起動するとキャラクターが永久に到達不能になる」実在のリスクを持つ。
 *   純粋関数に切り出すことで、Electron GUIを開けないサンドボックスでも実データで検証できる
 *   (.claude/rules/build-commands.md「サンドボックスで可能な検証」)。
 * - character-window.md #検証結果 の8ケース表をそのまま回帰テストにできる。
 *
 * 形式非依存: Live2D/スプライトセットのどちらでも座標計算は同一(サイズだけ形式で決まるが、
 * それは呼び出し側で解決してsizeとして渡す)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 掴んで動かせる最低限の露出量(px)。character-window.md 論点1「未解決のトレードオフ」参照。 */
export const MIN_VISIBLE = 80;

/** 初期配置(右下)のマージン(px)。character-window.md 論点2。 */
export const DEFAULT_MARGIN = 24;

/**
 * 位置解決に必要なディスプレイ情報。Electronの `screen` から組み立てて渡す。
 * テストではフェイクを渡して character-window.md の実測ケースを再現する。
 */
export interface DisplayEnv {
  /** 全ディスプレイの workArea(メニューバー・Dockを除いた領域)。 */
  workAreas: Rect[];
  /** プライマリディスプレイの workArea(初期配置の基準)。 */
  primaryWorkArea: Rect;
  /** 指定した点に最も近いディスプレイの workArea(見失い時の復帰先)。 */
  nearestWorkArea(point: Point): Rect;
}

/** 2矩形の交差領域。重ならない場合は width/height が0以下になる。 */
export function intersect(a: Rect, b: Rect): Rect {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * 現在のディスプレイ構成で十分に可視か。どれか1つの workArea と、掴める最低限だけ
 * 重なっていればよい。ウィンドウが MIN_VISIBLE より小さい場合はウィンドウ寸法を上限にする
 * (小さいウィンドウを不当に画面外扱いしない)。
 */
export function isSufficientlyVisible(bounds: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((wa) => {
    const i = intersect(bounds, wa);
    return (
      i.width >= Math.min(MIN_VISIBLE, bounds.width) &&
      i.height >= Math.min(MIN_VISIBLE, bounds.height)
    );
  });
}

/**
 * 見失った場合の復帰先: ウィンドウ中心から最寄りのディスプレイの workArea 内へ引き戻す。
 * getDisplayNearestPoint は範囲外座標でも必ず実在するディスプレイを返す(character-window.md実測)。
 */
export function clampToNearest(bounds: Rect, env: DisplayEnv): Point {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const wa = env.nearestWorkArea(center);
  return {
    x: Math.round(Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - bounds.width)),
    y: Math.round(Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - bounds.height)),
  };
}

/**
 * 初期配置: プライマリディスプレイ workArea の右下、マージン付き。
 * 上端(メニューバー)・左上(他アプリの信号機ボタン群)を避け、Dockとも衝突しない。
 */
export function defaultPosition(size: Size, primaryWorkArea: Rect): Point {
  return {
    x: Math.round(primaryWorkArea.x + primaryWorkArea.width - size.width - DEFAULT_MARGIN),
    y: Math.round(primaryWorkArea.y + primaryWorkArea.height - size.height - DEFAULT_MARGIN),
  };
}

/**
 * 保存位置とウィンドウサイズから、実際に適用すべき位置を決める。
 * - saved が null(初回起動): 初期配置を計算する。
 * - 十分に可視: ユーザーの意図を尊重し、そのまま採用する。
 * - 見失っている: 最寄りへクランプする(介入は「そのままでは操作不能になる場合」だけ)。
 */
export function resolvePosition(saved: Point | null, size: Size, env: DisplayEnv): Point {
  if (!saved) {
    return defaultPosition(size, env.primaryWorkArea);
  }
  const bounds: Rect = { x: saved.x, y: saved.y, width: size.width, height: size.height };
  if (isSufficientlyVisible(bounds, env.workAreas)) {
    return saved;
  }
  return clampToNearest(bounds, env);
}
