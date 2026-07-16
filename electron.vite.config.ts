import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      // キャラクター表示ウィンドウとControl Panelの2レンダラー構成(基本設計書 3章)
      rollupOptions: {
        input: {
          character: resolve(__dirname, 'src/renderer/character/index.html'),
          'control-panel': resolve(__dirname, 'src/renderer/control-panel/index.html'),
        },
      },
    },
  },
});
