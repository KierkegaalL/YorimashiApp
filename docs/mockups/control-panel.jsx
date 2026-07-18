import React, { useState, useEffect, useContext, createContext } from 'react';
import {
  Home, UserRound, ArrowLeftRight, Settings, ScrollText,
  Plus, ChevronRight, ChevronLeft, Circle, AlertTriangle, Scale, Check, Monitor,
  Layers, Image, Upload, ImagePlus, Copy, CheckCircle2, Sparkles, Trash2,
  Terminal, AtSign, Paperclip, Send, Square, RotateCcw, ExternalLink
} from 'lucide-react';

/* ============================================================
   トークン定義 ── アプリ「ヨリマシ.app」/ 憑坐キャラクター「常世灯里」
   ------------------------------------------------------------
   将来「配色テーマ」をユーザーが切り替えられるようにする前提で、
   全ての色をTHEMESオブジェクトに集約(直書きhexは持たない)。
   現時点では以下2案を実装:
     - light「白望(はくぼう)」: 白和紙・お札のような明るいトーン
     - dark 「漆黒(しっこく)」: 電脳オカルト×HUDの暗いトーン

   Type(テーマ共通・固定)
     Display : "Zen Antique"    見出し・状態ラベル (古札・巻物のような筆致)
     UI      : "M PLUS 1 Code"  本文・操作要素 (端末画面のようなグリッド感)
     Mono    : "JetBrains Mono" 数値・ポート・ログ (技術情報)

   Signature(テーマ共通・固定)
     状態帯の背後でゆっくり回転する「呪紋(魔法陣)」のリングと、
     四隅を切り取るHUD風の焦点ブラケット。Moodに応じて霊力の色・
     回転速度が変わり、「常世灯里」という憑坐(よりまし)に今どれだけ
     霊力が満ちているかを一目で伝える。配色テーマが変わっても
     この構造・モーションは変化しない。
   ============================================================ */

const THEMES = {
  light: {
    label: '白望(はくぼう)',
    swatchBg: '#F5F3FA', swatchAccent: '#7C4FE0',
    bgBase: '#F5F3FA', bgPanel: '#FFFFFF', bgRaised: '#EFEBF9', line: '#E3DEF2',
    accent: '#7C4FE0', accentTag: 'rgba(124,79,224,0.16)',
    mint: '#12A585', mintTag: 'rgba(18,165,133,0.14)',
    sealRed: '#C7333D', sealRedTagSoft: 'rgba(199,51,61,0.10)', sealRedTag: 'rgba(199,51,61,0.14)',
    warnText: '#A13340',
    ink: '#211C33', inkDim: '#726C8C', iconInactive: '#A39DBE',
    disabledText: '#B5AFC7', sliderTrack: '#DAD5EA', dashedBorder: '#D0CAE4',
    labelMuted: '#635E85',
    moods: {
      idle:      { label: '静穏(せいおん)', color: '#635E85', glow: '#E4DFF7', speed: 6 },
      confident: { label: '昂揚(こうよう)', color: '#7C4FE0', glow: '#D9C7FF', speed: 3.5 },
      tired:     { label: '減衰(げんすい)', color: '#8A5F6D', glow: '#F2DEE3', speed: 8 },
    },
  },
  dark: {
    label: '漆黒(しっこく)',
    swatchBg: '#0A0A12', swatchAccent: '#B58AFF',
    bgBase: '#0A0A12', bgPanel: '#15151F', bgRaised: '#1E1E2C', line: '#2B2B3D',
    accent: '#B58AFF', accentTag: 'rgba(181,138,255,0.14)',
    mint: '#5FE0C0', mintTag: 'rgba(95,224,192,0.14)',
    sealRed: '#E14B4B', sealRedTagSoft: 'rgba(225,75,75,0.12)', sealRedTag: 'rgba(225,75,75,0.14)',
    warnText: '#F0A8A8',
    ink: '#EDEAF7', inkDim: '#8B87A3', iconInactive: '#5A5770',
    disabledText: '#4A4760', sliderTrack: '#3E3B45', dashedBorder: '#3A3750',
    labelMuted: '#6F6C90',
    moods: {
      idle:      { label: '静穏(せいおん)', color: '#6F6C90', glow: '#2E2B45', speed: 6 },
      confident: { label: '昂揚(こうよう)', color: '#B58AFF', glow: '#6B4FA0', speed: 3.5 },
      tired:     { label: '減衰(げんすい)', color: '#8C6B7A', glow: '#3D2B36', speed: 8 },
    },
  },
};

const ThemeCtx = createContext(THEMES.light);
const useTheme = () => useContext(ThemeCtx);

// EmotionEngine(FR-4)が定義する全状態。Mood3種+Reaction7種=計10。
// idleのみ必須、他は未設定時にidleへフォールバックする(FR-5)。
// スプライトセット生成リストとLive2Dマッピングデモの両方で、この一覧を単一の情報源として参照する。
const EMOTION_STATES = [
  { key: 'idle',      category: 'mood',     label: 'idle(必須・待機ループ)', required: true,
    prompt: 'まばたきと呼吸だけの、ごくわずかな揺れ',   live2d: 'Idle / exp_normal' },
  { key: 'confident', category: 'mood',     label: 'confident', required: false,
    prompt: '明るく弾むような、軽い足取り',             live2d: 'TapBody / exp_smile_soft' },
  { key: 'tired',     category: 'mood',     label: 'tired', required: false,
    prompt: 'うつむき加減で、ゆっくりとした揺れ',         live2d: '— / exp_tired' },
  { key: 'thinking',  category: 'reaction', label: 'thinking', required: false,
    prompt: '首を少しかしげて考え込む',                 live2d: '— / exp_normal' },
  { key: 'happy',     category: 'reaction', label: 'happy', required: false,
    prompt: '小さく弾むように微笑む',                   live2d: 'TapBody / exp_smile' },
  { key: 'proud',     category: 'reaction', label: 'proud', required: false,
    prompt: '胸を張って誇らしげにする',                 live2d: '— / exp_proud' },
  { key: 'worried',   category: 'reaction', label: 'worried', required: false,
    prompt: '眉を下げて心配そうにする',                 live2d: '— / exp_worried' },
  { key: 'panic',     category: 'reaction', label: 'panic', required: false,
    prompt: '肩を震わせて焦る',                         live2d: '未割当' },
  { key: 'curious',   category: 'reaction', label: 'curious', required: false,
    prompt: '小首をかしげて興味深そうにする',           live2d: '— / exp_curious' },
  { key: 'sleepy',    category: 'reaction', label: 'sleepy', required: false,
    prompt: 'とろんとした目で、あくびをする',           live2d: '未割当' },
];

