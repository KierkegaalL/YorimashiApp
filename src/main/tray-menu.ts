/**
 * メニューバーアイコン(Tray)と操作メニュー(FR-6 / character-window.md 論点3)。
 *
 * クリックスルーONの間はキャラクターウィンドウがマウスイベントを一切受け取らないため、
 * 右クリックメニューは既定では開けない。この行き止まりの解消としてメニューバーアイコンを
 * 常設する(要件定義書 C-19)。メニューバーアイコンと右クリックメニューは**同一のテンプレート
 * ビルダー**から生成する(別々に定義すると必ず片方だけ更新される)。
 *
 * アイコンは単色テンプレート画像(鳥居シルエット)。macOSがライト/ダークメニューバーに合わせて
 * 自動で再着色する(setTemplateImage(true))。16px + @2x(32px) を埋め込み、Electronの
 * nativeImage が読めることをオフスクリーンで検証済み(scaleFactors=[1,2]/isTemplate=true)。
 *
 * 形式非依存: メニュー内容はLive2D/スプライトセットで共通(モデル形式に一切触れない)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';

// 鳥居シルエットのテンプレート画像(scratchpadで手続き生成→nativeImageで読込検証済み)。
const TRAY_ICON_16_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAI0lEQVR42mNgGCzgP5kYp2HkyFFuAFWcP7BeGDVgWBlAEgAAm9Yv0Z9vZa0AAAAASUVORK5CYII=';
const TRAY_ICON_32_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR42u3SwQkAMAgDQPdfup3BUlTwAvkfJBEyJKepAOlpXif99g2AEsC445UDfAAAAAAAAAAAYFcutS041swzp4kAAAAASUVORK5CYII=';

export type AdapterKind = 'code' | 'chat';

export interface AppMenuDeps {
  getActiveAdapter(): AdapterKind;
  setActiveAdapter(adapter: AdapterKind): void;
  getClickThrough(): boolean;
  setClickThrough(value: boolean): void;
  openControlPanel(): void;
  resetCharacterPosition(): void;
  quit(): void;
}

/** テンプレート画像(16px + @2x)を組み立てる。 */
export function createTrayIcon(): NativeImage {
  const img = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_16_PNG_BASE64}`);
  img.addRepresentation({
    scaleFactor: 2,
    dataURL: `data:image/png;base64,${TRAY_ICON_32_PNG_BASE64}`,
  });
  img.setTemplateImage(true);
  return img;
}

/**
 * メニューバー・右クリック共通のメニューを、呼び出し時点の config 状態で組み立てる。
 * radio(モード)と checkbox(クリックスルー)は現在値を反映するため、表示のたびに作り直す。
 */
export function buildAppMenu(deps: AppMenuDeps): Menu {
  const activeAdapter = deps.getActiveAdapter();
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Control Panelを開く',
      click: () => deps.openControlPanel(),
    },
    { type: 'separator' },
    {
      label: 'モード: Code',
      type: 'radio',
      checked: activeAdapter === 'code',
      click: () => deps.setActiveAdapter('code'),
    },
    {
      label: 'モード: Chat',
      type: 'radio',
      checked: activeAdapter === 'chat',
      click: () => deps.setActiveAdapter('chat'),
    },
    { type: 'separator' },
    {
      label: 'クリックスルー',
      type: 'checkbox',
      checked: deps.getClickThrough(),
      click: (item) => deps.setClickThrough(item.checked),
    },
    {
      label: '位置をリセット',
      click: () => deps.resetCharacterPosition(),
    },
    { type: 'separator' },
    {
      label: 'ヨリマシ.appを終了',
      click: () => deps.quit(),
    },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * メニューバーアイコンを常設する。クリック/右クリックのたびにメニューを組み立て直して
 * 最新の config 状態(モード・クリックスルー)を反映する。
 */
export function createTray(deps: AppMenuDeps): Tray {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip('ヨリマシ.app — 常世灯里');
  const popup = () => tray.popUpContextMenu(buildAppMenu(deps));
  tray.on('click', popup);
  tray.on('right-click', popup);
  return tray;
}
