import { EMOTION_STATES, MOOD_STATES, REACTION_STATES } from '../../../shared/emotions';

/**
 * Control Panelのプレースホルダー。
 * 6タブ構成(FR-7)の実装は、デザインモックアップ(control-panel.jsx)を
 * このディレクトリへ取り込む段階で行う。
 */
export function App(): React.JSX.Element {
  return (
    <main>
      <h1>ヨリマシ.app コントロールパネル</h1>
      <p>スキャフォールド動作確認用のプレースホルダーです。</p>
      <dl>
        <dt>Electron</dt>
        <dd>{window.yorimashi.versions.electron}</dd>
        <dt>Chromium</dt>
        <dd>{window.yorimashi.versions.chrome}</dd>
        <dt>Node</dt>
        <dd>{window.yorimashi.versions.node}</dd>
        <dt>感情状態(Mood {MOOD_STATES.length} + Reaction {REACTION_STATES.length})</dt>
        <dd>{EMOTION_STATES.join(' / ')}</dd>
      </dl>
    </main>
  );
}
