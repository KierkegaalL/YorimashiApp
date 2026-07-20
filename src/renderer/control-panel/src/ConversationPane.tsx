/**
 * 会話ペイン(FR-15。UIの正: docs/mockups/control-panel.jsx L419-702)。
 *
 * 構成: 憑坐状態帯(呪紋リング+Mood) / 会話履歴(メモリのみ・C-22) / 入力欄(C-23)。
 * このペインは常時表示で畳めない(2026-07-18仕様変更。畳めるのは Control Panel 側のみ。chat-pane.md 論点1)。
 * Live2D/スプライトセットのどちらにも依存しない: キャラ描画は持たず、EmotionEngine への
 * trigger/release だけを扱う(chat-pane.md「形式による分岐について」)。
 *
 * この移植段階(#6)の範囲は**プレゼンテーションと入力操作のUI**まで。以下は後続タスク:
 *  - 送信→Main(Chat Adapter)→擬似streaming受信、release('thinking') の全経路保証 … #8(FR-3)
 *  - 送信時の activeAdapter 自動切替+明示(案1・C-24・論点5) … #8
 *  - @参照の文脈組立 / 添付(real) / コンテキスト実測 … #8・#12
 * そのため**偽の応答は生成しない**(「状態について嘘をつかない」。constraints.md)。送信すると
 * ユーザー発話を積み「考えています…」を出すところまでで、応答本文の捏造はしない。
 * 会話履歴の初期シードも置かない(C-22: 永続化しない。デモ用の固定会話を実物に見せない)。
 */

import { useState } from 'react';
import {
  UserRound,
  Circle,
  Copy,
  RotateCcw,
  Terminal,
  AtSign,
  Paperclip,
  Send,
  Square,
} from 'lucide-react';

import { useTheme } from './theme';
import { AT_REFERENCES, RESPONSE_MODELS, SLASH_COMMANDS } from './catalog';
import type { AdapterMode, ChatMode, ChatMessage } from './types';
import type { MoodState } from '../../../shared/emotions';

export interface ConversationPaneProps {
  /** 憑坐状態帯に表示する現在のMood。#8 で EmotionEngine のスナップショット(WS)に接続する。 */
  mood: MoodState;
  adapterMode: AdapterMode;
  chatMode: ChatMode;
  onSetChatMode: (mode: ChatMode) => void;
  onSetAdapterMode: (mode: AdapterMode) => void;
  /** /panel・折りたたみ解除で Control Panel を展開する。 */
  onExpandControlPanel: () => void;
}

