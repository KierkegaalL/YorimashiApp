/**
 * Chat Adapter(FR-3)。会話ペイン(FR-15)からの送信を受け、応答を擬似/実streamingで返しつつ
 * EmotionEngine を駆動する。
 *
 * 正本:
 * - 経路: chat-pane.md 論点3(送信→thinking(sustain)→streaming→release→classify)
 * - 分類: emotion-classification.md(受信完了時に1度だけ・mockでもキーワード分類を実際に走らせる)
 * - 持続: lipsync.md(thinkingはChatでは持続。Code Adapterは一過性)
 * - エラー: chat-adapter-errors.md 論点4(mockへ自動フォールバックしない)
 * - 自動切替: C-24 / chat-pane.md 論点5(案1: 送信時にactiveAdapterをChatへ切替し**明示**する)
 *
 * **このクラスの最重要責務は `release('thinking')` の全経路保証**である。
 * lipsync.md: 「release()の呼び忘れはthinkingの永久固着を招く」。成功・失敗・中断・
 * 無通信タイムアウトのいずれで終わっても release が通るよう、streaming本体を try/finally で
 * 包み、finally 側で release と「終端イベントの送出」を必ず行う(下記 runStream)。
 *
 * **APIキーを扱うのはMainのみ**(security.md 5章)。Rendererへは本文とイベントしか渡さない。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(EmotionEngineへ状態キーを渡すだけで、
 * CharacterRendererに触れない。chat-pane.md「形式による分岐について」)。
 * よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import type { EmotionEngine } from '../emotion-engine';
import type { ConfigStore } from '../config-store';
import { IPC } from '../../shared/ipc';
import { classify } from '../../shared/emotion-classification';
import { isReactionState } from '../../shared/emotions';
import {
  MAX_CHAT_INPUT_LENGTH,
  type ChatErrorAction,
  type ChatErrorKind,
  type ChatSendAccepted,
  type ChatStreamEvent,
} from '../../shared/chat';
import { streamMockReply, type Sleep } from './mock-responder';

export interface ChatAdapterDeps {
  engine: EmotionEngine;
  configStore: ConfigStore;
  /** 実況の送信先(Control Panel ウィンドウ)。未生成/破棄後は null。 */
  getTargetWindow: () => BrowserWindow | null;
  /**
   * config を書き換えたことの通知(C-24の自動切替時)。Rendererのモード表示を実体へ追従させる。
   * これを呼ばないと、会話ペインの「Code Adapter・待機中」表示が config と食い違う。
   */
  onConfigChanged?: () => void;
  /** 擬似streamingの待機(検証で高速化・決定化するため注入可能にする)。 */
  sleep?: Sleep;
}

/** 進行中の1リクエスト。 */
interface ActiveRequest {
  requestId: number;
  controller: AbortController;
}

export class ChatAdapter {
  private readonly deps: ChatAdapterDeps;
  private active: ActiveRequest | null = null;
  private nextRequestId = 1;
  private disposed = false;

  constructor(deps: ChatAdapterDeps) {
    this.deps = deps;
    this.registerIpc();
  }

  /** 進行中のリクエストがあるか(検証・多重送信ガード用)。 */
  get isStreaming(): boolean {
    return this.active !== null;
  }

  /**
   * 送信を受理し、streaming を開始する(**awaitしない**)。
   * 戻り値は受理の事実だけで、本文は ChatStream イベントで流す。
   * こうしないと invoke の解決が応答完了まで待たされ、streaming表示にならない。
   */
  send(text: string): ChatSendAccepted {
    this.assertNotDisposed();

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('送信する本文がありません');
    }
    if (trimmed.length > MAX_CHAT_INPUT_LENGTH) {
      throw new Error(`本文が長すぎます(最大${MAX_CHAT_INPUT_LENGTH}文字)`);
    }
    if (this.active !== null) {
      // Renderer側でも送信ボタンを停止ボタンへ切り替えて防いでいるが、Mainでも弾く
      // (二重送信を受けるとthinkingのsustain/releaseが対応を失い固着しうる)。
      throw new Error('応答の生成中です');
    }

    // 案1(C-24): 送信という行為自体が「今はChatをしたい」という意思表示。activeAdapter を
    // Chatへ自動切替する。**黙って切り替えない**ため、切り替えた事実を戻り値でRendererへ返し、
    // 会話ペインに明示させる(chat-pane.md 論点5)。
    let adapterSwitched = false;
    if (this.deps.configStore.current.activeAdapter !== 'chat') {
      this.deps.configStore.update((draft) => {
        draft.activeAdapter = 'chat';
      });
      adapterSwitched = true;
      this.deps.onConfigChanged?.();
    }

    const requestId = this.nextRequestId++;
    const controller = new AbortController();
    this.active = { requestId, controller };

    // 送信時に thinking を**持続**で発火する(lipsync.md)。応答完了まで灯里は考え続ける。
    // Code Adapter の thinking(PreToolUse)は一過性である点が異なる。
    this.deps.engine.trigger('thinking', { sustain: true });