const TABS = [
  { id: 'home',     label: 'ホーム',   icon: Home },
  { id: 'model',    label: 'モデル',   icon: UserRound },
  { id: 'adapter',  label: 'モード',   icon: ArrowLeftRight },
  { id: 'general',  label: '設定',     icon: Settings },
  { id: 'logs',     label: 'ログ',     icon: ScrollText },
  { id: 'licenses', label: '権利',     icon: Scale },
];

// 会話ペイン(FR-15)の入力欄機能(C-23)。/コマンドは設定・アダプタ操作へのショートカット、
// @参照はユーザーが明示選択する限定的な文脈参照(agenticではない。chat-pane.md 論点7)。
const SLASH_COMMANDS = [
  { cmd: '/clear', label: '会話をクリア' },
  { cmd: '/mock', label: 'mockモードにする' },
  { cmd: '/real', label: 'realモードにする' },
  { cmd: '/code', label: 'Code Adapterへ切替' },
  { cmd: '/panel', label: '設定を開く' },
  { cmd: '/model', label: '応答モデル選択(real時のみ)' },
];
const AT_REFERENCES = [
  { key: 'logs', label: '作業ログ(直近hooks)' },
  { key: 'model', label: '表示中のモデル' },
  { key: 'settings', label: '設定' },
];
const RESPONSE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

// APIキーの手動取得手順(FR-3。chat-adapter-errors.md 論点5)。
// realへ切替えて初めてAPIキーが必要になるユーザー向けの事前案内(401等の失敗を待たずに示す)。
const API_KEY_STEPS = [
  'Anthropicアカウントでログイン(未登録ならこの画面から新規登録)',
  '左メニューの「API Keys」→「Create Key」を選ぶ',
  '発行された sk-ant- から始まるキーをコピーする',
  '上の「APIキー」欄に貼り付ける',
];

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Zen+Antique&family=M+PLUS+1+Code:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap');`;

function Switch({ checked, onChange, warn }) {
  const t = useTheme();
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 999, position: 'relative',
        border: 'none', cursor: 'pointer', flexShrink: 0,
        background: checked ? (warn ? t.sealRed : t.accent) : t.sliderTrack,
        transition: 'background 0.2s ease',
      }}
      aria-pressed={checked}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 20, height: 20, borderRadius: '50%', background: t.ink,
        transition: 'left 0.2s ease',
      }} />
    </button>
  );
}

