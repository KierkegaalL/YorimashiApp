/**
 * 会話ペイン(FR-15。UIの正: docs/mockups/control-panel.jsx L419-702)。
 *
 * 構成: 憑坐状態帯(呪紋リング+Mood) / 会話履歴(メモリのみ・C-22) / 入力欄(C-23)。
 * このペインは常時表示で畳めない(2026-07-18仕様変更。畳めるのは Control Panel 側のみ。chat-pane.md 論点1)。
 * Live2D/スプライトセットのどちらにも依存しない: キャラ描画は持たず、EmotionEngine への
 * trigger/release だけを扱う(chat-pane.md「形式による分岐について」)。
 *
 * #8(FR-3)で Main の Chat Adapter へ接続済み。送信→擬似streaming受信→分類までが実際に動く:
 *  - 送信は `window.yorimashi.chat.send()`。**本文の生成はMainの責務**で、このペインは
 *    受け取ったチャンクを最後の吹き出しへ追記するだけ(偽の応答をここで作らない)。
 *  - `thinking`(sustain)→`release`の駆動もMain側。UIは実況イベントを映すだけ。
 *  - 送信で activeAdapter が Chat へ自動切替された場合、**system メッセージで明示する**
 *    (案1・C-24。黙って切り替えない)。
 *  - mock の応答には origin='mock' のバッジを出す。固定返答をClaudeの回答に見せない
 *    (chat-adapter-errors.md 論点4と同じ理屈)。
 * 残り(#12): @参照の文脈組立 / 添付(real) / コンテキスト実測 / real接続。
 *
 * 会話履歴の初期シードは置かない(C-22: 永続化しない。デモ用の固定会話を実物に見せない)。
 *
 * **モックアップ(UIの正: docs/mockups/control-panel.jsx)との意図的な差分**:
 * モックアップの会話履歴は user/assistant の2ロールだけを描き、実データが流れる前提の表現を
 * 持っていない。#8 で実接続したことにより、モックアップに無い次の表現を足している:
 *   - role='system'(「Chat Adapter に切り替えました」等。C-24が**明示**を要求するため必須)
 *   - role='error' + アクションボタン(chat-pane.md 論点4の表がUI要件として定めている)
 *   - origin='mock' のバッジ(固定返答をClaudeの回答に見せない。chat-adapter-errors.md 論点4)
 *   - streaming中のカーソルと中断の注記(擬似streamingがlipsync.mdの要求で入ったため)
 * いずれも**詳細設計が要求していてモックアップが先回りしていなかった**もので、モックアップの
 * レイアウト・配色・既存要素には手を入れていない。モックアップ側への反映は、6タブの中身を
 * 移植する後続タスクでUI全体を見直す際に併せて行う。
 */

