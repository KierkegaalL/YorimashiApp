import { FALLBACK_STATE } from '../../../shared/emotions';

/**
 * キャラクター表示ウィンドウのプレースホルダー。
 *
 * ビルドのエントリとしては配線済みだが、Mainプロセスからはまだ開いていない。
 * CharacterRenderer(Live2DRenderer / SpriteSetRenderer)の実装と、
 * ウィンドウの透過・最前面・初期配置(FR-6)は、
 * docs/detailed-design/character-window.md の初期配置ロジック確定後に着手する。
 */
export function App(): React.JSX.Element {
  return (
    <main>
      <p>常世灯里(未実装)</p>
      <p>初期状態: {FALLBACK_STATE}</p>
    </main>
  );
}
