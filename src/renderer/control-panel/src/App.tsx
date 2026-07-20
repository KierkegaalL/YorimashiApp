/**
 * Control Panel ウィンドウのシェル(FR-15 会話ペイン + FR-7 Control Panel の2ペイン構成)。
 * UIの正: docs/mockups/control-panel.jsx。
 *
 * この移植(#6)の範囲は **FR-15 会話ペインと、それを載せる2ペインのシェル** まで。
 *  - 会話ペイン(左・常時表示・畳めない) … ConversationPane(本コミットで移植)
 *  - Control Panel(右・6タブ・FR-7) … タブバーの骨組みのみ置き、各タブの中身は
 *    機能実装タスクで移植する(モード=#8 / ログ=#11 / 権利=#13 等)。#6=FR-15 の範囲外のため、
 *    偽のモデル一覧・ログ・生成パイプラインをここで捏造しない(constraints.md「嘘をつかない」)。
 *  - 折りたたみ(#7で完了): レンダラーはControl Panelペインの表示/非表示を切り替えるだけで、
 *    **ウィンドウ自体の 976px⇄576px の縮小は Main が BrowserWindow.setBounds() で行う**
 *    (chat-pane.md 論点1)。config.general.controlPanelCollapsed への保存も Main 側。
 *    初期値は preload が起動引数から同期的に読む(controlPanel.initialCollapsed)。
 *
 * モックアップとの意図的な差分(理由を明記): モックアップは**ブラウザpage内デモ**のため最外殻を
 * 中央寄せの 976px 固定カード + width アニメーションで「ウィンドウ縮小」を模した。実アプリでは
 * このレンダラーは BrowserWindow を丸ごと占めるので、シェルは viewport 全体(100vw×100vh)を満たし、
 * 総幅はウィンドウ側(#7)が決める。ここでは中央寄せカード/幅アニメーションは持ち込まない。
 *
 * フォント: モックアップの Google Fonts `@import` は**持ち込まない**。外部リクエストは
 * プライバシー方針(テレメトリ・外部通信をしない)に反し、ローカル同梱は既知の未決 C2(ローカルサーバー)。
 * font-family 指定は残し、未同梱の間は serif/sans/monospace にフォールバックする。
 */

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { THEMES, ThemeProvider } from './theme';
import { ConversationPane } from './ConversationPane';
import { ControlPanelTabs } from './ControlPanelTabs';
import type { TabId } from './catalog';
import type { AdapterMode, ChatMode } from './types';

export function App(): React.JSX.Element {
  // テーマは当面 OS の配色設定に追従する(system)。ライト/ダークの**手動切替は FR-7 設定タブ**の
  // 機能なので #6(FR-15) の範囲外。設定タブ移植時に config.general.themeMode を読んで
  // resolvedThemeName を上書きできるようにする。
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mq.matches);
    const handler = (e: MediaQueryListEvent): void => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme = THEMES[systemPrefersDark ? 'dark' : 'light'];

  // 折りたたみ状態(FR-15/C-21)。既定は展開(false)。
  // **ウィンドウ幅(976⇄576px)の実変更は Main が行う**(chat-pane.md 論点1: 内部レイアウトの
  // 再フローではなくBrowserWindow自体を縮小する)。ここは Main の状態を映すミラー。
  // 初期値は preload が起動引数から同期的に読んだ保存値を使う(IPCで非同期に読むと、Mainが
  // 既に576pxで生成したウィンドウに展開レイアウトが一瞬描かれるため)。preload が無い環境
  // (ブラウザでの検証等)では展開(false)から始まる。
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(
    () => (typeof window !== 'undefined' ? window.yorimashi?.controlPanel.initialCollapsed : false) ?? false,
  );

  /** 折りたたみを切り替える。Rendererの表示とMainのウィンドウ幅を同じ値で更新する。 */
  const toggleControlPanel = (next: boolean): void => {
    setControlPanelCollapsed(next);
    window.yorimashi?.controlPanel.setCollapsed(next);
  };
  // アダプタ(FR-1)と Chat モード(C-08 既定 mock)。会話ペインと(将来の)モードタブで共有する。
  const [adapterMode, setAdapterMode] = useState<AdapterMode>('code');
  const [chatMode, setChatMode] = useState<ChatMode>('mock');
  // 選択中タブは App が保持する(モックアップと同様。L251)。折りたたみで ControlPanelTabs が
  // アンマウントされても選択タブが 'home' にリセットされないようにするため親に置く。
  const [tab, setTab] = useState<TabId>('home');

  return (
    <ThemeProvider value={theme}>
      <style>{`
        * { box-sizing: border-box; }
        html, body, #root { margin: 0; height: 100%; }
        body { background: ${theme.bgBase}; transition: background 0.25s ease; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${theme.line}; border-radius: 3px; }
        input:focus, button:focus-visible, textarea:focus { outline: 2px solid ${theme.accent}; outline-offset: 1px; }
        @keyframes breathe {
          0%, 100% { opacity: 0.4; transform: scale(0.96); }
          50% { opacity: 0.8; transform: scale(1.04); }
        }
        @keyframes seal-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes seal-spin-reverse { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        input[type=range] { -webkit-appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-runnable-track {
          height: 4px; border-radius: 2px; background: ${theme.sliderTrack};
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; margin-top: -6px; width: 16px; height: 16px;
          border-radius: 50%; background: ${theme.accent}; border: 2px solid ${theme.bgBase};
        }
      `}</style>

      {/* 2ペインのシェル。viewport 全体を満たす(総幅はウィンドウ側=#7が決める)。 */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100vh',
          background: theme.bgBase,
          overflow: 'hidden',
        }}
      >
        {/* ══ 会話ペイン(FR-15)。常時表示・畳めない ══ */}
        <ConversationPane
          mood="idle"
          adapterMode={adapterMode}
          chatMode={chatMode}
          onSetChatMode={setChatMode}
          onSetAdapterMode={setAdapterMode}
          onExpandControlPanel={() => toggleControlPanel(false)}
        />

        {/* ══ 折りたたみタブ: Control Panel(設定画面)側のみ折りたたみ可(2026-07-18仕様変更) ══ */}
        <button
          onClick={() => toggleControlPanel(!controlPanelCollapsed)}
          aria-label={controlPanelCollapsed ? '設定画面を開く' : '設定画面を畳む'}
          title={controlPanelCollapsed ? '設定画面を開く' : '設定画面を畳む'}
          style={{
            width: 16,
            flexShrink: 0,
            border: 'none',
            borderLeft: `1px solid ${theme.line}`,
            background: theme.bgRaised,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {controlPanelCollapsed ? (
            <ChevronLeft size={12} color={theme.iconInactive} />
          ) : (
            <ChevronRight size={12} color={theme.iconInactive} />
          )}
        </button>

        {/* ══ Control Panel(6タブ・FR-7)。既定で展開。タブバーの骨組みのみ。中身は後続タスクで移植 ══ */}
        {!controlPanelCollapsed && <ControlPanelTabs tab={tab} onSelectTab={setTab} />}
      </div>
    </ThemeProvider>
  );
}
