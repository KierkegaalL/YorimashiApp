/**
 * ローカルサーバー(FR-2/FR-13)。api.md 2章・security.md が正本。
 *
 * 要件:
 * - 127.0.0.1 限定バインド(0.0.0.0にしない。security.md 2章)
 * - ポート8765既定。競合(EADDRINUSE)時は順次別ポートを試し、実際の値を返す
 *   (呼び出し側が config.codeAdapter.serverPort へ保存する。environments.md)
 * - 全リクエストにトークン認証(X-App-Token)。ただし `/panel`・`/character` の
 *   HTML配信のみ認証不要(トークンはHTML内に埋め込む。security.md 3章)
 * - `/panel`・`/character` に CSP `frame-ancestors 'self'`(クリックジャッキング対策。security.md 4章)
 * - `GET /models/*` は認証 + パス検証(パストラバーサル対策。security.md 6・7章)
 * - `WS /ws?token=...` は upgrade 時にトークン検証し、EmotionEngineの状態を配信(api.md 3章)
 *
 * このモジュールはGUIを伴わずに検証できる(http/wsクライアントで叩ける。
 * .claude/rules/build-commands.md「サンドボックスで可能な検証」)。
 *
 * 形式非依存: `GET /models/*` はLive2D/スプライトセット双方のアセット(moc3/model3.json/
 * webp等)を区別せず一律配信し、WS配信も形式を意識しない解決済み状態(EmotionSnapshot)を
 * 流すだけである。よって対称性チェック(CLAUDE.md原則4)の対象外(黙って片方だけ書いた実装漏れ
 * ではない)。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import type { EmotionEngine } from '../emotion-engine';
import {
  type ServerToClientMessage,
  WS_PATH,
  WS_TOKEN_QUERY_KEY,
} from '../../shared/ws-messages';
import {
  BOOTSTRAP_MODEL_GLOBAL,
  BOOTSTRAP_TOKEN_GLOBAL,
  type CharacterBootstrapModel,
} from '../../shared/bootstrap';
import type { HookEventPayload } from '../../shared/hook-events';
import { tokensMatch } from './auth-token';
import { resolveWithinBase } from './safe-path';

const AUTH_HEADER = 'x-app-token';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MAX_PORT_ATTEMPTS = 20;
const DEFAULT_MAX_HOOK_BODY_BYTES = 1_048_576; // 1MiB

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.moc': 'application/octet-stream',
  '.moc3': 'application/octet-stream',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * hooksイベントのペイロード。中身の解釈はCode Adapter(FR-2)が行う。
 * 型の正本は shared/hook-events.ts(受信側とオンボーディングのテンプレートが同じ
 * イベント定義を参照するため)。ここでは再エクスポートのみ行い、二重定義にしない。
 */
export type { HookEventPayload };

export interface LocalServerOptions {
  /** 共有トークン(auth-token.ts で生成/読込したもの)。 */
  authToken: string;
  /** 希望ポート(config.codeAdapter.serverPort)。競合時は +1 ずつ試す。 */
  preferredPort: number;
  /** ポート探索の最大試行回数(既定20)。 */
  maxPortAttempts?: number;
  /** バインドホスト(既定 127.0.0.1)。テスト以外で変更しない。 */
  host?: string;
  /** WSで状態を配信する対象のEmotionEngine。 */
  engine: EmotionEngine;
  /** ビルド済みRendererのルート(out/renderer)。/panel・/character・静的資産の配信元。 */
  rendererRoot: string;
  /** /panel が返すエントリHTML(rendererRoot相対)。 */
  panelEntry?: string;
  /** /character が返すエントリHTML(rendererRoot相対)。 */
  characterEntry?: string;
  /** GET /models/* の配信ルート(userData/models)。 */
  modelsRoot: string;
  /** POST /hook 受信時のハンドラ(Code Adapter #9 が接続)。 */
  onHookEvent?: (event: HookEventPayload) => void;
  /** POST /hook のボディ上限バイト数(既定1MiB)。 */
  maxHookBodyBytes?: number;
  /**
   * /character のHTMLに埋め込む「今描画すべきアクティブモデル」を返す(FR-5)。configから解決した
   * ものを index.ts が渡す。モデル未導入なら null。/panel には埋め込まない(プレビュー対象は
   * アクティブモデルとは別に選ぶため)。
   */
  getCharacterBootstrap?: () => CharacterBootstrapModel | null;
}

export class LocalServer {
  private readonly authToken: string;
  private readonly preferredPort: number;
  private readonly maxPortAttempts: number;
  private readonly host: string;
  private readonly engine: EmotionEngine;
  private readonly rendererRoot: string;
  private readonly panelEntry: string;
  private readonly characterEntry: string;
  private readonly modelsRoot: string;
  private readonly onHookEvent?: (event: HookEventPayload) => void;
  private readonly maxHookBodyBytes: number;
  private readonly getCharacterBootstrap?: () => CharacterBootstrapModel | null;

  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private unsubscribe: (() => void) | null = null;
  private boundPort: number | null = null;

