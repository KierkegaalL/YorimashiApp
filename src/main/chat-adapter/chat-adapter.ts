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
 * - real接続: chat-adapter-errors.md 論点1〜3(#12。実体は real-responder.ts)
 *
 * **mockとrealは経路を共有する**(分類・thinkingのsustain/release・終端イベント・履歴の積み方は
 * どちらも同じコードを通る)。差し替わるのは「本文をどこから得るか」だけ。既定がmockである以上
 * (C-08)、real専用の経路を別に作ると real でしか動かないコードが腐るため。
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
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_INPUT_LENGTH,
  type AtReferenceKey,
  type ChatContentBlock,
  type ChatImageMimeType,
  type ChatSendAccepted,
  type ChatSettingsPatch,
  type ChatSettingsSnapshot,
  type ChatStreamEvent,
  type ChatTurn,
  type ChatUsage,
} from '../../shared/chat';
import type { HookLogSnapshot } from '../../shared/hook-log';
import { assembleReferencedContext } from './context-references';
import { streamMockReply, type Sleep } from './mock-responder';
import { RealChatError, streamRealReply, type AnthropicLike } from './real-responder';

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
  /**
   * `net.isOnline()`(Electron)。**接続可否の事前判定には使わない**。
   * real の通信断エラーの**文言を出し分けるためだけ**に使う(chat-adapter-errors.md 論点2)。
   * 注入にしているのは real-responder.ts を Electron非依存に保つため。
   */
  isOnline?: () => boolean;
  /** 検証で Anthropic SDK クライアントを差し替えるための注入口(本番では未指定)。 */
  createClient?: (options: {
    apiKey: string;
    maxRetries: number;
    timeout: number;
  }) => AnthropicLike;
  /**
   * @参照(C-23)の「作業ログ」が読む直近スナップショット。HookEventLog.getSnapshotを注入する。
   * ログがまだ初期化されていない場合に備え、関数注入にしている(index.tsのモジュール変数は
   * 起動順序によってnullでありうる。resolveも呼び出し時点で行う)。
   */
  getLogSnapshot?: (limit: number) => HookLogSnapshot | null;
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
  /**
   * 会話履歴の**正本**(#12)。real は文脈を渡さないと灯里が毎回記憶喪失になるため必要になった。
   *
   * **メモリのみ・永続化しない**(C-22)。アプリ終了で消え、ディスクには一切書かない。
   * Rendererに持たせて送らせない理由は shared/chat.ts の `ChatTurn` に記載
   * (表示専用の行をAPIへ送らないため / 画面と送信内容が別経路になるのを避けるため)。
   */
  /**
   * **mode不問で単一の配列に積む(意図的)**(reviewer #12 1周目 指摘3)。
   * mockで交わした固定返答も`assistant`ターンとして残り、その後realへ切り替えると
   * 実際のAPIへ「過去に灯里が言った」ことにして送られる。これは容認する: mockは
   * 「何を言ったか」自体が固定文字列(MOCK_REPLY)であり、隠すべき機密でも、ユーザーが
   * 知らない内容でもない(画面に既に表示されている)。mode別に履歴を分けると、
   * 「mockで試してからrealへ切り替える」という最も自然な導線で文脈が失われ、
   * ユーザーから見て「さっきの話を忘れた」という体験になる方が実害が大きいと判断した。
   */
  private turns: ChatTurn[] = [];

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
  send(
    text: string,
    isRetry = false,
    refsRaw: unknown = [],
    attachmentsRaw: unknown = [],
  ): ChatSendAccepted {
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
    // Rendererを信用しない(security.md 5章と同じ姿勢)。型・サイズ・件数はこの関数自身の
    // 責務として検証する(text/MAX_CHAT_INPUT_LENGTHの検証と同じ場所に置く。IPCハンドラ側だけに
    // 検証を置くと、send()を直接呼ぶ経路=このクラス自身の他メソッドや将来の呼び出し元が
    // 無検証な入力を通してしまう)。
    const refs = parseAtReferenceKeys(refsRaw);
    const attachments = parseAttachments(attachmentsRaw);

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

    // @参照(C-23)の文脈組立。選択が無ければ null(=送信本文はユーザー入力のみ)。
    // ユーザーが実際にタイプした文面と結合してからAPIへ送る一方、Rendererの吹き出し表示は
    // 引き続き `trimmed`(生の入力)のみを映す(見えている会話とAPIへ送る内容が意図的に非対称)。
    const referenced = assembleReferencedContext(refs, {
      config: this.deps.configStore.current,
      getLogSnapshot: this.deps.getLogSnapshot ?? (() => null),
    });
    const textContent = referenced !== null ? `${referenced}\n\n${trimmed}` : trimmed;
    const content: ChatTurn['content'] =
      attachments.length === 0
        ? textContent
        : [
            { type: 'text', text: textContent },
            ...attachments.map(
              (a): ChatContentBlock => ({
                type: 'image',
                source: { type: 'base64', media_type: a.mimeType, data: a.base64 },
              }),
            ),
          ];

    // 履歴の更新。**再送/再生成(isRetry)では user ターンを積み直さない**。会話ペイン側も
    // `echoUser=false` で吹き出しを二重に積まない実装(ConversationPane sendText)なので、
    // ここで積むと**画面に見えている会話とAPIへ送る会話がずれる**。あわせて直前の
    // assistant ターン(失敗/中断した応答)を捨て、同じ問いをやり直す形に揃える。
    if (isRetry) {
      if (this.turns.at(-1)?.role === 'assistant') {
        this.turns.pop();
      }
      if (this.turns.at(-1)?.role !== 'user') {
        // 履歴側に対応する user ターンが無い(/clear 後の再送など)。再送は@参照/添付を
        // 渡さない前提(会話ペインのretry経路もテキストのみ)のため、素の trimmed で積み直す。
        this.turns.push({ role: 'user', content: trimmed });
      }
    } else {
      this.turns.push({ role: 'user', content });
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

  /**
   * 会話履歴を消す(`/clear`)。**Main側の履歴が正本**なので、ここを消さないと
   * 画面は空なのに次の送信で過去の文脈がAPIへ送られ続ける。
   * 進行中の応答は中断する(消した会話の続きが後から届くのは辻褄が合わない)。
   */
  reset(): void {
    this.active?.controller.abort(new Error('reset'));
    // abort直後にrunStreamのfinallyが走ってactiveを null化するのを待たず、ここで確定させる。
    // 待つと reset 直後の即時再送が「応答の生成中です」で弾かれる一瞬の隙間ができる。
    this.active = null;
    this.turns = [];
  }

  /** モード設定タブ(FR-7)向け。**APIキー本体は返さない**(security.md 5章)。 */
  getSettings(): ChatSettingsSnapshot {
    const chat = this.deps.configStore.current.chatAdapter;
    const key = chat.anthropicApiKey;
    return {
      mode: chat.mode,
      model: chat.model,
      hasApiKey: key.length > 0,
      apiKeyTail: key.length > 0 ? key.slice(-4) : '',
    };
  }

  /** モード設定タブからの更新。省略したフィールドは変更しない。 */
  updateSettings(patch: ChatSettingsPatch): ChatSettingsSnapshot {
    this.assertNotDisposed();
    this.deps.configStore.update((draft) => {
      if (patch.mode !== undefined) {
        draft.chatAdapter.mode = patch.mode;
      }
      if (patch.model !== undefined) {
        draft.chatAdapter.model = patch.model;
      }
      if (patch.apiKey !== undefined) {
        // 前後の空白は落とす。コピー&ペーストで混入した改行や空白がそのまま401になるのは
        // ユーザーには原因が見えない失敗になるため。
        draft.chatAdapter.anthropicApiKey = patch.apiKey.trim();
      }
    });
    this.deps.onConfigChanged?.();
    return this.getSettings();
  }

  dispose(): void {
    this.disposed = true;
    this.active?.controller.abort(new Error('disposed'));
    this.active = null;
    this.turns = [];
    ipcMain.removeHandler(IPC.ChatSend);
    ipcMain.removeHandler(IPC.ChatSettingsGet);
    ipcMain.removeHandler(IPC.ChatSettingsSet);
    ipcMain.removeAllListeners(IPC.ChatStop);
    ipcMain.removeAllListeners(IPC.ChatReset);
  }

  // ── 内部 ───────────────────────────────────────────

  /**
   * streaming本体。**この関数は例外を投げない**(呼び出し元が void で捨てるため)。
   * 成功・失敗・中断のいずれでも finally で release('thinking') と終端イベント送出を行う。
   */
  private async runStream(requestId: number, signal: AbortSignal): Promise<void> {
    // **reset()との競合対策**(reviewer #12 1周目 指摘2・重大)。reset()は`this.turns`を
    // 新しい配列へ**差し替える**(空にする)ため、この関数の開始時点の参照を覚えておき、
    // 応答を積む直前に「まだ同じ会話か」を確認する。確認しないと、reset後に遅れて届いた
    // 応答が新しい(空の)履歴へ`assistant`から積まれ、先頭がuserでない不正な配列になる
    // (Messages APIは先頭userを要求するため、次回送信が400になりうる)。
    const turnsAtStart = this.turns;
    const pushAssistantTurn = (content: string): void => {
      if (this.turns === turnsAtStart) {
        this.turns.push({ role: 'assistant', content });
      }
    };
    const chatConfig = this.deps.configStore.current.chatAdapter;
    const mode = chatConfig.mode;
    let received = '';
    /** real のみ。取れなければ null のまま(**推測値を出さない**)。 */
    let usage: ChatUsage | null = null;
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
        // mock は実際にトークンを消費していないので usage は常に null(誇張して見せない)。
        terminal = { type: 'done', requestId, text: received, state: finalReaction, usage: null };
      } else {
        const result = await streamRealReply({
          apiKey: chatConfig.anthropicApiKey,
          model: chatConfig.model,
          idleTimeoutMs: chatConfig.idleTimeoutMs,
          maxRetries: chatConfig.maxRetries,
          timeout: chatConfig.timeout,
          turns: this.turns,
          onChunk: (chunk) => {
            received += chunk;
            this.emit({ type: 'chunk', requestId, text: chunk });
          },
          signal,
          isOnline: this.deps.isOnline ?? (() => true),
          createClient: this.deps.createClient,
        });
        received = result.text;
        usage = result.usage;
        // mock と**同じ経路で**分類する(realだけ別扱いにすると片方が腐る)。
        const classified = classify(received);
        finalReaction = classified?.state ?? null;
        terminal = { type: 'done', requestId, text: received, state: finalReaction, usage };
      }
      // 応答を履歴へ積む(次のターンの文脈になる)。空文字は積まない。
      if (received.length > 0) {
        pushAssistantTurn(received);
      }
    } catch (err) {
      if (signal.aborted) {
        // 中断: 分類しない(途中までの本文を分類しても意味が無い)。表情も足さない。
        // **途中まで受信した本文は履歴へ積む**。画面にはそれが表示されたままであり、
        // 積まないと「見えている会話」と「APIへ送る会話」がずれる(嘘をつかない)。
        // ただし reset() 由来の中断(turnsAtStart が既に差し替わっている)では積まない
        // (消した会話の続きを新しい会話の先頭へ紛れ込ませない)。
        if (received.length > 0) {
          pushAssistantTurn(received);
        }
        terminal = { type: 'aborted', requestId, text: received };
      } else if (err instanceof RealChatError) {
        // real の失敗は種別ごとに表情を変える(chat-adapter-errors.md 論点1の表)。
        // 設定ミス(401/400/404)は worried、リトライ尽き・無通信は panic。
        finalReaction = err.kind === 'configuration' ? 'worried' : 'panic';
        terminal = {
          type: 'error',
          requestId,
          kind: err.kind,
          message: err.message,
          action: err.action,
        };
        // 失敗した応答は履歴へ積まない(次のターンの文脈にしない)。直前の user ターンは
        // 残すので、「再送する」を押せば同じ問いをそのままやり直せる。
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
      // 成功・失敗・中断・無通信タイムアウトのどれで来ても必ず通る(#12でrealの
      // 無通信ウォッチドッグが実際に到達する経路になった)。
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
    ipcMain.handle(
      IPC.ChatSend,
      (
        event: IpcMainInvokeEvent,
        text: unknown,
        isRetry: unknown,
        refs: unknown,
        attachments: unknown,
      ): ChatSendAccepted => {
        if (!this.isSender(event.sender)) {
          throw new Error('この送信元からのチャット送信は許可されていません');
        }
        if (typeof text !== 'string') {
          throw new Error('本文が文字列ではありません');
        }
        return this.send(text, isRetry === true, refs, attachments);
      },
    );
    ipcMain.on(IPC.ChatStop, (event: IpcMainEvent) => {
      if (!this.isSender(event.sender)) {
        return;
      }
      this.stop();
    });
    ipcMain.on(IPC.ChatReset, (event: IpcMainEvent) => {
      if (!this.isSender(event.sender)) {
        return;
      }
      this.reset();
    });
    ipcMain.handle(IPC.ChatSettingsGet, (event: IpcMainInvokeEvent): ChatSettingsSnapshot => {
      if (!this.isSender(event.sender)) {
        throw new Error('この送信元からの設定取得は許可されていません');
      }
      return this.getSettings();
    });
    ipcMain.handle(
      IPC.ChatSettingsSet,
      (event: IpcMainInvokeEvent, patch: unknown): ChatSettingsSnapshot => {
        if (!this.isSender(event.sender)) {
          throw new Error('この送信元からの設定変更は許可されていません');
        }
        return this.updateSettings(parseSettingsPatch(patch));
      },
    );
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
 * Rendererから来た設定パッチを検証する。**Rendererを信用しない**(security.md 5章)。
 * 未知のフィールドは無視し、型が違うものは弾く。APIキーは文字列であること以外を検査しない
 * (`sk-ant-`前提の形式チェックは入れない。将来キーの体裁が変わったときに、
 * 正しいキーをアプリが勝手に拒否する側の事故になるため。正しさはAPIが401で答える)。
 */
function parseSettingsPatch(patch: unknown): ChatSettingsPatch {
  if (typeof patch !== 'object' || patch === null) {
    throw new Error('設定の指定が不正です');
  }
  const raw = patch as Record<string, unknown>;
  const result: ChatSettingsPatch = {};
  if (raw.mode !== undefined) {
    if (raw.mode !== 'mock' && raw.mode !== 'real') {
      throw new Error('mode の指定が不正です');
    }
    result.mode = raw.mode;
  }
  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || raw.model.length === 0) {
      throw new Error('model の指定が不正です');
    }
    result.model = raw.model;
  }
  if (raw.apiKey !== undefined) {
    if (typeof raw.apiKey !== 'string') {
      throw new Error('APIキーの指定が不正です');
    }
    result.apiKey = raw.apiKey;
  }
  return result;
}

const KNOWN_AT_REFERENCE_KEYS: readonly AtReferenceKey[] = ['logs', 'model', 'settings'];

/** @参照のキー配列を検証する。未知のキーは黙って無視せず拒否する(不正な入力に気づけるように)。 */
function parseAtReferenceKeys(raw: unknown): AtReferenceKey[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('@参照の指定が不正です');
  }
  return raw.map((key) => {
    if (typeof key !== 'string' || !KNOWN_AT_REFERENCE_KEYS.includes(key as AtReferenceKey)) {
      throw new Error('@参照の指定が不正です');
    }
    return key as AtReferenceKey;
  });
}

