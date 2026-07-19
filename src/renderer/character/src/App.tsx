import { useRef } from 'react';

import { useCharacterWindowControls } from './useCharacterWindowControls';
import { useCharacterScene, type SceneStatus } from './useCharacterScene';

/**
 * キャラクター表示ウィンドウ(FR-6/FR-5)。
 * - ウィンドウ機構(透過・最前面・クリックスルー・ドラッグ・メニュー)は #4 で配線済み。
 * - 描画(Live2D / スプライトセット)は #5: `useCharacterScene` が manifest ロード → CharacterRenderer
 *   生成 → mount → WSで感情スナップショットを購読して setState する。
 * 背景は透過(index側で transparent ウィンドウ)。描画できない状態(モデル未導入・読込失敗)は
 * 正直に小さく示す(constraints.md「自分の状態について嘘をつかない」)。
 */
export function App(): React.JSX.Element {
  // ドラッグ移動・右クリックメニュー(クリックスルーOFF時のみ発火)。#4 由来。
  useCharacterWindowControls();

  const containerRef = useRef<HTMLDivElement>(null);
  const status = useCharacterScene(containerRef);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {/* CharacterRenderer(Live2Dキャンバス / スプライト<img>)のマウント先。ウィンドウ全面。 */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {status.kind !== 'ready' && <StatusOverlay status={status} />}
    </div>
  );
}

/** 描画準備が整っていない間だけ、状態を控えめに表示する。 */
function StatusOverlay({ status }: { status: SceneStatus }): React.JSX.Element | null {
  if (status.kind === 'loading' || status.kind === 'ready') {
    return null; // 読込中は無表示(ちらつき回避)、ready はオーバーレイ不要
  }
  const text =
    status.kind === 'error'
      ? `描画エラー: ${status.message}`
      : '常世灯里 — モデル未導入';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px',
        textAlign: 'center',
        fontFamily: 'ui-monospace, monospace',
        fontSize: '12px',
        color: status.kind === 'error' ? '#ff6b6b' : '#9fb2c2',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {text}
    </div>
  );
}
