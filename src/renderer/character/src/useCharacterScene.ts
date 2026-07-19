import { useEffect, useState, type RefObject } from 'react';

import { readBootstrap } from '../renderer/bootstrap';
import { loadManifest } from '../renderer/loadManifest';
import { createRenderer } from '../renderer/createRenderer';
import type { CharacterRenderer } from '../renderer/CharacterRenderer';
import { EmotionSocket } from '../renderer/emotionSocket';

/**
 * キャラクターの描画シーンを構築・駆動する(FR-5)。
 * ブートストラップ(トークン+アクティブモデル)→ manifest ロード → createRenderer → mount →
 * WS(/ws)で EmotionSnapshot を購読して setState、までを1つのライフサイクルで管理する。
 * アンマウント時に WS と renderer を確実に破棄する(WebGLコンテキスト・オブジェクトURLの解放)。
 *
 * モデル未導入(オンボーディング前)やトークン未注入(dev)では描画せず、状態を正直に返す
 * (constraints.md「自分の状態について嘘をつかない」)。
 */
export type SceneStatus =
  | { kind: 'no-model' } // モデル未導入 or トークン未注入(dev)
  | { kind: 'loading' } // manifest/アセット読込中
  | { kind: 'ready' } // 描画準備完了
  | { kind: 'error'; message: string }; // 読込・描画に失敗

export function useCharacterScene(containerRef: RefObject<HTMLElement | null>): SceneStatus {
  const [status, setStatus] = useState<SceneStatus>({ kind: 'loading' });

  useEffect(() => {
    const bootstrap = readBootstrap();
    if (!bootstrap.token || !bootstrap.model) {
      setStatus({ kind: 'no-model' });
      return;
    }
    const { token, model, httpOrigin, wsOrigin } = bootstrap;

    let cancelled = false;
    let renderer: CharacterRenderer | null = null;
    let socket: EmotionSocket | null = null;

    const assetBaseUrl = `${httpOrigin}/models/${model.installedDir}`;

    void (async () => {
      try {
        const manifest = await loadManifest(assetBaseUrl, model.mappingFile, token);
        const el = containerRef.current;
        if (cancelled || !el) {
          return;
        }
        renderer = await createRenderer(manifest, {
          assetBaseUrl,
          token,
          onReady: () => {
            if (!cancelled) {
              setStatus({ kind: 'ready' });
            }
          },
          onError: (err) => {
            if (!cancelled) {
              setStatus({ kind: 'error', message: errorMessage(err) });
            }
          },
        });
        if (cancelled) {
          renderer.destroy();
          renderer = null;
          return;
        }
        renderer.mount(el);

        // WSで届く解決済み状態を renderer.setState へそのまま流す(EmotionEngineが権威)。
        socket = new EmotionSocket({
          wsBaseUrl: wsOrigin,
          token,
          onSnapshot: (snapshot) => renderer?.setState(snapshot.state),
        });
        socket.connect();
      } catch (err) {
        if (!cancelled) {
          setStatus({ kind: 'error', message: errorMessage(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
      socket?.close();
      renderer?.destroy();
    };
  }, [containerRef]);

  return status;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
