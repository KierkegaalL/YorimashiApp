/// <reference types="vite/client" />

import type { YorimashiApi } from '../preload';

declare global {
  interface Window {
    /** preloadがcontextBridge経由で公開するAPI(src/preload/index.ts) */
    yorimashi: YorimashiApi;
  }
}