    void this.runStream(requestId, controller.signal);
    return { requestId, adapterSwitched };
  }

  /** 進行中の応答を中断する(停止ボタン)。中断経路でも release は runStream の finally が通す。 */
  stop(): void {
    this.active?.controller.abort(new Error('aborted-by-user'));
  }

  dispose(): void {
    this.disposed = true;
    this.active?.controller.abort(new Error('disposed'));
    this.active = null;
    ipcMain.removeHandler(IPC.ChatSend);
    ipcMain.removeAllListeners(IPC.ChatStop);
  }

  // ── 内部 ───────────────────────────────────────────

  /**
   * streaming本体。**この関数は例外を投げない**(呼び出し元が void で捨てるため)。
   * 成功・失敗・中断のいずれでも finally で release('thinking') と終端イベント送出を行う。
   */
  private async runStream(requestId: number, signal: AbortSignal): Promise<void> {
    const mode = this.deps.configStore.current.chatAdapter.mode;
    let received = '';
    /** 終端イベントは finally で必ず1つ送る。ここに何を送るかを決めていく。 */
    let terminal: ChatStreamEvent | null = null;
    /** 終端後に発火するReaction(分類結果 or エラー時の表情)。releaseの後に出す。 */
    let finalReaction: string | null = null;

    try {
      this.emit({ type: 'start', requestId, origin: mode });

      if (mode === 'mock') {
        received = await streamMockReply(
          (chunk) => {
            received += chunk;
            this.emit({ type: 'chunk', requestId, text: chunk });
          },
          signal,
          this.deps.sleep,
        );
        // 受信完了時に**1度だけ**分類する(streaming中に逐次分類すると百面相になる)。
        // mockの固定返答でも必ず通す(分類経路を日常的に動かし続けるため)。
        const classified = classify(received);
        finalReaction = classified?.state ?? null;
        terminal = { type: 'done', requestId, text: received, state: finalReaction };
      } else {
        // real は #12。**mockの固定返答で代替しない**(chat-adapter-errors.md 論点4:
        // 未接続を隠して固定文を返すと、それがClaudeの回答であるかのように見える)。
        // 素直に「まだ実装されていない」と返す。
        const { kind, message, action } = notImplementedError();
        finalReaction = 'worried';
        terminal = { type: 'error', requestId, kind, message, action };
      }
    } catch (err) {
      if (signal.aborted) {
        // 中断: 分類しない(途中までの本文を分類しても意味が無い)。表情も足さない。
        terminal = { type: 'aborted', requestId, text: received };
      } else {
        finalReaction = 'panic';
        terminal = {
          type: 'error',
          requestId,
          kind: 'retry-exhausted',
          message: `応答の生成に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
          action: 'retry',
        };
      }
    } finally {
      // ── ここが release の全経路保証 ───────────────────────────
      // 成功・失敗・中断・(将来の)無通信タイムアウトのどれで来ても必ず通る。
      if (this.active?.requestId === requestId) {
        this.active = null;
      }
      if (!this.disposed) {
        // release は「現在のReactionがthinkingのときだけ」作用する(EmotionEngine側でno-op)。
        // 応答中にpanic等が割り込んで差し替わっていた場合に、それを消さないための仕様。
        this.deps.engine.release('thinking');
        if (finalReaction !== null && isReactionState(finalReaction)) {
          this.deps.engine.trigger(finalReaction);
        }
      }
      if (terminal !== null) {
        this.emit(terminal);
      }
    }
  }

  private emit(event: ChatStreamEvent): void {
    const win = this.deps.getTargetWindow();
    if (!win || win.isDestroyed()) {
      // 送り先が無いなら実況は捨てる。streaming自体は abort されるまで続くが、
      // ウィンドウが閉じられた時点で送信元も消えているため実害は無い。
      return;
    }
    win.webContents.send(IPC.ChatStream, event);
  }

  private registerIpc(): void {
    ipcMain.handle(IPC.ChatSend, (event: IpcMainInvokeEvent, text: unknown): ChatSendAccepted => {
      if (!this.isSender(event.sender)) {
        throw new Error('この送信元からのチャット送信は許可されていません');
      }
      if (typeof text !== 'string') {
        throw new Error('本文が文字列ではありません');
      }
      return this.send(text);
    });
    ipcMain.on(IPC.ChatStop, (event: IpcMainEvent) => {
      if (!this.isSender(event.sender)) {
        return;
      }
      this.stop();
    });
  }

  /** IPCの送信元が Control Panel ウィンドウのときだけ受け付ける(キャラウィンドウ等を弾く)。 */
  private isSender(sender: Electron.WebContents): boolean {
    const win = this.deps.getTargetWindow();
    return win !== null && !win.isDestroyed() && win.webContents === sender;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('ChatAdapter is disposed');
    }
  }
}

/**
 * real 未実装であることのエラー内容。**panicではなくworried**にするのは、
 * chat-adapter-errors.md が「設定ミスであって異常事態ではない」ものを worried に割り当てて
 * いるのと同じ理由(ユーザーが取れる行動があり、灯里が慌てる状況ではない)。
 * 同mdの表に無い区分のため、この判断はここに明記する(黙って決めない)。
 */
function notImplementedError(): { kind: ChatErrorKind; message: string; action: ChatErrorAction } {
  return {
    kind: 'not-implemented',
    message:
      'real 接続はまだ実装されていません(Anthropic APIへの接続は今後のタスクで対応します)。' +
      'mock の固定返答で代用することはしません。',
    action: 'switch-to-mock',
  };
}