function Section({ title, children, hint }) {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 700,
        letterSpacing: '0.08em', color: t.inkDim, textTransform: 'uppercase',
        marginBottom: 10, paddingLeft: 2,
      }}>
        <span style={{ display: 'inline-block', width: 3, height: 11, background: t.sealRed, opacity: 0.7 }} />
        {title}
      </div>
      <div style={{
        background: t.bgPanel, border: `1px solid ${t.line}`, borderRadius: 14,
        overflow: 'hidden',
      }}>
        {children}
      </div>
      {hint && (
        <div style={{
          fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: t.inkDim,
          marginTop: 8, paddingLeft: 2, lineHeight: 1.6,
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function Row({ label, sub, children, last }) {
  const t = useTheme();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px', borderBottom: last ? 'none' : `1px solid ${t.line}`, gap: 12,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 14, color: t.ink, fontWeight: 500 }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: t.inkDim, marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, disabled, mono }) {
  const t = useTheme();
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        background: disabled ? t.bgPanel : t.bgRaised,
        border: `1px solid ${t.line}`, borderRadius: 8, padding: '7px 10px',
        color: disabled ? t.disabledText : t.ink, fontSize: 13, width: 140,
        fontFamily: mono ? "'JetBrains Mono', monospace" : "'M PLUS 1 Code', sans-serif",
        outline: 'none',
      }}
    />
  );
}

export default function ControlPanel() {
  // themeMode: 'light' | 'dark' | 'system'。system選択時はOSの配色設定に追従する。
  const [themeMode, setThemeMode] = useState('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mq.matches);
    const handler = (e) => setSystemPrefersDark(e.matches);
    mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler);
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler);
    };
  }, []);

  const resolvedThemeName = themeMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeMode;
  const theme = THEMES[resolvedThemeName];

  const [tab, setTab] = useState('home');
  const [mood] = useState('idle');
  const [adapterMode, setAdapterMode] = useState('code');
  const [chatMode, setChatMode] = useState('mock');
  const [clickThrough, setClickThrough] = useState(true);
  const [autostart, setAutostart] = useState(true);
  const [displaySize, setDisplaySize] = useState(50);

  // 会話ペイン(FR-15)。折りたたみ対象はControl Panel側(config.general.controlPanelCollapsed。2026-07-18仕様変更)。
  // 折りたたむとウィンドウ全体が会話ペインの幅まで縮小する(chat-pane.md 論点1)。
  const [controlPanelCollapsed, setControlPanelCollapsed] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { id: 1, role: 'user', text: 'さっきのビルドエラー、直った?' },
    { id: 2, role: 'assistant', text: 'はい、型エラーの原因だった設定項目の参照を直しました。typecheckも通っています。' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [responseModel, setResponseModel] = useState('claude-sonnet-5');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [atMenuOpen, setAtMenuOpen] = useState(false);

  // mockは固定返答を返すだけ(C-08)。realはAnthropic APIのstreamingになるが、モックアップでは擬似的に1往復のみ再現する。
  useEffect(() => {
    if (!chatSending) return;
    const timer = setTimeout(() => {
      setChatMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        text: chatMode === 'real'
          ? '(real接続のデモ表示: 実際の応答はAnthropic APIから届きます)'
          : 'なるほど、了解です。今のところ順調に進んでいますよ。',
      }]);
      setChatSending(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [chatSending, chatMode]);

  const handleChatSend = () => {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatMessages(prev => [...prev, { id: Date.now(), role: 'user', text }]);
    setChatInput('');
    setChatSending(true);
  };

  // 中断時も成功・失敗と同様に感情の後始末(release('thinking'))を行う想定のデモ(chat-pane.md 論点3)。
  const handleChatStop = () => setChatSending(false);

  // 応答モデルを次の候補へ循環させる(real時のみ意味を持つ。C-23)。
  // スラッシュコマンド(/model)と入力欄フッターのモデルチップの両方から呼ぶ。
  const cycleResponseModel = () => {
    setResponseModel(prev => {
      const i = RESPONSE_MODELS.findIndex(mm => mm.id === prev);
      return RESPONSE_MODELS[(i + 1) % RESPONSE_MODELS.length].id;
    });
  };

  const runSlashCommand = (cmd) => {
    if (cmd === '/clear') setChatMessages([]);
    if (cmd === '/mock') setChatMode('mock');
    if (cmd === '/real') setChatMode('real');
    if (cmd === '/code') setAdapterMode('code');
    if (cmd === '/panel') setControlPanelCollapsed(false);
    if (cmd === '/model' && chatMode === 'real') cycleResponseModel();
    setSlashMenuOpen(false);
  };

  const insertAtReference = (ref) => {
    setChatInput(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${ref.label} `);
    setAtMenuOpen(false);
  };

  // モデルは最大2体。2体そろっている時だけ「モードで自動切替」を選べる。
  const [models, setModels] = useState([
    { id: 'chibi', name: 'ちびキャラ(開発用)', renderType: 'live2d', version: 'Cubism 2', assigned: 'code' },
    { id: 'sample', name: '常世灯里', renderType: 'spriteset', version: '7/10クリップ・変換済み', assigned: 'chat' },
  ]);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [manualActiveId, setManualActiveId] = useState('chibi');
  const [addFormat, setAddFormat] = useState('spriteset'); // 追加するモデルの形式選択(スプライトセットを標準の入口に)
  const [mappingTarget, setMappingTarget] = useState('chibi'); // マッピング編集対象のモデルID
  const [deleteConfirmId, setDeleteConfirmId] = useState(null); // 削除確認中のモデルID

  const emptySpritesetDraft = () => ({
    imageUploaded: false,
    clips: Object.fromEntries(
      EMOTION_STATES.map(s => [s.key, { label: s.label, prompt: s.prompt, status: 'pending' }])
    ),
  });

  // スプライトセット新規追加のドラフト状態(画像1枚→AIでモーション生成、をシミュレート)
  const [spritesetDraft, setSpritesetDraft] = useState(emptySpritesetDraft());

  const deleteModel = (id) => {
    setModels(prev => {
      const next = prev.filter(mm => mm.id !== id);
      if (manualActiveId === id) setManualActiveId(next[0]?.id ?? null);
      if (mappingTarget === id) setMappingTarget(next[0]?.id ?? null);
      return next;
    });
    setDeleteConfirmId(null);
  };

  const confirmAddSpritesetModel = () => {
    const doneCount = Object.values(spritesetDraft.clips).filter(c => c.status === 'done').length;
    const newModel = {
      id: `model-${Date.now()}`,
      name: '新しいモデル',
      renderType: 'spriteset',
      version: `${doneCount}/${EMOTION_STATES.length}クリップ・変換済み`,
      assigned: models.length === 1 ? (models[0].assigned === 'code' ? 'chat' : 'code') : 'code',
    };
    setModels(prev => [...prev, newModel]);
    setSpritesetDraft(emptySpritesetDraft());
  };

  const m = theme.moods[mood];

  const swapAssignment = () => {
    setModels(prev => prev.map(mm => ({ ...mm, assigned: mm.assigned === 'code' ? 'chat' : 'code' })));
  };

  const activeModel = models.length === 2
    ? (autoSwitch ? models.find(mm => mm.assigned === adapterMode) : models.find(mm => mm.id === manualActiveId))
    : models[0];

  return (
    <ThemeCtx.Provider value={theme}>
    <div style={{
      width: '100%', minHeight: '100vh', background: theme.bgBase,
      display: 'flex', justifyContent: 'center', alignItems: 'flex-start', transition: 'background 0.25s ease',
    }}>
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${theme.line}; border-radius: 3px; }
        input:focus, button:focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 1px; }
        @keyframes breathe {
          0%, 100% { opacity: 0.4; transform: scale(0.96); }
          50% { opacity: 0.8; transform: scale(1.04); }
        }
        @keyframes seal-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes seal-spin-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        input[type=range] { -webkit-appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-runnable-track {
          height: 4px; border-radius: 2px; background: ${theme.sliderTrack};
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; margin-top: -6px; width: 16px; height: 16px;
          border-radius: 50%; background: ${theme.accent}; border: 2px solid ${theme.bgBase};
        }
      `}</style>

      {/* Control Panelウィンドウ本体(1つ)。折りたたみ時はウィンドウ全体が会話ペイン幅まで縮小する
          (config.general.controlPanelCollapsed。2026-07-18仕様変更・chat-pane.md 論点1) */}
      <div style={{
        display: 'flex', width: controlPanelCollapsed ? 576 : 976,
        marginTop: 24, background: theme.bgBase, border: `1px solid ${theme.line}`,
        borderRadius: 16, overflow: 'hidden', transition: 'width 0.25s ease',
      }}>

        {/* ══ 会話ペイン(FR-15)。常時表示・折りたためない（2026-07-18仕様変更） ══ */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          borderRight: `1px solid ${theme.line}`,
        }}>

        {/* ── 憑坐状態帯 ───────────────────────────── */}
        <div style={{
          position: 'relative', padding: '18px 18px 16px', overflow: 'hidden',
          borderBottom: `1px solid ${theme.line}`, background: theme.bgBase,
        }}>
          {/* 背景の残光ブルーム */}
          <div style={{
            position: 'absolute', top: -40, left: -20, width: 160, height: 160,
            borderRadius: '50%', background: m.glow, filter: 'blur(36px)',
            animation: `breathe ${m.speed}s ease-in-out infinite`,
          }} />

          {/* 極小ワードマーク */}
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.18em',
            color: theme.iconInactive, marginBottom: 10, textTransform: 'uppercase',
          }}>
            ヨリマシ.app
          </div>

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* 呪紋リング + HUDブラケット + アバター */}
            <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
              <svg viewBox="0 0 60 60" style={{
                position: 'absolute', inset: 0, animation: `seal-spin ${m.speed * 3}s linear infinite`,
              }}>
                <circle cx="30" cy="30" r="27" fill="none" stroke={m.color} strokeWidth="1"
                  strokeDasharray="3 5" opacity="0.7" />
              </svg>
              <svg viewBox="0 0 60 60" style={{
                position: 'absolute', inset: 0, animation: `seal-spin-reverse ${m.speed * 4.5}s linear infinite`,
              }}>
                <circle cx="30" cy="30" r="22" fill="none" stroke={m.color} strokeWidth="0.75"
                  opacity="0.35" />
              </svg>
              {/* HUD四隅ブラケット */}
              {[
                { top: -3, left: -3, borderWidth: '2px 0 0 2px' },
                { top: -3, right: -3, borderWidth: '2px 2px 0 0' },
                { bottom: -3, left: -3, borderWidth: '0 0 2px 2px' },
                { bottom: -3, right: -3, borderWidth: '0 2px 2px 0' },
              ].map((pos, i) => (
                <div key={i} style={{
                  position: 'absolute', width: 12, height: 12, borderColor: m.color,
                  borderStyle: 'solid', ...pos,
                }} />
              ))}
              <div style={{
                position: 'absolute', inset: 8, borderRadius: '50%', background: theme.bgRaised,
                border: `1.5px solid ${m.color}`, display: 'flex', alignItems: 'center',
                justifyContent: 'center',
              }}>
                <UserRound size={20} color={m.color} strokeWidth={1.6} />
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: theme.labelMuted,
                letterSpacing: '0.06em', marginBottom: 2,
              }}>
                憑坐: 常世灯里(とこよ あかり)
              </div>
              <div style={{
                fontFamily: "'Zen Antique', serif", fontSize: 19, fontWeight: 400,
                color: theme.ink, lineHeight: 1.3,
              }}>
                霊力状態 ── {m.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Circle size={7} fill={m.color} color={m.color} />
                <span style={{
                  fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.inkDim,
                }}>
                  {adapterMode === 'code' ? 'Code Adapter・待機中' : 'Chat Adapter・待機中'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 会話履歴(メモリのみ・streaming表示。C-22) ───────────────────────────── */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto', padding: 16,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {chatMessages.map(msg => (
            <div key={msg.id} style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '85%', padding: '9px 13px', borderRadius: 14,
                background: msg.role === 'user' ? theme.accentTag : theme.bgRaised,
                border: `1px solid ${msg.role === 'user' ? theme.accent : theme.line}`,
                color: theme.ink, fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              }}>
                {msg.text}
              </div>
              {msg.role === 'assistant' && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button title="コピー" style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: theme.iconInactive, display: 'flex',
                  }}>
                    <Copy size={12} />
                  </button>
                  <button title="再生成" style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: theme.iconInactive, display: 'flex',
                  }}>
                    <RotateCcw size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {chatSending && (
            <div style={{
              alignSelf: 'flex-start', fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 12, color: theme.inkDim,
            }}>
              灯里が考えています…
            </div>
          )}
        </div>

        {/* ── 入力欄(C-23。スラッシュ/@参照/添付/応答モデル選択/停止/コンテキスト表示/入力ヒント) ── */}
        <div style={{ position: 'relative', borderTop: `1px solid ${theme.line}`, padding: '10px 14px 14px' }}>

          {/* コンテキスト使用量表示: real時のみ実測。mockは実測値を持たないため表示しない(嘘をつかない) */}
          {chatMode === 'real' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: theme.sliderTrack, overflow: 'hidden' }}>
                <div style={{ width: '42%', height: '100%', background: theme.mint }} />
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: theme.inkDim }}>
                42%
              </span>
            </div>
          )}

          {slashMenuOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 14, right: 14, marginBottom: 6,
              background: theme.bgPanel, border: `1px solid ${theme.line}`, borderRadius: 10,
              overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
            }}>
              {SLASH_COMMANDS.map(c => {
                const disabled = c.cmd === '/model' && chatMode !== 'real';
                return (
                  <button
                    key={c.cmd}
                    disabled={disabled}
                    onClick={() => runSlashCommand(c.cmd)}
                    style={{
                      width: '100%', display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
                      background: 'none', border: 'none', textAlign: 'left',
                      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: theme.accent, minWidth: 52 }}>
                      {c.cmd}
                    </span>
                    <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.inkDim }}>
                      {c.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {atMenuOpen && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 14, marginBottom: 6, minWidth: 190,
              background: theme.bgPanel, border: `1px solid ${theme.line}`, borderRadius: 10,
              overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
            }}>
              {AT_REFERENCES.map(r => (
                <button
                  key={r.key}
                  onClick={() => insertAtReference(r)}
                  style={{
                    width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                    textAlign: 'left', cursor: 'pointer', fontFamily: "'M PLUS 1 Code', sans-serif",
                    fontSize: 12, color: theme.ink,
                  }}
                >
                  @{r.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
              placeholder="灯里に話しかける…"
              rows={1}
              style={{
                flex: 1, resize: 'none', background: theme.bgRaised, border: `1px solid ${theme.line}`,
                borderRadius: 10, padding: '8px 10px', color: theme.ink,
                fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 13, outline: 'none', maxHeight: 80,
              }}
            />
            <button
              onClick={chatSending ? handleChatStop : handleChatSend}
              aria-label={chatSending ? '応答を中断' : '送信'}
              style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: chatSending ? theme.sealRed : theme.accent, color: theme.bgPanel,
              }}
            >
              {chatSending ? <Square size={13} fill="currentColor" /> : <Send size={14} />}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setSlashMenuOpen(v => !v); setAtMenuOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3, background: 'transparent',
                  border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                  color: theme.inkDim, fontSize: 11, cursor: 'pointer',
                }}
              >
                <Terminal size={12} /> /
              </button>
              <button
                onClick={() => { setAtMenuOpen(v => !v); setSlashMenuOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3, background: 'transparent',
                  border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                  color: theme.inkDim, fontSize: 11, cursor: 'pointer',
                }}
              >
                <AtSign size={12} /> 参照
              </button>
              <button
                disabled={chatMode !== 'real'}
                title={chatMode !== 'real' ? 'real接続時のみ使えます' : '画像・ファイルを添付'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3, background: 'transparent',
                  border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                  color: theme.inkDim, fontSize: 11,
                  cursor: chatMode !== 'real' ? 'not-allowed' : 'pointer',
                  opacity: chatMode !== 'real' ? 0.45 : 1,
                }}
              >
                <Paperclip size={12} />
              </button>
              <button
                disabled={chatMode !== 'real'}
                onClick={cycleResponseModel}
                title={chatMode !== 'real' ? 'real接続時のみ選択できます(mockは固定返答・C-08)' : '応答モデルを切替'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3, background: 'transparent',
                  border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                  color: theme.inkDim, fontSize: 11,
                  cursor: chatMode !== 'real' ? 'not-allowed' : 'pointer',
                  opacity: chatMode !== 'real' ? 0.45 : 1,
                }}
              >
                {RESPONSE_MODELS.find(mm => mm.id === responseModel)?.label}
              </button>
            </div>
            <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 10, color: theme.iconInactive }}>
              Enter送信 / Shift+Enter改行
            </span>
          </div>
        </div>
        </div>

        {/* ══ 折りたたみタブ: Control Panel(設定画面)側のみ折りたたみ可能(2026-07-18仕様変更・chat-pane.md 論点1) ══ */}
        <button
          onClick={() => setControlPanelCollapsed(v => !v)}
          aria-label={controlPanelCollapsed ? '設定画面を開く' : '設定画面を畳む'}
          title={controlPanelCollapsed ? '設定画面を開く' : '設定画面を畳む'}
          style={{
            width: 16, flexShrink: 0, border: 'none', borderLeft: `1px solid ${theme.line}`,
            background: theme.bgRaised, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {controlPanelCollapsed
            ? <ChevronLeft size={12} color={theme.iconInactive} />
            : <ChevronRight size={12} color={theme.iconInactive} />}
        </button>

        {/* ══ Control Panel(6タブ)。既定で展開、縁のタブで折りたたみ可能 ══ */}
        {!controlPanelCollapsed && (
        <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>

        {/* ── タブバー ───────────────────────────── */}
        <div style={{
          display: 'flex', borderBottom: `1px solid ${theme.line}`, background: theme.bgBase,
        }}>
          {TABS.map(t => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  flex: 1, background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 4px 9px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4,
                  borderBottom: active ? `2px solid ${theme.accent}` : '2px solid transparent',
                }}
              >
                <Icon size={17} color={active ? theme.accent : theme.iconInactive} strokeWidth={1.8} />
                <span style={{
                  fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 10.5,
                  color: active ? theme.ink : theme.iconInactive, fontWeight: active ? 700 : 500,
                }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── コンテンツ領域 ───────────────────────────── */}
        <div style={{ padding: '20px 16px 40px' }}>

          {tab === 'home' && (
            <>
              <Section title="現在のモード">
                <Row label="使用中のアダプタ" sub={adapterMode === 'code' ? 'Claude Code の作業を実況します' : '独自チャットで会話します'}>
                  <button
                    onClick={() => setAdapterMode(adapterMode === 'code' ? 'chat' : 'code')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, background: theme.bgRaised,
                      border: `1px solid ${theme.line}`, borderRadius: 999, padding: '6px 12px',
                      color: theme.ink, fontFamily: "'M PLUS 1 Code', sans-serif",
                      fontSize: 12.5, cursor: 'pointer',
                    }}
                  >
                    {adapterMode === 'code' ? 'Code' : 'Chat'}
                    <ArrowLeftRight size={13} />
                  </button>
                </Row>
              </Section>

              <Section title="Code Adapter の状態" hint="hooks からの通知をここで受け取っています。">
                <Row label="接続ポート" last={false}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: theme.mint }}>
                    :8765 ● 待受中
                  </span>
                </Row>
                <Row label="直近のイベント" last>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: theme.inkDim }}>
                    2分前・PostToolUse
                  </span>
                </Row>
              </Section>

              <Section title="表示中のモデル">
                <Row
                  label={activeModel?.name ?? '未設定'}
                  sub={
                    models.length === 2 && autoSwitch
                      ? `${adapterMode === 'code' ? 'Code' : 'Chat'} Adapter 用に自動表示中`
                      : `${activeModel?.version ?? ''} ・ クリックスルー有効`
                  }
                  last
                >
                  <ChevronRight size={16} color={theme.iconInactive} />
                </Row>
              </Section>
            </>
          )}

          {tab === 'model' && (
            <>
              <Section title={`セット中のモデル(${models.length}/2)`}>
                {models.map((mm, i) => {
                  const isActive = models.length === 2
                    ? (autoSwitch ? mm.assigned === adapterMode : mm.id === manualActiveId)
                    : true;
                  const FormatIcon = mm.renderType === 'live2d' ? Layers : Image;
                  const formatLabel = mm.renderType === 'live2d' ? 'Live2D' : 'スプライトセット';
                  const formatColor = mm.renderType === 'live2d' ? theme.accent : theme.mint;
                  const formatTag = mm.renderType === 'live2d' ? theme.accentTag : theme.mintTag;
                  return (
                    <Row
                      key={mm.id}
                      label={mm.name}
                      sub={
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span style={{
                            display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700,
                            color: formatColor, background: formatTag, borderRadius: 999, padding: '1px 7px 1px 5px',
                          }}>
                            <FormatIcon size={10} /> {formatLabel}
                          </span>
                          <span style={{ fontSize: 12, color: theme.inkDim }}>
                            {mm.version}{models.length < 2 ? ' ・ 使用中' : ''}
                          </span>
                        </span>
                      }
                      last={i === models.length - 1}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {models.length === 2 && autoSwitch && (
                          <span style={{
                            fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 700,
                            padding: '3px 9px', borderRadius: 999, color: theme.accent,
                            background: theme.accentTag, whiteSpace: 'nowrap',
                          }}>
                            {mm.assigned === 'code' ? 'Code 用' : 'Chat 用'}
                          </span>
                        )}
                        {models.length === 2 && !autoSwitch && (
                          <button
                            onClick={() => setManualActiveId(mm.id)}
                            style={{
                              width: 18, height: 18, borderRadius: '50%', cursor: 'pointer',
                              border: `2px solid ${isActive ? theme.accent : theme.dashedBorder}`,
                              background: isActive ? theme.accent : 'transparent',
                              flexShrink: 0,
                            }}
                            aria-label="このモデルを使用中にする"
                          />
                        )}
                        {models.length === 1 && <Circle size={9} fill={theme.accent} color={theme.accent} />}
                        {deleteConfirmId === mm.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              onClick={() => deleteModel(mm.id)}
                              style={{
                                fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 700,
                                color: theme.bgPanel, background: theme.sealRed, border: 'none',
                                borderRadius: 999, padding: '4px 9px', cursor: 'pointer',
                              }}
                            >
                              削除する
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              style={{
                                fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11,
                                color: theme.inkDim, background: 'transparent', border: `1px solid ${theme.line}`,
                                borderRadius: 999, padding: '4px 9px', cursor: 'pointer',
                              }}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(mm.id)}
                            aria-label={`${mm.name}を削除`}
                            style={{
                              background: 'transparent', border: 'none', cursor: 'pointer',
                              padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0,
                            }}
                          >
                            <Trash2 size={14} color={theme.iconInactive} />
                          </button>
                        )}
                      </div>
                    </Row>
                  );
                })}
                {models.length < 2 && (
                  <Row label="空きスロット" sub={models.length === 0 ? '空きスロットが2つあります' : 'モデルはあと1体セットできます'} last>
                    <Plus size={15} color={theme.iconInactive} />
                  </Row>
                )}
              </Section>

              {models.length === 2 && (
                <Section title="モードによる自動切替" hint={
                  autoSwitch
                    ? '今、Code Adapter とChat Adapterそれぞれに1体ずつ割り当てています。「入れ替える」で対応を逆にできます。'
                    : 'オフの間は、上で選んだモデルがモードに関わらずずっと表示されます。'
                }>
                  <Row label="モードでモデルを切り替える" sub="2体セットしている時だけ使えます">
                    <Switch checked={autoSwitch} onChange={setAutoSwitch} />
                  </Row>
                  {autoSwitch && (
                    <Row label="Code / Chat の対応を入れ替える" last>
                      <button
                        onClick={swapAssignment}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, background: theme.bgRaised,
                          border: `1px solid ${theme.line}`, borderRadius: 999, padding: '6px 12px',
                          color: theme.ink, fontFamily: "'M PLUS 1 Code', sans-serif",
                          fontSize: 12, cursor: 'pointer',
                        }}
                      >
                        <ArrowLeftRight size={13} /> 入れ替える
                      </button>
                    </Row>
                  )}
                </Section>
              )}

              {models.length < 2 && (
                <Section title="追加するモデルの形式" hint="迷ったら「スプライトセット」がおすすめです。画像1枚から始められます。">
                  <div style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
                    {[
                      { key: 'spriteset', label: 'スプライトセット', icon: Image, hint: '画像1枚から', badge: 'おすすめ', badgeColor: 'mint' },
                      { key: 'live2d', label: 'Live2D モデル', icon: Layers, hint: 'フォルダ / zip', badge: '上級者向け', badgeColor: 'accent' },
                    ].map(opt => {
                      const active = addFormat === opt.key;
                      const Icon = opt.icon;
                      const badgeColor = opt.badgeColor === 'mint' ? theme.mint : theme.accent;
                      const badgeTag = opt.badgeColor === 'mint' ? theme.mintTag : theme.accentTag;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => setAddFormat(opt.key)}
                          style={{
                            flex: 1, cursor: 'pointer', borderRadius: 12, padding: '10px 8px',
                            border: active ? `2px solid ${theme.accent}` : `1px solid ${theme.line}`,
                            background: active ? theme.accentTag : 'transparent',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                            position: 'relative',
                          }}
                        >
                          <span style={{
                            position: 'absolute', top: -8, fontSize: 9.5, fontWeight: 700,
                            color: badgeColor, background: badgeTag, borderRadius: 999, padding: '2px 7px',
                          }}>
                            {opt.badge}
                          </span>
                          <Icon size={16} color={active ? theme.accent : theme.iconInactive} style={{ marginTop: 6 }} />
                          <span style={{
                            fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11.5, fontWeight: 600,
                            color: active ? theme.ink : theme.inkDim,
                          }}>
                            {opt.label}
                          </span>
                          <span style={{ fontSize: 10, color: theme.iconInactive }}>{opt.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}


              {models.length < 2 && addFormat === 'live2d' && (
                <button style={{
                  width: '100%', padding: '16px', borderRadius: 14, cursor: 'pointer',
                  border: `1.5px dashed ${theme.dashedBorder}`, background: 'transparent',
                  color: theme.inkDim, fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <Plus size={16} /> フォルダか zip をドロップして追加
                </button>
              )}

              {models.length < 2 && addFormat === 'spriteset' && !spritesetDraft.imageUploaded && (
                <button
                  onClick={() => setSpritesetDraft(d => ({ ...d, imageUploaded: true }))}
                  style={{
                    width: '100%', padding: '16px', borderRadius: 14, cursor: 'pointer',
                    border: `1.5px dashed ${theme.dashedBorder}`, background: 'transparent',
                    color: theme.inkDim, fontFamily: "'M PLUS 1 Code', sans-serif",
                    fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 6,
                  }}
                >
                  <ImagePlus size={20} color={theme.iconInactive} />
                  画像ファイルを1枚ドロップしてアップロード
                  <span style={{ fontSize: 11, color: theme.iconInactive }}>PNG / JPG(透過推奨)・ 動画ファイルの用意は不要です</span>
                </button>
              )}

              {models.length < 2 && addFormat === 'spriteset' && spritesetDraft.imageUploaded && (
                <Section
                  title="モーションをAIで生成"
                  hint="外部サービスに渡す画像は、背景を自動でクロマグリーンに合成しています(そのまま使ってください)。生成されたmp4/webmを「取り込む」にドロップすると、背景の色キー抜き+WebP変換を自動で行います。プロンプトは調整できます。idleだけは必須、他は未設定でもidleにフォールバックします。"
                >
                  <Row label="外部サービスへ渡す画像" sub="background_key.png ・ クロマグリーン合成済み(自動生成)" last={false}>
                    <button style={{
                      display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
                      border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                      color: theme.inkDim, fontSize: 11, cursor: 'pointer',
                    }}>
                      <Copy size={11} /> 保存
                    </button>
                  </Row>
                  {Object.entries(spritesetDraft.clips).map(([key, clip], i, arr) => {
                    const done = clip.status === 'done';
                    return (
                      <Row key={key} label={clip.label} sub={`「${clip.prompt}」・ mp4/webmをドロップ`} last={i === arr.length - 1}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {done ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.mint, fontSize: 11.5 }}>
                              <CheckCircle2 size={14} /> 取込済
                            </span>
                          ) : (
                            <>
                              <button
                                title="プロンプトをコピー"
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
                                  border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                                  color: theme.inkDim, fontSize: 11, cursor: 'pointer',
                                }}
                              >
                                <Copy size={11} /> コピー
                              </button>
                              <button
                                onClick={() => setSpritesetDraft(d => ({
                                  ...d,
                                  clips: { ...d.clips, [key]: { ...d.clips[key], status: 'done' } },
                                }))}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4, background: theme.accentTag,
                                  border: `1px solid ${theme.accent}`, borderRadius: 999, padding: '4px 8px',
                                  color: theme.accent, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                                }}
                              >
                                <Upload size={11} /> 取り込む
                              </button>
                            </>
                          )}
                        </div>
                      </Row>
                    );
                  })}
                </Section>
              )}

              {models.length < 2 && addFormat === 'spriteset' && spritesetDraft.imageUploaded && (
                <button
                  disabled={spritesetDraft.clips.idle.status !== 'done'}
                  onClick={() => {
                    if (spritesetDraft.clips.idle.status === 'done') confirmAddSpritesetModel();
                  }}
                  style={{
                    width: '100%', padding: '13px', borderRadius: 12, marginTop: 4,
                    border: 'none', cursor: spritesetDraft.clips.idle.status === 'done' ? 'pointer' : 'not-allowed',
                    background: spritesetDraft.clips.idle.status === 'done' ? theme.accent : theme.dashedBorder,
                    color: spritesetDraft.clips.idle.status === 'done' ? theme.bgPanel : theme.iconInactive,
                    fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 13, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Sparkles size={15} />
                  {spritesetDraft.clips.idle.status === 'done' ? 'このモデルを追加する' : 'まずidleを取り込んでください'}
                </button>
              )}

              {models.length >= 2 && (
                <div style={{
                  fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.iconInactive,
                  textAlign: 'center', padding: '8px 4px', lineHeight: 1.6,
                }}>
                  モデルは2体までです。入れ替えるには、どちらかを削除してください。
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                {models.length === 0 ? (
                  <div style={{
                    fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12.5, color: theme.iconInactive,
                    textAlign: 'center', padding: '20px 4px', lineHeight: 1.6,
                  }}>
                    モデルがまだありません。上の「追加するモデルの形式」から追加してください。
                  </div>
                ) : (() => {
                  const targetModel = models.find(mm => mm.id === mappingTarget) ?? models[0];
                  const isSpriteset = targetModel?.renderType === 'spriteset';
                  return (
                    <Section
                      title="感情とモーションの対応"
                      hint={
                        isSpriteset
                          ? '各感情に再生する動画クリップを割り当てます。未割当の感情はidleクリップにフォールバックします。'
                          : 'モデルごとのモーション名は作者によって違うため、ここで割り当てます。未割当の感情はニュートラルに戻ります。'
                      }
                    >
                      {models.length === 2 && (
                        <div style={{
                          display: 'flex', gap: 6, padding: '10px 16px', borderBottom: `1px solid ${theme.line}`,
                        }}>
                          {models.map(mm => (
                            <button
                              key={mm.id}
                              onClick={() => setMappingTarget(mm.id)}
                              style={{
                                cursor: 'pointer', borderRadius: 999, padding: '4px 10px',
                                border: `1px solid ${mappingTarget === mm.id ? theme.accent : theme.line}`,
                                background: mappingTarget === mm.id ? theme.accentTag : 'transparent',
                                color: mappingTarget === mm.id ? theme.ink : theme.inkDim,
                                fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11.5,
                              }}
                            >
                              {mm.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {isSpriteset ? (
                        <>
                          {EMOTION_STATES.map((s, i, arr) => {
                            const unmapped = s.live2d === '未割当'; // デモ用に同じ未設定状態を流用
                            const sub = unmapped
                              ? '未割当'
                              : `${s.key}.webp ・ ${s.category === 'mood' ? 'ループ' : '単発→idleへ復帰'}`;
                            return (
                              <Row key={s.key} label={s.key} sub={sub} last={i === arr.length - 1}>
                                {unmapped ? (
                                  <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.sealRed }}>
                                    要設定
                                  </span>
                                ) : (
                                  <button style={{
                                    display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
                                    border: `1px solid ${theme.line}`, borderRadius: 999, padding: '4px 8px',
                                    color: theme.inkDim, fontSize: 11, cursor: 'pointer',
                                  }}>
                                    <Upload size={11} /> 変更
                                  </button>
                                )}
                              </Row>
                            );
                          })}
                        </>
                      ) : (
                        <>
                          {EMOTION_STATES.map((s, i, arr) => {
                            const unmapped = s.live2d === '未割当';
                            return (
                              <Row key={s.key} label={s.key} sub={unmapped ? '未割当' : s.live2d} last={i === arr.length - 1}>
                                {unmapped && (
                                  <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.sealRed }}>
                                    要設定
                                  </span>
                                )}
                              </Row>
                            );
                          })}
                        </>
                      )}
                    </Section>
                  );
                })()}
              </div>
            </>
          )}

          {tab === 'adapter' && (
            <>
              <Section title="Code Adapter">
                <Row label="監視対象パス" sub="~/dev/kotokoro-diary">
                  <ChevronRight size={16} color={theme.iconInactive} />
                </Row>
                <Row label="ポート番号">
                  <TextInput value="8765" onChange={() => {}} mono />
                </Row>
                <Row label="連続失敗で焦り始める回数" last>
                  <TextInput value="3" onChange={() => {}} mono />
                </Row>
              </Section>

              <Section title="Chat Adapter">
                <Row label="動作モード" sub={chatMode === 'mock' ? '固定の返答でコストをかけずに確認できます' : 'Anthropic API に実際に接続します'}>
                  <Switch checked={chatMode === 'real'} onChange={v => setChatMode(v ? 'real' : 'mock')} warn={chatMode === 'real'} />
                </Row>
                <Row label="APIキー" last={chatMode !== 'real'}>
                  <TextInput value="" onChange={() => {}} placeholder={chatMode === 'real' ? 'sk-ant-...' : 'モックでは不要'} disabled={chatMode !== 'real'} mono />
                </Row>
                {chatMode === 'real' && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px',
                    background: theme.bgRaised, borderTop: `1px solid ${theme.line}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{
                        fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11.5, fontWeight: 700,
                        color: theme.inkDim, letterSpacing: '0.02em',
                      }}>
                        APIキーの取得方法
                      </span>
                      <button style={{
                        display: 'flex', alignItems: 'center', gap: 4, background: 'transparent',
                        border: `1px solid ${theme.accent}`, borderRadius: 999, padding: '4px 10px',
                        color: theme.accent, fontFamily: "'M PLUS 1 Code', sans-serif",
                        fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                        <ExternalLink size={11} /> console.anthropic.com を開く
                      </button>
                    </div>
                    {API_KEY_STEPS.map((step, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{
                          flexShrink: 0, width: 16, height: 16, borderRadius: '50%',
                          border: `1px solid ${theme.accent}`, color: theme.accent,
                          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                        }}>
                          {i + 1}
                        </span>
                        <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.ink, lineHeight: 1.6 }}>
                          {step}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {chatMode === 'real' && (
                  <div style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start', padding: '12px 16px',
                    background: theme.sealRedTagSoft, borderTop: `1px solid ${theme.line}`,
                  }}>
                    <AlertTriangle size={15} color={theme.sealRed} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.warnText, lineHeight: 1.6 }}>
                      本番モードでは会話のたびに API 利用料がかかります。動作確認だけならモックのままで十分です。
                    </span>
                  </div>
                )}
              </Section>
            </>
          )}

          {tab === 'general' && (
            <>
              <Section title="配色テーマ" hint={
                themeMode === 'system'
                  ? `OSの配色設定に連動しています(現在: ${theme.label}として表示中)`
                  : '「システムに合わせる」を選ぶと、OSのライト/ダーク設定に自動追従します。'
              }>
                <div style={{ display: 'flex', gap: 8, padding: '14px 16px' }}>
                  {[...Object.entries(THEMES), ['system', null]].map(([key, th]) => {
                    const active = themeMode === key;
                    const isSystem = key === 'system';
                    const swatchBg = isSystem
                      ? `linear-gradient(135deg, ${THEMES.light.bgBase} 50%, ${THEMES.dark.bgBase} 50%)`
                      : th.bgBase;
                    const cardBg = isSystem ? theme.bgPanel : th.bgBase;
                    const labelColor = isSystem ? theme.ink : th.ink;
                    return (
                      <button
                        key={key}
                        onClick={() => setThemeMode(key)}
                        style={{
                          flex: 1, cursor: 'pointer', borderRadius: 12, padding: '10px',
                          border: active ? `2px solid ${theme.accent}` : `1px solid ${theme.line}`,
                          background: cardBg, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', gap: 8, position: 'relative',
                        }}
                      >
                        {active && (
                          <div style={{
                            position: 'absolute', top: 6, right: 6, width: 16, height: 16,
                            borderRadius: '50%', background: theme.accent,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Check size={11} color={cardBg} strokeWidth={3} />
                          </div>
                        )}
                        {isSystem ? (
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', background: swatchBg,
                            border: `1px solid ${theme.line}`, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Monitor size={14} color={theme.ink} strokeWidth={1.8} />
                          </div>
                        ) : (
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', background: th.swatchAccent,
                          }} />
                        )}
                        <span style={{
                          fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 600,
                          color: labelColor, textAlign: 'center', lineHeight: 1.3, whiteSpace: 'pre-line',
                        }}>
                          {isSystem ? 'システムに\n合わせる' : th.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="表示">
                <Row label="キャラのサイズ">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="range" min="20" max="100" value={displaySize}
                      onChange={e => setDisplaySize(e.target.value)} style={{ width: 90 }} />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: theme.inkDim, width: 32 }}>
                      {displaySize}%
                    </span>
                  </div>
                </Row>
                <Row label="裏の操作をそのまま通す" sub="キャラ以外の場所はクリックスルー" last>
                  <Switch checked={clickThrough} onChange={setClickThrough} />
                </Row>
              </Section>

              <Section title="起動">
                <Row label="ログイン時に自動で起動する" last>
                  <Switch checked={autostart} onChange={setAutostart} />
                </Row>
              </Section>

              <Section title="気分の変化" hint="反応がどれくらいの速さで元の気分に戻るかを調整します。">
                <Row label="リアクションの持続時間">
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: theme.ink }}>3.0秒</span>
                </Row>
                <Row label="無操作でうとうとし始めるまで" last>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: theme.ink }}>5分</span>
                </Row>
              </Section>
            </>
          )}

          {tab === 'logs' && (
            <>
              <Section title="hooks イベントログ">
                {[
                  { t: '14:32:08', ev: 'PostToolUse', tool: 'Bash', ok: true },
                  { t: '14:31:55', ev: 'PreToolUse', tool: 'Edit', ok: true },
                  { t: '14:29:40', ev: 'PostToolUseFailure', tool: 'Bash', ok: false },
                  { t: '14:28:12', ev: 'Notification', tool: '—', ok: true },
                ].map((l, i, arr) => (
                  <Row key={i} label={l.ev} sub={`${l.t} ・ ${l.tool}`} last={i === arr.length - 1}>
                    <span style={{
                      fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 700,
                      padding: '2px 8px', borderRadius: 999,
                      color: l.ok ? theme.mint : theme.sealRed,
                      background: l.ok ? theme.mintTag : theme.sealRedTag,
                    }}>
                      {l.ok ? '成功' : '失敗'}
                    </span>
                  </Row>
                ))}
              </Section>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button style={{
                  width: '100%', padding: '12px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${theme.line}`, background: theme.bgRaised, color: theme.ink,
                  fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 13,
                }}>
                  エクスポート(共有用・パスをマスク)
                </button>
                <button style={{
                  width: '100%', padding: '12px', borderRadius: 12, cursor: 'pointer',
                  border: `1px solid ${theme.line}`, background: theme.bgPanel, color: theme.inkDim,
                  fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 13,
                }}>
                  ログを消去する
                </button>
              </div>
              <div style={{
                fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11.5, color: theme.iconInactive,
                marginTop: 8, lineHeight: 1.6,
              }}>
                エクスポートしたファイルは、プロジェクト名を project-a / project-b のような仮名に置き換えています。元のログ(このアプリ内)はそのまま残ります。
              </div>
            </>
          )}

          {tab === 'licenses' && (
            <>
              <Section title="Live2D Cubism(Live2D形式のみ)" hint="配布する場合、AI/チャットボットのインターフェースとしての利用に該当するため、公開前にLive2D社の判定フローを確認する必要があります。この確認はLive2D形式のモデルにのみ関係し、スプライトセット形式には及びません。">
                <Row label="現在の利用区分">
                  <span style={{
                    fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 700,
                    padding: '3px 9px', borderRadius: 999, color: theme.mint,
                    background: theme.mintTag,
                  }}>
                    個人利用(無償)
                  </span>
                </Row>
                <Row label="配布時の要確認事項" last>
                  <AlertTriangle size={15} color={theme.sealRed} />
                </Row>
              </Section>

              <Section title="外部動画生成AIサービス(スプライトセット用)" hint="Pika・Canva等の無料枠は一般的に個人利用限定です。配布時は各サービスの利用規約(商用利用可否)を確認してください。生成物の著作権・利用範囲もサービスごとに異なるため、選択・利用はご自身の責任で行ってください。">
                <Row label="現在の利用区分" last>
                  <span style={{
                    fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 11, fontWeight: 700,
                    padding: '3px 9px', borderRadius: 999, color: theme.mint,
                    background: theme.mintTag,
                  }}>
                    個人利用(無償枠)
                  </span>
                </Row>
              </Section>

              <Section title="使用しているオープンソースソフトウェア" hint="ビルド時に package.json から自動生成しています。">
                {[
                  { name: 'Electron', license: 'MIT' },
                  { name: 'PixiJS', license: 'MIT' },
                  { name: 'pixi-live2d-display', license: 'MIT' },
                  { name: 'React', license: 'MIT' },
                  { name: 'Zod', license: 'MIT' },
                  { name: 'lucide-react', license: 'ISC' },
                ].map((lib, i, arr) => (
                  <Row key={lib.name} label={lib.name} last={i === arr.length - 1}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: theme.inkDim }}>
                      {lib.license}
                    </span>
                  </Row>
                ))}
              </Section>

              <Section title="フォント">
                <Row label="Zen Antique / M PLUS 1 Code / JetBrains Mono" sub="SIL Open Font License 1.1" last />
              </Section>

              <Section title="追加したモデルについて">
                <Row label="著作権は作成者に帰属します" sub="ご自身が利用権限を持つモデルのみ追加してください" last />
              </Section>

              <Section title="Claude / Anthropic API" last>
                <Row label="ご自身のAPIキーで呼び出します" sub="Anthropicの利用規約が適用されます" last />
              </Section>
            </>
          )}
        </div>
        </div>
        )}
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}
