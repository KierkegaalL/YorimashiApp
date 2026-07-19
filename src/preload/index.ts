import { contextBridge, ipcRenderer } from 'electron';

import { IPC, type WindowPoint } from '../shared/ipc';

/**
 * contextIsolation: true / sandbox: true 前提のpreload(security.md 5章)。
 * レンダラーへはこのAPIオブジェクト経由でのみ機能を公開し、Node APIは直接渡さない。
 *
 * この preload はキャラクターウィンドウ・Control Panel の両方で使われる。character.* は
 * キャラクターウィンドウ専用だが、Main側で送信元(webContents)を検証して他ウィンドウからの
 * 呼び出しを弾くため、両方に公開しても安全(character-window.ts windowForSender)。
 */
const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** キャラクターウィンドウのドラッグ移動・右クリックメニュー(character-window.md 論点3)。 */
  character: {
    /** ドラッグ開始。現在のウィンドウ左上座標を得る(以降の move はこれを基準に算出する)。 */
    beginDrag: (): Promise<WindowPoint | null> => ipcRenderer.invoke(IPC.CharacterBeginDrag),
    /** ドラッグ中の目標スクリーン座標を送る。 */
    dragMove: (point: WindowPoint): void => ipcRenderer.send(IPC.CharacterDragMove, point),
    /** ドラッグ終了(Mainが windowPosition をデバウンス保存する)。 */
    endDrag: (): void => ipcRenderer.send(IPC.CharacterEndDrag),
    /** クリックスルーOFF時の右クリックで共通メニューを表示するよう要求する。 */
    requestContextMenu: (): void => ipcRenderer.send(IPC.CharacterContextMenu),
  },
} as const;

export type YorimashiApi = typeof api;

contextBridge.exposeInMainWorld('yorimashi', api);
