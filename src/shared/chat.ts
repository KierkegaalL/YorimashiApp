/**
 * Chat Adapter(FR-3)のMain↔Renderer共有契約。
 * 正本: docs/detailed-design/chat-pane.md 論点3(送信から表示までの経路)・論点4(エラーの見せ方)、
 *       lipsync.md 論点4(mockも擬似streamingで流す)、chat-adapter-errors.md。
 *
 * **APIキーを扱うのはMainのみ**(security.md 5章)。Rendererは本文とイベントだけを受け取り、
 * `anthropicApiKey`・SDKクライアント・モデル選択の実体には一切触れない。
 *
 * 会話履歴は**永続化しない**(C-22)。ここで定義するのは「1回の送信に対する実況」の型であり、
 * 履歴そのものはRendererのメモリ上にしか存在しない。保持期間・パーミッション・削除UI・
 * エクスポート時のマスクのいずれも未決のまま永続化を始めると、最も機微なデータが最も無管理に
 * 溜まるため(chat-pane.md 論点2)。
 *
 * 形式非依存: Live2D/スプライトセットのどちらも意識しない(会話ペインはキャラ描画を持たず、
 * EmotionEngineへtrigger/releaseを送るだけ)。よって対称性チェック(CLAUDE.md原則4)の対象外。
 */

/** 応答の生成元。UIが「これはmockの固定返答である」と明示するために使う。 */
export type ChatOrigin = 'mock' | 'real';

/**
 * @参照(C-23 / chat-pane.md 論点7)。**ユーザーが明示選択する3つの固定対象のみ**で、
 * 本文の文字列から任意のパス・キーを解決する経路は持たない(security.md 6章)。
 * ラベル(表示文言)はRenderer側のカタログ(catalog.ts の AT_REFERENCES)が持つ。ここは
 * Main/Renderer両方が参照するキーの単一の情報源。
 */
export type AtReferenceKey = 'logs' | 'model' | 'settings';

/** Anthropic Messages API が画像として受け付けるMIMEタイプ(SDK 0.112.3の型定義と一致させる)。 */
export type ChatImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Anthropic Messages API へそのまま渡せる形のコンテンツブロック(画像添付のみ。文書(PDF等)は
 * 現状スコープ外 — chat-pane.md 論点7の「添付」は当面画像に限定する。SDKの
 * `ImageBlockParam`/`TextBlockParam`と構造的に一致させてあり、real-responder.tsは
 * キャストなしでそのままSDKへ渡せる)。
 */
export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: ChatImageMimeType; data: string } };

/**
 * 添付の上限サイズ(バイト)。**実測に基づく値ではない暫定値**(Anthropic API自体の上限より
 * 十分小さく、かつ会話ペインの用途で困らない値の目安。MAX_MODEL_NAME_LENGTHと同じ扱い)。
 */
export const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** 1回の送信に添付できる画像の上限数。 */
export const MAX_CHAT_ATTACHMENTS = 4;

/**
 * 添付画像(C-23。real時のみUIから選べる)。
 *
 * **選択直後にMainがファイルを読み込み、この形でRendererへ返す**(ファイルパスは一切渡さない。
 * security.md 6章「添付はダイアログで選んだファイルに限定」と同じ不変条件)。Rendererはこれを
 * プレビュー表示に使い、送信時は**同じ値をそのままMainへ返す**(Main側で再度パスを扱わない
 * ため、選択時に読み込んだ実データがそのまま送信の実体になる)。
 */
export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: ChatImageMimeType;
  sizeBytes: number;
  /** `data:`URL。`<img src>`にそのまま使える。 */
  dataUrl: string;
}

/**
 * 失敗の種別。UIはこれに応じて添えるボタンを変える(chat-pane.md 論点4)。
 * **mockへの自動フォールバックはしない**(chat-adapter-errors.md 論点4)。ボタンを添えて
 * ユーザーが明示的に押したときだけ切り替える。黙って落とすと、ユーザーの質問に対して
 * あらかじめ用意された固定文がClaudeの回答であるかのように返ることになる。
 */