/** `data:image/(jpeg|png|gif|webp);base64,<...>` の形だけを許可する(SDKが受け付ける4形式)。 */
const ATTACHMENT_DATA_URL_RE = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+=*)$/;

/**
 * 添付(C-23)のペイロードを検証する。**Rendererを信用しない**(security.md 5章と同じ姿勢)。
 * `ChatAttachment.dataUrl`(選択時にMainが返した値をRendererがそのまま送り返したもの)しか
 * 受け付けない — Renderer由来の任意パスやBlobURLを読みに行く経路は作らない。
 *
 * 件数・形式・サイズを検証し、SDKへ渡す最小限の形({mimeType, base64})だけを返す
 * (`id`/`name`/`dataUrl`はここでは不要)。
 */
function parseAttachments(raw: unknown): { mimeType: ChatImageMimeType; base64: string }[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('添付の指定が不正です');
  }
  if (raw.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`添付できる画像は最大${MAX_CHAT_ATTACHMENTS}件です`);
  }
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('添付の指定が不正です');
    }
    const dataUrl = (item as Record<string, unknown>).dataUrl;
    if (typeof dataUrl !== 'string') {
      throw new Error('添付の指定が不正です');
    }
    const match = ATTACHMENT_DATA_URL_RE.exec(dataUrl);
    if (!match) {
      throw new Error('対応していない画像形式です(jpeg/png/gif/webpのみ)');
    }
    const [, mimeType, base64] = match;
    // base64は3バイトを4文字で表すため、デコード後サイズは概算でよい(パディング込みでも
    // 実サイズを超えて評価することはなく、上限チェックとして安全側に働く)。
    const approxBytes = Math.floor((base64!.length * 3) / 4);
    if (approxBytes > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(
        `添付画像が大きすぎます(最大${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024 / 1024)}MB)`,
      );
    }
    return { mimeType: mimeType as ChatImageMimeType, base64: base64! };
  });
}
