/**
 * マッピング編集のプレビュー枠(FR-5 モデル管理タブ 第3段階 Track C / model-mapping-ui.md 論点1)。
 * 「感情とモーションの対応」Section の先頭に固定し、各感情行の ▶ で `setState(state)` を叩いて
 * その状態の描画を確認する。**両形式とも `CharacterRenderer` を通す**(本番=キャラクターウィンドウと
 * 同一経路。プレビュー専用の別描画を作らないことで、マッピングの検証として意味を持たせる。論点1)。
 *
 * キャラクターウィンドウ(useCharacterScene.ts)との違い:
 *  - 状態の駆動が **WS ではなく ▶ ボタン**(EmotionEngine ではなくユーザーが直接 setState)。
 *  - 描画対象は **アクティブモデルではなく編集中のモデル**。/panel には bootstrap を埋め込まないため
 *    installedDir/mappingFile は `models.getPreviewContext(id)` で取る(トークンは /panel が埋め込む
 *    `window.__APP_TOKEN__`、オリジンは `window.location.origin`。readBootstrap がまとめて読む)。
 *  - **編集のたびに作り直す**(reloadNonce): マッピング編集は manifest を書き換えるので、
 *    ロード済みの manifest を握ったままだと古い対応を映してしまう(「状態について嘘をつかない」)。
 *
 * 遅延マウント/destroy(論点1): この枠が表示されている間だけ `mount()` し、外れたら `destroy()` する。
 * MappingEditor がモデルタブと一緒にマウント/アンマウントされるため、effect のクリーンアップが
 * そのまま「離れたら破棄」になる。
 *
 * **描画コードは動的 import で遅延ロードする**(重要): `createRenderer`/`loadManifest`/`readBootstrap` を
 * モジュールトップで静的 import すると、これらが辿る `ManifestSchema`(zod)を含む createRenderer チャンク
 * (~709KB/gzip 127KB)が Control Panel 起動時に `modulepreload` で無条件先読みされてしまう
 * (モデルタブを開かなくても毎回)。これは Memory.md 記録済みの zod 漏れインシデントと同型の回帰。
 * よってこの枠が実際にマウントされたとき(=マッピングSectionを開いたとき)にだけ `await import()` する。
 * 型だけは `import type`(実行時に消えるため modulepreload を生まない)で静的に持つ。Live2D 実行(PixiJS/WebGL)は
 * さらに createRenderer 内部の動的 import で、Live2D プレビュー時にだけ読まれる(SpriteSetRenderer は `<img>` で軽い)。
 *
 * **描画自体はサンドボックスで検証できない**(Electron GUI/WebGL/Cubism ランタイム必須。constraints.md)。
 * ここで検証できるのは配線・ライフサイクル・status 分岐まで。実描画はユーザー確認、かつ **dev(Vite)では
 * トークン未注入のため表示されない**(配信ビルドでのみ。honest に「利用不可」を示す)。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useTheme } from './theme';
import type { CharacterRenderer } from '../../character/renderer/CharacterRenderer';
import type { EmotionState } from '../../../shared/emotions';

export interface ModelPreviewHandle {
  /** 指定状態を描画する(準備未完了なら何もしない)。 */
  setState(state: EmotionState): void;
}

type PreviewStatus =
  | { kind: 'unavailable' } // dev/トークン未注入(配信ビルドでのみ表示)
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface ModelPreviewProps {
  /** 描画するモデルの id。 */
  modelId: string;
  /** 編集のたびに増やすと、最新の manifest で作り直す。 */
  reloadNonce: number;
  /** プレビューが操作可能(ready)かの変化を親へ伝える(▶ ボタンの活性制御)。 */
  onReadyChange?: (ready: boolean) => void;
}

/** プレビュー枠の一辺(px)。論点1 の「120×120程度」。 */
const PREVIEW_SIZE = 132;

export const ModelPreview = forwardRef<ModelPreviewHandle, ModelPreviewProps>(function ModelPreview(
  { modelId, reloadNonce, onReadyChange },
  ref,
) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<CharacterRenderer | null>(null);
  const [status, setStatus] = useState<PreviewStatus>({ kind: 'loading' });

  // onReadyChange をeffectの依存に入れると再マウントが誘発されるため ref 越しに呼ぶ。
  const readyCbRef = useRef(onReadyChange);
  readyCbRef.current = onReadyChange;
  const emitReady = (ready: boolean): void => readyCbRef.current?.(ready);

  useImperativeHandle(
    ref,
    () => ({
      setState: (state: EmotionState) => rendererRef.current?.setState(state),
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let renderer: CharacterRenderer | null = null;
    rendererRef.current = null;
    setStatus({ kind: 'loading' });
    emitReady(false);

    void (async () => {
      try {
        // 描画コードはここで初めて読み込む(トップレベル静的importにすると Control Panel 起動時に
        // createRenderer チャンク=zod入りが modulepreload される。上の設計コメント参照)。
        const [{ readBootstrap }, { loadManifest }, { createRenderer }] = await Promise.all([
          import('../../character/renderer/bootstrap'),
          import('../../character/renderer/loadManifest'),
          import('../../character/renderer/createRenderer'),
        ]);
        if (cancelled) {
          return;
        }
        const bootstrap = readBootstrap();
        // トークン未注入(dev の Vite 配信など)は描画経路が無い。嘘をつかず「利用不可」を出す。
        if (!bootstrap.token) {
          setStatus({ kind: 'unavailable' });
          return;
        }
        const token = bootstrap.token;
        const api = window.yorimashi?.models;
        if (!api) {
          setStatus({ kind: 'unavailable' });
          return;
        }
        const { installedDir, mappingFile } = await api.getPreviewContext(modelId);
        const assetBaseUrl = `${bootstrap.httpOrigin}/models/${installedDir}`;
        const manifest = await loadManifest(assetBaseUrl, mappingFile, token);
        const el = containerRef.current;
        if (cancelled || !el) {
          return;
        }
        renderer = await createRenderer(manifest, {
          assetBaseUrl,
          modelId: installedDir,
          token,
          onReady: () => {
            if (!cancelled) {
              setStatus({ kind: 'ready' });
              emitReady(true);
            }
          },
          onError: (err) => {
            if (!cancelled) {
              setStatus({ kind: 'error', message: errorMessage(err) });
              emitReady(false);
            }
          },
        });
        if (cancelled) {
          renderer.destroy();
          renderer = null;
          return;
        }
        renderer.mount(el);
        rendererRef.current = renderer;
      } catch (err) {
        if (!cancelled) {
          setStatus({ kind: 'error', message: errorMessage(err) });
          emitReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      rendererRef.current = null;
      emitReady(false);
      renderer?.destroy();
    };
    // reloadNonce が変わったら最新 manifest で作り直す(編集の反映)。
  }, [modelId, reloadNonce]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '14px 16px 4px 16px',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: PREVIEW_SIZE,
          height: PREVIEW_SIZE,
          borderRadius: 12,
          border: `1px solid ${theme.line}`,
          background: theme.bgRaised,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* 描画先。SpriteSetRenderer は絶対配置の <img> 2枚、Live2DRenderer は canvas を差す。 */}
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {status.kind !== 'ready' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 10,
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 10.5,
              lineHeight: 1.5,
              color: status.kind === 'error' ? theme.sealRed : theme.iconInactive,
            }}
          >
            {status.kind === 'loading' && 'プレビューを読み込んでいます…'}
            {status.kind === 'unavailable' && 'プレビューはアプリのウィンドウ(配信ビルド)でのみ表示されます'}
            {status.kind === 'error' && status.message}
          </div>
        )}
      </div>
    </div>
  );
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