export type ChatErrorKind =
  /** リトライを尽くして失敗(429/5xx/通信断)。灯里はpanic。「モックモードに切り替える」ボタン。 */
  | 'retry-exhausted'
  /** 401/400/404 等のリトライ不能な設定ミス。灯里はworried。「モード設定を開く」ボタン。 */
  | 'configuration'
  /** 無通信ウォッチドッグが切った。灯里はpanic。再送ボタン。 */
  | 'idle-timeout';

/**
 * UIがエラー吹き出しに添えるアクション(chat-pane.md 論点4の表)。
 * `open-billing-page`(issue #16)はクレジット残高不足の専用導線。「モード設定を開く」では
 * 直せない(Anthropic側の課金ページでの対応が要る)ため区別する。
 */
export type ChatErrorAction =
  | 'switch-to-mock'
  | 'open-adapter-settings'
  | 'open-billing-page'
  | 'retry'
  | 'none';

/**
 * 1回の送信に対してMainからRendererへ流れるイベント。
 * `start` → `chunk`* → (`done` | `error` | `aborted`) で必ず終端する。
 *
 * **不変条件(Renderer側の実装が依存している)**:
 *  1. `start` は必ず最初に、他のどのイベントよりも先に届く。Main側は streaming 本体の
 *     `try` に入った直後・最初の await より前に同期的に送出する(chat-adapter.ts runStream)。
 *     Rendererはこれを前提に「start で吹き出しを作り、以降のチャンクをそこへ追記する」
 *     実装になっているため、**この順序を崩す変更をしてはならない**。
 *  2. **終端イベントは全経路で必ず1回送る**(送らないとRendererの「考えています…」が
 *     残り続ける)。Main側の`release('thinking')`と同じ理由で、成功・失敗・中断・
 *     タイムアウトのすべてで保証する。
 */
export type ChatStreamEvent =
  /** 応答の開始。Rendererはこの時点で空のアシスタント吹き出しを作る。 */
  | { type: 'start'; requestId: number; origin: ChatOrigin }
  /** 受信チャンク。Rendererは最後の吹き出しへ**追記**する(差し替えない)。 */
  | { type: 'chunk'; requestId: number; text: string }
  /**
   * 受信完了。`text`は結合済みの全文(Rendererの追記結果と一致するはずの正)。
   * `state`は受信完了時に1度だけ実行した分類結果(該当なしならnull。emotion-classification.md)。
   */
  | {
      type: 'done';
      requestId: number;
      text: string;
      state: string | null;
      /** real のみ。取得できなかった場合は null で、**UIは推測値を出さない**(下記 ChatUsage)。 */
      usage: ChatUsage | null;
    }
  /** ユーザーが停止ボタンで中断した。`text`はそこまでに受信済みの本文。 */
  | { type: 'aborted'; requestId: number; text: string }
  /** 失敗。`message`はそのままUIに出す文言(Mainが状況に応じて出し分ける)。 */
  | { type: 'error'; requestId: number; kind: ChatErrorKind; message: string; action: ChatErrorAction };

