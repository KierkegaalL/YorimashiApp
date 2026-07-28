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
 * フォント: モックアップの Google Fonts `@import` は持ち込まない(外部リクエストはプライバシー
 * 方針(テレメトリ・外部通信をしない)に反するため)。代わりに `@fontsource` パッケージで
 * ローカル同梱している(未決事項C2決着・2026-07-28。`main.tsx` が読み込む `fonts.css` 参照)。
 * font-family 指定は本番でも実際に解決される(serif/sans/monospaceへのフォールバックは発生しない)。
 */

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { THEMES, ThemeProvider } from './theme';
import { ConversationPane } from './ConversationPane';
import { ControlPanelTabs } from './ControlPanelTabs';
import { Onboarding } from './Onboarding';
import type { TabId } from './catalog';
import type { AdapterMode, ChatMode } from './types';
import type { MoodState } from '../../../shared/emotions';

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
  // アダプタ(FR-1)と Chat モード(C-08 既定 mock)。
  // **正本は config(Main)**。ここはその写しで、変更要求もMainへ送って結果を受け取る
  // (Renderer内で完結させると「UI上はmockなのに実際はrealへ送る」食い違いが起きる)。
  // Tray からの activeAdapter 切替にも onConfigChanged で追従する。
  const [adapterMode, setAdapterMode] = useState<AdapterMode>('code');
  const [chatMode, setChatMode] = useState<ChatMode>('mock');
  // real時の応答モデル(C-23)。**正本は config(Main)**。/model コマンドやフッターのモデル
  // チップがローカルstateだけを回すと、選んだつもりのモデルと実際にAPIへ送るモデルがずれる
  // (reviewer #12 1周目 指摘1・重大)。
  const [responseModel, setResponseModel] = useState('claude-sonnet-5');

  useEffect(() => {
    const api = window.yorimashi?.chat;
    if (!api) {
      return;
    }
    let cancelled = false;
    const apply = (snapshot: {
      activeAdapter: AdapterMode;
      chatMode: ChatMode;
      model: string;
    }): void => {
      setAdapterMode(snapshot.activeAdapter);
      setChatMode(snapshot.chatMode);
      setResponseModel(snapshot.model);
    };
    void api.getConfig().then((snapshot) => {
      if (!cancelled) {
        apply(snapshot);
      }
    });
    const unsubscribe = api.onConfigChanged(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /** モード変更はMainへ委譲する(configが正本。反映は onConfigChanged で戻ってくる)。 */
  const requestChatMode = (mode: ChatMode): void => {
    window.yorimashi?.chat.setConfig({ chatMode: mode });
  };
  const requestAdapterMode = (mode: AdapterMode): void => {
    window.yorimashi?.chat.setConfig({ activeAdapter: mode });
  };
  const requestResponseModel = (model: string): void => {
    window.yorimashi?.chat.setConfig({ model });
  };
  // 選択中タブは App が保持する(モックアップと同様。L251)。折りたたみで ControlPanelTabs が
  // アンマウントされても選択タブが 'home' にリセットされないようにするため親に置く。
  const [tab, setTab] = useState<TabId>('home');

  // オンボーディング(FR-14)。**未完了のときだけ**このウィンドウ全面に被せる
  // (別ウィンドウにしない。完了時にホームタブへ遷移する決定=onboarding.md 論点4 が、
  // 同一ウィンドウであることを前提にしているため)。
  // 初期値は preload が起動引数から同期的に読む(IPCだと Control Panel の中身が一瞬見える)。
  const [showOnboarding, setShowOnboarding] = useState(
    () => (typeof window !== 'undefined' ? window.yorimashi?.onboarding.pending : false) ?? false,
  );

  // 憑坐状態帯に出す Mood(FR-4)。**権威ある状態は Main の EmotionEngine** にあり、ここは
  // その写し。固定値を描くと「灯里の状態」について嘘をつくことになるため、IPCで追従する
  // (preload が無い経路では既定の idle のまま)。
  const [mood, setMood] = useState<MoodState>('idle');

  useEffect(() => {
    const api = window.yorimashi?.emotion;
    if (!api) {
      return;
    }
    let cancelled = false;
    void api.get().then((snapshot) => {
      if (!cancelled) {
        setMood(snapshot.mood);
      }
    });
    const unsubscribe = api.onChanged((snapshot) => setMood(snapshot.mood));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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
          mood={mood}
          adapterMode={adapterMode}
          chatMode={chatMode}
          responseModel={responseModel}
          onSetChatMode={requestChatMode}
          onSetAdapterMode={requestAdapterMode}
          onSetResponseModel={requestResponseModel}
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

      {/* ══ オンボーディング(FR-14)。初回起動時のみウィンドウ全面に被せる ══ */}
      {showOnboarding && (
        <Onboarding
          onFinish={() => {
            setTab('home');
            setShowOnboarding(false);
          }}
          onOpenModelTab={() => {
            // 0体のまま完了した場合の導線(onboarding.md 論点4)。設定画面を畳んでいると
            // タブを切り替えても見えないため、必ず展開してから送る。
            setTab('model');
            toggleControlPanel(false);
            setShowOnboarding(false);
          }}
          onSetAdapterMode={requestAdapterMode}
        />
      )}
    </ThemeProvider>
  );
}