import { useEffect, useRef, useState } from 'react';
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
import { MAX_CHAT_INPUT_LENGTH, type ChatErrorAction } from '../../../shared/chat';

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
  /** 再送(エラー時の retry ボタン)のために直近の送信本文だけ覚えておく。 */
  const [lastSentText, setLastSentText] = useState('');
  /** 描画キー用の連番。Date.now()だと同一ms内の連続追加で衝突しうる。 */
  const nextMessageId = useRef(1);
  /** 現在streaming中のアシスタント吹き出しのid(チャンクの追記先)。 */
  const streamingMessageId = useRef<number | null>(null);
  /**
   * 現在のstreamingで1文字でも受信したか。**stateではなくrefで持つ**理由:
   * `setChatMessages` の updater は同期実行されないため、updater内で判定した結果を
   * 直後に読むと必ず初期値のままになる(終端処理の分岐を誤る)。
   */
  const streamingHasText = useRef(false);
  /**
   * 送信中フラグの即時版。`chatSending` は再レンダーまで更新されないため、Enterキーの
   * リピート等で同一ティック内に handleChatSend が連続で走ると多重送信が漏れうる
   * (Main側も弾くが、ユーザーには「応答の生成中です」エラーが見えて驚きになる)。
   */
  const sendingRef = useRef(false);
  // 応答モデル選択は real 時のみ意味を持つ(C-23)。将来 config.chatAdapter.model に保存する(#12)。
  const [responseModel, setResponseModel] = useState('claude-sonnet-5');
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [atMenuOpen, setAtMenuOpen] = useState(false);

  const appendMessage = (message: Omit<ChatMessage, 'id'>): number => {
    const id = nextMessageId.current++;
    setChatMessages((prev) => [...prev, { ...message, id }]);
    return id;
  };

  const patchMessage = (id: number, patch: Partial<ChatMessage>): void => {
    setChatMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)));
  };

  /**
   * Main(Chat Adapter)からの実況を購読する。
   * start → chunk* → (done | aborted | error) で必ず終端し、そこで送信中フラグを解く。
   * **終端イベントはMain側が全経路で必ず送る**ため、ここが「考えています…」のまま
   * residueとして残ることはない(chat.ts / chat-adapter.ts の release 全経路保証と対)。
   */
  useEffect(() => {
    const api = window.yorimashi?.chat;
    if (!api) {
      return;
    }
    return api.onStream((event) => {
      if (event.type === 'start') {
        streamingHasText.current = false;
        streamingMessageId.current = appendMessage({
          role: 'assistant',
          text: '',
          origin: event.origin,
          streaming: true,
        });
        return;
      }
      const target = streamingMessageId.current;
      if (target === null) {
        return;
      }
      if (event.type === 'chunk') {
        if (event.text.length > 0) {
          streamingHasText.current = true;
        }
        // 差し替えではなく**追記**する(streaming表示。chat-pane.md 論点3)。
        setChatMessages((prev) =>
          prev.map((msg) => (msg.id === target ? { ...msg, text: msg.text + event.text } : msg)),
        );
        return;
      }
      // ── 終端 ───────────────────────────────
      streamingMessageId.current = null;
      sendingRef.current = false;
      setChatSending(false);
      if (event.type === 'done') {
        patchMessage(target, { streaming: false });
      } else {
        // 中断・エラーの共通後始末。**部分受信済みなら残したうえで streaming を必ず解除し**
        // (解除しないと ▍ カーソルが残り続け、コピー/再生成も出せなくなる)、
        // **1文字も受信していないなら空の吹き出しを残さない**。
        // real接続では受信途中のAPIエラー・無通信タイムアウトが現実に起きる
        // (chat-adapter-errors.md)ため、両方のケースの後始末が要る。
        const hadText = streamingHasText.current;
        // 打ち切りの**原因**を保持する。ユーザーが押していない停止を「中断しました」と
        // 表示しないため(real接続では無通信タイムアウト等で error 側にも部分受信が起きる)。
        const truncated = event.type === 'aborted' ? 'stopped' : 'error';
        setChatMessages((prev) =>
          prev.flatMap((msg) =>
            msg.id !== target ? [msg] : hadText ? [{ ...msg, streaming: false, truncated }] : [],
          ),
        );
        if (event.type === 'aborted') {
          // 何も受信していない中断は痕跡が消えてしまうため、system で事実だけ残す。
          if (!hadText) {
            appendMessage({ role: 'system', text: '応答を中断しました。' });
          }
        } else {
          appendMessage({ role: 'error', text: event.message, action: event.action });
        }
      }
    });
    // appendMessage/patchMessage は setState のみを使う安定した処理のため依存に含めない
    // (含めると毎レンダーで購読を張り替えることになり、チャンクを取りこぼしうる)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 送信。`echoUser=false` は**再生成/再送**用で、同じ質問をユーザー発話として二重に積まない
   * (直前の質問に対する新しい応答だけを求める操作のため)。
   *
   * **送信口はこの関数1つに統一する**(新規送信・再生成・再送すべて)。多重送信のガードを
   * ここに集約しないと、経路ごとにガードの有無がばらつき、Main側の「応答の生成中です」
   * エラーがユーザーに見えてしまう。
   *
   * 戻り値は**受理できたか**(Mainがstreamingを開始したか)。入力欄のクリアはこの結果を
   * 見てから行う必要があるため(handleChatSend)、呼び出し側に返す。
   */
  const sendText = async (text: string, echoUser = true): Promise<boolean> => {
    // sendingRef は同一ティック内の連打も弾く(chatSending は再レンダーまで古い値のため)。
    if (!text || sendingRef.current) {
      return false;
    }
    const api = window.yorimashi?.chat;
    if (echoUser) {
      appendMessage({ role: 'user', text });
    }
    setLastSentText(text);
    if (!api) {
      // preload が無い経路(ブラウザから /panel を直接開いた場合。environments.md)。
      // 送れないことをそのまま伝える(黙って握りつぶさない)。
      appendMessage({
        role: 'error',
        text: 'この画面からは送信できません(アプリのウィンドウで開いてください)。',
        action: 'none',
      });
      return false;
    }
    sendingRef.current = true;
    setChatSending(true);
    try {
      const accepted = await api.send(text);
      if (accepted.adapterSwitched) {
        // 案1(C-24): 黙って切り替えない。切り替えた事実をその場で明示する。
        // adapterMode 自体の更新はここで行わない — Mainが config を書き換えた結果が
        // onConfigChanged で降ってくるため(正本はconfig。二重に持たない)。
        appendMessage({ role: 'system', text: 'Chat Adapter に切り替えました。' });
      }
      return true;
    } catch (err) {
      // 受理されなかった(空文/長すぎ/多重送信など)。start が来ないので終端も来ない。
      sendingRef.current = false;
      setChatSending(false);
      appendMessage({
        role: 'error',
        text: err instanceof Error ? err.message : '送信できませんでした。',
        action: 'none',
      });
      return false;
    }
  };

  /**
   * 送信が受理された場合だけ入力欄をクリアする。受理されなかった場合(空文/長すぎ/多重送信/
   * preload無し)は、書いた本文が消えると打ち直しになるため**そのまま残す**。
   */
  const handleChatSend = (): void => {
    const text = chatInput.trim();
    // ガード本体は sendText 側(全送信経路で共通)。ここでは入力欄のクリア条件だけ判断する。
    if (!text || sendingRef.current) {
      return;
    }
    void sendText(text).then((accepted) => {
      if (accepted) {
        setChatInput('');
      }
    });
  };

  /**
   * 中断。実際の release('thinking') はMain側の finally が通す(chat-pane.md 論点3の
   * 「成功・失敗・中断・無通信タイムアウトの全経路」)。ここでフラグを勝手に倒さず、
   * Mainから aborted イベントが返ってきた時点で解く(状態の正はMainにある)。
   */
  const handleChatStop = (): void => {
    window.yorimashi?.chat.stop();
  };

  /** エラー吹き出しのボタン(chat-pane.md 論点4の表)。 */
  const runErrorAction = (action: ChatErrorAction): void => {
    if (action === 'switch-to-mock') {
      // **自動フォールバックではない**。ユーザーが明示的に押したときだけ切り替える。
      onSetChatMode('mock');
      appendMessage({ role: 'system', text: 'mock モードに切り替えました。' });
    } else if (action === 'open-adapter-settings') {
      onExpandControlPanel();
    } else if (action === 'retry') {
      // 再送も同じ質問の再試行なのでユーザー発話は積み直さない。多重送信のガードは sendText 側。
      void sendText(lastSentText, false);
    }
  };

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
              alignItems:
                msg.role === 'user' ? 'flex-end' : msg.role === 'system' ? 'center' : 'flex-start',
            }}
          >
            {/* system はアプリ自身の申告。灯里の発言と取り違えないよう吹き出しにしない。 */}
            {msg.role === 'system' ? (
              <span
                style={{
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 11,
                  color: theme.inkDim,
                  background: theme.bgRaised,
                  border: `1px solid ${theme.line}`,
                  borderRadius: 999,
                  padding: '3px 10px',
                }}
              >
                {msg.text}
              </span>
            ) : (
              <div
                style={{
                  maxWidth: '85%',
                  padding: '9px 13px',
                  borderRadius: 14,
                  background:
                    msg.role === 'user'
                      ? theme.accentTag
                      : msg.role === 'error'
                        ? theme.sealRedTagSoft
                        : theme.bgRaised,
                  border: `1px solid ${
                    msg.role === 'user'
                      ? theme.accent
                      : msg.role === 'error'
                        ? theme.sealRed
                        : theme.line
                  }`,
                  color: msg.role === 'error' ? theme.warnText : theme.ink,
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.text}
                {/* streaming中のカーソル。受信が続いていることを示す。 */}
                {msg.streaming === true && (
                  <span style={{ color: theme.accent, marginLeft: 1 }}>▍</span>
                )}
                {msg.truncated !== undefined && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: 6,
                      fontSize: 11,
                      color: theme.inkDim,
                    }}
                  >
                    {msg.truncated === 'stopped'
                      ? '(ここで中断しました)'
                      : '(ここで応答が途切れました)'}
                  </span>
                )}
              </div>
            )}
            {/* mock の固定返答を Claude の回答に見せない(chat-adapter-errors.md 論点4の理屈)。 */}
            {msg.role === 'assistant' && msg.origin === 'mock' && (
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9.5,
                  letterSpacing: '0.08em',
                  color: theme.iconInactive,
                  border: `1px solid ${theme.line}`,
                  borderRadius: 999,
                  padding: '1px 6px',
                }}
              >
                mock・固定返答
              </span>
            )}
            {/* エラーに添えるボタン。**自動でmockへ落とさない**(押されたときだけ切り替える)。 */}
            {msg.role === 'error' && msg.action !== undefined && msg.action !== 'none' && (
              <button
                onClick={() => runErrorAction(msg.action ?? 'none')}
                // 再送は送信中に押しても sendText 側のガードで無視される。黙って無反応にせず
                // 押せないことを見た目でも示す(再生成ボタンと同じ扱いに揃える)。
                disabled={msg.action === 'retry' && (chatSending || lastSentText.length === 0)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${theme.sealRed}`,
                  borderRadius: 999,
                  padding: '3px 10px',
                  cursor:
                    msg.action === 'retry' && (chatSending || lastSentText.length === 0)
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    msg.action === 'retry' && (chatSending || lastSentText.length === 0) ? 0.45 : 1,
                  fontFamily: "'M PLUS 1 Code', sans-serif",
                  fontSize: 11,
                  color: theme.warnText,
                }}
              >
                {msg.action === 'switch-to-mock'
                  ? 'モックモードに切り替える'
                  : msg.action === 'open-adapter-settings'
                    ? 'モード設定を開く'
                    : '再送する'}
              </button>
            )}
            {msg.role === 'assistant' && msg.streaming !== true && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  title="コピー"
                  onClick={() => void navigator.clipboard?.writeText(msg.text)}
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
                  disabled={chatSending || lastSentText.length === 0}
                  onClick={() => void sendText(lastSentText, false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: chatSending || lastSentText.length === 0 ? 'not-allowed' : 'pointer',
                    padding: 2,
                    color: theme.iconInactive,
                    display: 'flex',
                    opacity: chatSending || lastSentText.length === 0 ? 0.4 : 1,
                  }}
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
        {/* 「考えています…」は**最初のチャンクが来るまで**の表示。streaming が始まったら
            吹き出し自体が伸びていくので、二重に出さない。 */}
        {chatSending && streamingMessageId.current === null && (
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
            // Main側でも弾くが(chat-adapter.ts)、送信ボタンを押すまで気づけないのは不親切なので
            // 入力時点で止める。しきい値の正は shared/chat.ts。
            maxLength={MAX_CHAT_INPUT_LENGTH}
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