/**
 * real 応答1回の実トークン使用量(Anthropic APIの `usage` をそのまま持つ)。
 *
 * **mock では常に null**。mock は固定返答であって実際にトークンを消費しておらず、
 * それらしい数値を出せば嘘になる(chat-pane.md 論点7「mock時は実測値を持たないため
 * 誇張して見せない」・constraints.md)。real でも `usage` が欠けていれば null にする。
 */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Anthropic Messages API へ送る1ターン。**会話履歴の正本はMain**(chat-adapter.ts)で、
 * Rendererの `ChatMessage[]` は表示用の写しである。
 *
 * Rendererから履歴を送らせない理由: 送らせると「画面に見えているもの」と「実際にAPIへ
 * 送ったもの」が別経路になり、両者がずれても誰も気づけない。system メッセージ
 * (「Chat Adapter に切り替えました。」等)やエラー吹き出しのように**APIへ送ってはならない
 * 表示専用の行**もあるため、送信内容の決定はMain側に閉じる。
 *
 * 永続化しないのは変わらない(C-22)。Main のこの履歴もメモリ上にしか存在せず、
 * アプリ終了で消える。`/clear` は Main の履歴も消す(ChatReset)。
 *
 * `content`が配列になるのは**添付画像を伴うuserターンのみ**(@参照で組み立てた文脈とユーザーの
 * 発話は、テキストブロック1つに結合してから積む。マルチテキストブロックにはしない)。
 * assistantターンは常に文字列(応答は常にテキストのみで、画像を生成しないため)。
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string | ChatContentBlock[];
}

/**
 * Chat Adapter の設定のうち、モード設定タブ(FR-7)が読み書きするもの。
 *
 * **APIキーの値そのものは決してRendererへ返さない**(security.md 5章「APIキーを扱うのは
 * Mainのみ」)。返すのは「設定されているか」と、確認用の末尾4文字だけ。画面に平文の
 * キーを描くと、スクリーンショット・画面共有・DevToolsのいずれからも漏れうる。
 */
export interface ChatSettingsSnapshot {
  mode: 'mock' | 'real';
  model: string;
  /** APIキーが設定済みか。**キー本体は含めない**。 */
  hasApiKey: boolean;
  /** 設定済みのキーの末尾4文字(未設定なら空文字)。取り違えの確認だけに使う。 */
  apiKeyTail: string;
}

/** モード設定タブからの変更要求。`apiKey` を省略した場合はキーを変更しない。 */
export interface ChatSettingsPatch {
  mode?: 'mock' | 'real';
  model?: string;
  /** 空文字を明示的に渡すとキーを削除する(「設定しない」も正当な操作)。 */
  apiKey?: string;
}

/**
 * 送信要求に対するMainの即時応答(streamの中身ではなく受理可否)。
 * `adapterSwitched`は案1(C-24)の明示に使う: 送信時に`activeAdapter`をChatへ自動切替した場合、
 * **黙って切り替えず**Rendererがその旨を会話ペインに表示する。
 */
export interface ChatSendAccepted {
  requestId: number;
  /** この送信のために activeAdapter を 'code' → 'chat' へ自動切替したなら true(C-24)。 */
  adapterSwitched: boolean;
}

/** 会話ペインの入力欄が扱える最大文字数(過大な入力でMainを詰まらせない防御)。 */
export const MAX_CHAT_INPUT_LENGTH = 8000;

/**
 * Renderer が表示・操作するモード類。**正本は config(Main)** で、Rendererのstateはその写し。
 *
 * Renderer側だけで持つと「UI上はmockなのに実際はrealへ送る」「Trayでアダプタを切り替えても
 * 会話ペインの表示が追従しない」といった食い違いが起きる。これは
 * constraints.md「アプリが自分の状態について嘘をつかない」に反するため、
 * 取得も変更も必ずMainを経由する(ChatConfigGet / ChatConfigSet / ChatConfigChanged)。
 */
export interface ChatConfigSnapshot {
  /** FR-1 のアダプタ(config.activeAdapter)。 */
  activeAdapter: 'code' | 'chat';
  /** Chat Adapter の動作モード(config.chatAdapter.mode)。既定 mock(C-08)。 */
  chatMode: 'mock' | 'real';
  /** real時にユーザーが選ぶ応答モデル(config.chatAdapter.model)。mockでは未使用(C-23)。 */
  model: string;
}

/** モード変更要求(指定したキーだけを更新する)。 */
export type ChatConfigPatch = Partial<ChatConfigSnapshot>;
