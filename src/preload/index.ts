import { contextBridge } from 'electron';

/**
 * contextIsolation: true / sandbox: true 前提のpreload(security.md 5章)。
 * レンダラーへはこのAPIオブジェクト経由でのみ機能を公開し、Node APIは直接渡さない。
 * IPCチャンネルは実装フェーズで必要になった時点でここに追加する。
 */
const api = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const;

export type YorimashiApi = typeof api;

contextBridge.exposeInMainWorld('yorimashi', api);