  constructor(options: LocalServerOptions) {
    this.authToken = options.authToken;
    this.preferredPort = options.preferredPort;
    this.maxPortAttempts = options.maxPortAttempts ?? DEFAULT_MAX_PORT_ATTEMPTS;
    this.host = options.host ?? DEFAULT_HOST;
    this.engine = options.engine;
    this.rendererRoot = path.resolve(options.rendererRoot);
    this.panelEntry = options.panelEntry ?? 'control-panel/index.html';
    this.characterEntry = options.characterEntry ?? 'character/index.html';
    this.modelsRoot = path.resolve(options.modelsRoot);
    this.onHookEvent = options.onHookEvent;
    this.maxHookBodyBytes = options.maxHookBodyBytes ?? DEFAULT_MAX_HOOK_BODY_BYTES;
    this.getCharacterBootstrap = options.getCharacterBootstrap;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        // ハンドラ内の想定外例外。500で閉じる(詳細はクライアントへ漏らさない)。
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end('Internal Server Error');
        console.error('[local-server] request handler error:', err);
      });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws) => {
      // 接続直後に現在の状態を1回送る(クライアントが初期表示を即決められるように)。
      this.sendTo(ws, { type: 'emotion', snapshot: this.engine.getSnapshot() });
    });
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  /** 現在バインド済みのポート。start()前はnull。 */
  get port(): number | null {
    return this.boundPort;
  }

  /**
   * サーバーを起動する。希望ポートから順に空きを探し、成功したポートを返す。
   * EmotionEngineの購読もここで開始する。
   */
  async start(): Promise<number> {
    for (let attempt = 0; attempt < this.maxPortAttempts; attempt++) {
      const port = this.preferredPort + attempt;
      try {
        await this.listenOn(port);
        this.boundPort = port;
        // 起動成功後にEmotionEngineを購読し、状態変化をWSへブロードキャストする。
        this.unsubscribe = this.engine.subscribe((snapshot) => {
          this.broadcast({ type: 'emotion', snapshot });
        });
        return port;
      } catch (err) {
        if (isAddrInUse(err)) {
          continue; // 次のポートを試す
        }
        throw err;
      }
    }
    throw new Error(
      `ローカルサーバーの空きポートが見つかりません(試行: ${this.preferredPort}〜${
        this.preferredPort + this.maxPortAttempts - 1
      })`,
    );
  }

  /** サーバーとWSを停止し、EmotionEngineの購読を解除する。 */
  async stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));

    // start()が一度もlistenに成功していない(起動失敗・未起動)場合、server.close()は
    // ERR_SERVER_NOT_RUNNINGを返す。boundPortがnullならHTTPサーバーは動いていないので
    // closeをスキップする(will-quitのfire-and-forget呼び出しでunhandled rejectionにしない)。
    if (this.boundPort !== null) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((err) => (err ? reject(err) : resolve()));
      });
      this.boundPort = null;
    }
  }

  // ── HTTP ────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let pathname: string;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, 400, 'Bad Request');
    }

    // POST /hook — 認証必須。dispatch.shから叩かれる(api.md 1章)。
    if (pathname === '/hook') {
      if (req.method !== 'POST') {
        return sendMethodNotAllowed(res, 'POST');
      }
      if (!this.isAuthorizedHeader(req)) {
        return sendText(res, 401, 'Unauthorized');
      }
      return this.handleHook(req, res);
    }

    if (req.method !== 'GET') {
      return sendMethodNotAllowed(res, 'GET');
    }

    // /panel・/character — 認証不要、トークンをHTMLに埋め込み、CSPを付与する。
    if (pathname === '/panel' || pathname === '/panel/') {
      // /panel にはアクティブモデルを埋め込まない(プレビュー対象は別に選ぶ。model-mapping-ui.md)。
      return this.serveEntryHtml(res, this.panelEntry, null);
    }
    if (pathname === '/character' || pathname === '/character/') {
      // /character には「今描画すべきアクティブモデル」を埋め込む(未導入なら null)。
      const model = this.getCharacterBootstrap?.() ?? null;
      return this.serveEntryHtml(res, this.characterEntry, model);
    }

    // /models/* — 認証 + パス検証(security.md 6・7章)。
    if (pathname === '/models' || pathname.startsWith('/models/')) {
      if (!this.isAuthorizedHeader(req)) {
        return sendText(res, 401, 'Unauthorized');
      }
      const rest = pathname.slice('/models'.length); // 先頭スラッシュ込み
      return this.serveFromBase(res, this.modelsRoot, rest);
    }

    // それ以外のGETはRendererの静的資産(バンドルJS/CSS等)。公開扱い(HTMLと同格)。
    return this.serveFromBase(res, this.rendererRoot, pathname);
  }

  private isAuthorizedHeader(req: IncomingMessage): boolean {
    const header = req.headers[AUTH_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    return tokensMatch(this.authToken, value);
  }

  private async handleHook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    for await (const chunk of req) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > this.maxHookBodyBytes) {
        aborted = true;
        break;
      }
      chunks.push(buf);
    }

    if (aborted) {
      // 残りのボディを読み切らないままレスポンスするとkeep-alive接続が宙に浮くため、
      // リクエストを破棄してソケットを片付ける(可用性NFR)。
      req.destroy();
      return sendText(res, 413, 'Payload Too Large');
    }

    let payload: HookEventPayload;
    try {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const parsed: unknown = raw.length === 0 ? {} : JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return sendText(res, 400, 'Bad Request');
      }
      payload = parsed as HookEventPayload;
    } catch {
      return sendText(res, 400, 'Bad Request');
    }

    // ハンドラ内の例外がレスポンスを妨げないよう隔離する(可用性: dispatch.shは常にexit 0)。
    try {
      this.onHookEvent?.(payload);
    } catch (err) {
      console.error('[local-server] onHookEvent handler threw:', err);
    }
    res.writeHead(204).end();
  }

  private async serveEntryHtml(
    res: ServerResponse,
    entryRelative: string,
    bootstrapModel: CharacterBootstrapModel | null,
  ): Promise<void> {
    const filePath = resolveWithinBase(this.rendererRoot, entryRelative);
    if (filePath === null) {
      return sendText(res, 500, 'Internal Server Error');
    }
    let html: string;
    try {
      html = await readFile(filePath, 'utf-8');
    } catch {
      // ビルド未実施等。開発中に気付けるよう404で返す。
      return sendText(res, 404, 'Not Found');
    }

    const injected = this.injectBootstrap(html, bootstrapModel);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // クリックジャッキング対策: 自オリジン以外からの埋め込みを拒否(security.md 4章)。
      'Content-Security-Policy': "frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(injected);
  }

  /**
   * トークン(と、あればアクティブモデル)をHTMLの`<head>`に埋め込む(security.md 3章 / bootstrap.ts)。
   * 別オリジンのサイトがiframeで埋め込んでも同一オリジンポリシーにより読めない。
   * JSON.stringify は `</script>` を含みうる文字列を安全化するため `<` をエスケープする。
   */
  private injectBootstrap(html: string, model: CharacterBootstrapModel | null): string {
    const assigns = [
      `window.${BOOTSTRAP_TOKEN_GLOBAL}=${jsonForScript(this.authToken)};`,
      `window.${BOOTSTRAP_MODEL_GLOBAL}=${jsonForScript(model)};`,
    ];
    const tag = `<script>${assigns.join('')}</script>`;
    const headClose = html.indexOf('</head>');
    if (headClose !== -1) {
      return html.slice(0, headClose) + tag + html.slice(headClose);
    }
    return tag + html;
  }

  private async serveFromBase(
    res: ServerResponse,
    baseDir: string,
    requestPath: string,
  ): Promise<void> {
    const filePath = resolveWithinBase(baseDir, requestPath);
    if (filePath === null) {
      // パストラバーサル試行。存在有無を漏らさないよう403で一律に弾く。
      return sendText(res, 403, 'Forbidden');
    }
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return sendText(res, 404, 'Not Found');
    }
    if (!info.isFile()) {
      return sendText(res, 404, 'Not Found');
    }

    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
    });
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
    stream.pipe(res);
  }

  // ── WebSocket ───────────────────────────────────────

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return rejectUpgrade(socket, 400, 'Bad Request');
    }

    if (url.pathname !== WS_PATH) {
      return rejectUpgrade(socket, 404, 'Not Found');
    }

    const token = url.searchParams.get(WS_TOKEN_QUERY_KEY);
    if (!tokensMatch(this.authToken, token)) {
      return rejectUpgrade(socket, 401, 'Unauthorized');
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  private broadcast(message: ServerToClientMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }

  private sendTo(ws: WebSocket, message: ServerToClientMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private listenOn(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => {
        this.server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, this.host);
    });
  }
}

/**
 * インラインの `<script>` に安全に埋め込めるJSONを作る。`<`(→`</script>`ブレイクアウト)と
 * 行区切り文字(U+2028/U+2029、JS文字列リテラルで不正)をエスケープする。
 */
function jsonForScript(value: unknown): string {
  // インラインの <script> に安全に埋め込むためのエスケープ。
  // - `<` -> `\u003c`: `</script>` によるブレイクアウトを防ぐ。
  // - U+2028 / U+2029(行区切り文字): JS文字列リテラルでは不正なので畳む。正規表現リテラル
  //   `/\u2028/g` は当該コードポイントにマッチし、置換で valid な6文字表現(バックスラッシュ+u+2028)を出す。
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: allow });
  res.end('Method Not Allowed');
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
}