export function ConversationPane({
  mood,
  adapterMode,
  chatMode,
  onSetChatMode,
  onSetAdapterMode,
  onExpandControlPanel,
}: ConversationPaneProps): React.JSX.Element {
  const theme = useTheme();
  const m = theme.moods[mood];

  // 会話履歴はメモリのみ(C-22)。初期値は空 = デモ会話をシードしない。
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  // 応答モデル選択は real 時のみ意味を持つ(C-23)。将来 config.chatAdapter.model に保存する(#12)。
  const [responseModel, setResponseModel] = useState('claude-sonnet-5');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [atMenuOpen, setAtMenuOpen] = useState(false);

  const handleChatSend = (): void => {
    const text = chatInput.trim();
    if (!text || chatSending) {
      return;
    }
    // ユーザー発話を積み、送信中(考え中)にする。ここから先(Main への送信・擬似streaming・
    // 応答本文・emotion trigger/release)は #8 で配線する。偽の応答本文はここでは作らない。
    // 併せて #8 で案1(C-24)の activeAdapter→chat 自動切替+明示も実装する。
    setChatMessages((prev) => [...prev, { id: Date.now(), role: 'user', text }]);
    setChatInput('');
    setChatSending(true);
  };

  // 中断。成功・失敗・中断・無通信タイムアウトの全経路で release('thinking') を呼ぶ必要がある
  // (呼び忘れ=thinking永久固着。chat-pane.md 論点3)。その保証は #8 で送信経路と一体で実装する。
  const handleChatStop = (): void => setChatSending(false);

  // 応答モデルを次候補へ循環(real時のみ意味を持つ。C-23)。/model と入力欄フッターのチップから呼ぶ。
  const cycleResponseModel = (): void => {
    setResponseModel((prev) => {
      const i = RESPONSE_MODELS.findIndex((mm) => mm.id === prev);
      return RESPONSE_MODELS[(i + 1) % RESPONSE_MODELS.length].id;
    });
  };

  const runSlashCommand = (cmd: string): void => {
    if (cmd === '/clear') setChatMessages([]);
    if (cmd === '/mock') onSetChatMode('mock');
    if (cmd === '/real') onSetChatMode('real');
    if (cmd === '/code') onSetAdapterMode('code');
    if (cmd === '/panel') onExpandControlPanel();
    if (cmd === '/model' && chatMode === 'real') cycleResponseModel();
    setSlashMenuOpen(false);
  };

  const insertAtReference = (label: string): void => {
    setChatInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}@${label} `);
    setAtMenuOpen(false);
  };

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${theme.line}`,
      }}
    >
      {/* ── 憑坐状態帯 ───────────────────────────── */}
      <div
        style={{
          position: 'relative',
          padding: '18px 18px 16px',
          overflow: 'hidden',
          borderBottom: `1px solid ${theme.line}`,
          background: theme.bgBase,
        }}
      >
        {/* 背景の残光ブルーム */}
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: -20,
            width: 160,
            height: 160,
            borderRadius: '50%',
            background: m.glow,
            filter: 'blur(36px)',
            animation: `breathe ${m.speed}s ease-in-out infinite`,
          }}
        />

        {/* 極小ワードマーク */}
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            letterSpacing: '0.18em',
            color: theme.iconInactive,
            marginBottom: 10,
            textTransform: 'uppercase',
          }}
        >
          ヨリマシ.app
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* 呪紋リング + HUDブラケット + アバター */}
          <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
            <svg
              viewBox="0 0 60 60"
              style={{ position: 'absolute', inset: 0, animation: `seal-spin ${m.speed * 3}s linear infinite` }}
            >
              <circle
                cx="30"
                cy="30"
                r="27"
                fill="none"
                stroke={m.color}
                strokeWidth="1"
                strokeDasharray="3 5"
                opacity="0.7"
              />
            </svg>
            <svg
              viewBox="0 0 60 60"
              style={{
                position: 'absolute',
                inset: 0,
                animation: `seal-spin-reverse ${m.speed * 4.5}s linear infinite`,
              }}
            >
              <circle cx="30" cy="30" r="22" fill="none" stroke={m.color} strokeWidth="0.75" opacity="0.35" />
            </svg>
            {/* HUD四隅ブラケット */}
            {(
              [
                { top: -3, left: -3, borderWidth: '2px 0 0 2px' },
                { top: -3, right: -3, borderWidth: '2px 2px 0 0' },
                { bottom: -3, left: -3, borderWidth: '0 0 2px 2px' },
                { bottom: -3, right: -3, borderWidth: '0 2px 2px 0' },
              ] as const
            ).map((pos, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: 12,
                  height: 12,
                  borderColor: m.color,
                  borderStyle: 'solid',
                  ...pos,
                }}
              />
            ))}
            <div
              style={{
                position: 'absolute',
                inset: 8,
                borderRadius: '50%',
                background: theme.bgRaised,
                border: `1.5px solid ${m.color}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <UserRound size={20} color={m.color} strokeWidth={1.6} />
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10.5,
                color: theme.labelMuted,
                letterSpacing: '0.06em',
                marginBottom: 2,
              }}
            >
              憑坐: 常世灯里(とこよ あかり)
            </div>
            <div
              style={{
                fontFamily: "'Zen Antique', serif",
                fontSize: 19,
                fontWeight: 400,
                color: theme.ink,
                lineHeight: 1.3,
              }}
            >
              霊力状態 ── {m.label}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Circle size={7} fill={m.color} color={m.color} />
              <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 12, color: theme.inkDim }}>
                {adapterMode === 'code' ? 'Code Adapter・待機中' : 'Chat Adapter・待機中'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 会話履歴(メモリのみ・streaming表示。C-22) ───────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {chatMessages.length === 0 && !chatSending && (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 12.5,
              color: theme.iconInactive,
              lineHeight: 1.7,
            }}
          >
            まだ会話はありません。
            <br />
            下の入力欄から灯里に話しかけてみてください。
          </div>
        )}
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '9px 13px',
                borderRadius: 14,
                background: msg.role === 'user' ? theme.accentTag : theme.bgRaised,
                border: `1px solid ${msg.role === 'user' ? theme.accent : theme.line}`,
                color: theme.ink,
                fontFamily: "'M PLUS 1 Code', sans-serif",
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {msg.text}
            </div>
            {msg.role === 'assistant' && (
              <div style={{ display: 'flex', gap: 4 }}>
                {/* コピー・再生成の実挙動は #8 で配線する(応答本文が実データになってから)。 */}
                <button
                  title="コピー"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    color: theme.iconInactive,
                    display: 'flex',
                  }}
                >
                  <Copy size={12} />
                </button>
                <button
                  title="再生成"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    color: theme.iconInactive,
                    display: 'flex',
                  }}
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
        {chatSending && (
          <div
            style={{
              alignSelf: 'flex-start',
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 12,
              color: theme.inkDim,
            }}
          >
            灯里が考えています…
          </div>
        )}
      </div>

      {/* ── 入力欄(C-23) ── */}
      <div style={{ position: 'relative', borderTop: `1px solid ${theme.line}`, padding: '10px 14px 14px' }}>
        {/* コンテキスト使用量: real時のみ実測(#12)。mock は実測値を持たないため表示しない(嘘をつかない)。
            下のバーは real 時のプレースホルダで、実測接続まで固定値を出さないよう #12 で置換する。 */}
        {chatMode === 'real' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: theme.sliderTrack, overflow: 'hidden' }}>
              <div style={{ width: '0%', height: '100%', background: theme.mint }} />
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: theme.inkDim }}>
              —
            </span>
          </div>
        )}

        {slashMenuOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 14,
              right: 14,
              marginBottom: 6,
              background: theme.bgPanel,
              border: `1px solid ${theme.line}`,
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
            }}
          >
            {SLASH_COMMANDS.map((c) => {
              const disabled = c.cmd === '/model' && chatMode !== 'real';
              return (
                <button
                  key={c.cmd}
                  disabled={disabled}
                  onClick={() => runSlashCommand(c.cmd)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'none',
                    border: 'none',
                    textAlign: 'left',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.45 : 1,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 12,
                      color: theme.accent,
                      minWidth: 52,
                    }}
                  >
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
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 14,
              marginBottom: 6,
              minWidth: 190,
              background: theme.bgPanel,
              border: `1px solid ${theme.line}`,
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
            }}
          >
            {AT_REFERENCES.map((r) => (
              <button
                key={r.key}
                onClick={() => insertAtReference(r.label)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 12,
                  color: theme.ink,
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
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleChatSend();
              }
            }}
            placeholder="灯里に話しかける…"
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              background: theme.bgRaised,
              border: `1px solid ${theme.line}`,
              borderRadius: 10,
              padding: '8px 10px',
              color: theme.ink,
              fontFamily: "'M PLUS 1 Code', sans-serif",
              fontSize: 13,
              outline: 'none',
              maxHeight: 80,
            }}
          />
          <button
            onClick={chatSending ? handleChatStop : handleChatSend}
            aria-label={chatSending ? '応答を中断' : '送信'}
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              flexShrink: 0,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: chatSending ? theme.sealRed : theme.accent,
              color: theme.bgPanel,
            }}
          >
            {chatSending ? <Square size={13} fill="currentColor" /> : <Send size={14} />}
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => {
                setSlashMenuOpen((v) => !v);
                setAtMenuOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: 'transparent',
                border: `1px solid ${theme.line}`,
                borderRadius: 999,
                padding: '4px 8px',
                color: theme.inkDim,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Terminal size={12} /> /
            </button>
            <button
              onClick={() => {
                setAtMenuOpen((v) => !v);
                setSlashMenuOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: 'transparent',
                border: `1px solid ${theme.line}`,
                borderRadius: 999,
                padding: '4px 8px',
                color: theme.inkDim,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <AtSign size={12} /> 参照
            </button>
            {/* 添付は real 時のみ(mock は無効)。ダイアログ選択に限定するファイル読み出しは #12。 */}
            <button
              disabled={chatMode !== 'real'}
              title={chatMode !== 'real' ? 'real接続時のみ使えます' : '画像・ファイルを添付'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: 'transparent',
                border: `1px solid ${theme.line}`,
                borderRadius: 999,
                padding: '4px 8px',
                color: theme.inkDim,
                fontSize: 11,
                cursor: chatMode !== 'real' ? 'not-allowed' : 'pointer',
                opacity: chatMode !== 'real' ? 0.45 : 1,
              }}
            >
              <Paperclip size={12} />
            </button>
            {/* 応答モデル選択は real 時のみ(mock は固定返答・C-08)。 */}
            <button
              disabled={chatMode !== 'real'}
              onClick={cycleResponseModel}
              title={
                chatMode !== 'real'
                  ? 'real接続時のみ選択できます(mockは固定返答・C-08)'
                  : '応答モデルを切替'
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                background: 'transparent',
                border: `1px solid ${theme.line}`,
                borderRadius: 999,
                padding: '4px 8px',
                color: theme.inkDim,
                fontSize: 11,
                cursor: chatMode !== 'real' ? 'not-allowed' : 'pointer',
                opacity: chatMode !== 'real' ? 0.45 : 1,
              }}
            >
              {RESPONSE_MODELS.find((mm) => mm.id === responseModel)?.label}
            </button>
          </div>
          <span style={{ fontFamily: "'M PLUS 1 Code', sans-serif", fontSize: 10, color: theme.iconInactive }}>
            Enter送信 / Shift+Enter改行
          </span>
        </div>
      </div>
    </div>
  );
}
