import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

/**
 * 最小構成のMainプロセス。
 *
 * 現時点ではControl Panelウィンドウのみを生成する。以下は未実装:
 * - キャラクター表示ウィンドウ(FR-6): 初期配置ロジックが未確定のため着手しない
 *   (docs/detailed-design/character-window.md 参照)。
 * - ローカルサーバー(FR-2/FR-13): 未実装のため、レンダラーは暫定的にVite dev server /
 *   ローカルファイルから読み込んでいる。security.md 7章はローカルサーバー
 *   (http://localhost:8765/panel) 経由への統一を求めているので、サーバー実装時に移行が必要。
 */

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

function createControlPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    show: false,
    title: 'ヨリマシ.app コントロールパネル',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  // レンダラー内のリンクは外部ブラウザで開き、Electronウィンドウを乗っ取らせない
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (rendererUrl) {
    void win.loadURL(`${rendererUrl}/control-panel/index.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/control-panel/index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  createControlPanelWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlPanelWindow();
    }
  });
});

// 対応OSはmacOSのみ(要件定義書 C-01)だが、Electronの慣例に従い明示しておく
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
