/// <reference types="vite/client" />

import type { YorimashiApi } from '../preload';

declare global {
  interface Window {
    /**
     * preloadがcontextBridge経由で公開するAPI(src/preload/index.ts)。
     *
     * **optional なのは意図的**: `/panel`・`/character` はローカルサーバーが配信するHTMLであり、
     * 通常のブラウザからも開ける(environments.md)。その場合 preload は走らず undefined になる。
     * 必須として宣言すると、型検査が「preload不在」の経路を検知できなくなる。
     */
    yorimashi?: YorimashiApi;
  }
}
