/**
 * ウィンドウ/セッションのセキュリティ強化(FR-13 / security.md 5章「Electronプロセス自体の基本強化」対策8)。
 *
 * 背景: キャラクター表示ウィンドウ・Control Panel ウィンドウはどちらも `http://127.0.0.1:<port>`
 * (prod)/ Vite の dev サーバー(dev)という **通常の HTTP オリジン** から読み込む(security.md 7章。
 * カスタムプロトコルを使わないのは WebCodecs が secure context を要するため)。通常オリジンで読む以上、
 * `contextIsolation`/`sandbox`(5章)だけでは塞げない露出面が残る:
 *
 *  1. **外部ナビゲーション**: レンダラー内のリンク・`window.location`・万一の XSS で、ウィンドウ自体が
 *     自オリジン外の任意 URL へ遷移してしまう(枠なし・最前面のキャラウィンドウが乗っ取られると復帰手段が無い)。
 *  2. **新規ウィンドウ**: `window.open` で Electron の子ウィンドウ(nodeIntegration の既定が付く恐れ)を開かれる。
 *  3. **権限要求**: `getUserMedia`(カメラ/マイク)・位置情報・通知等の Web 権限。**このアプリはどれも使わない**
 *     (動画デコードは WebCodecs で権限不要、クリップボードは Main 側の `clipboard` を使う)。既定で許可される
 *     余地を残さない。
 *
 * いずれも Electron 公式のセキュリティチェックリスト(navigation の制限・新規ウィンドウの拒否・権限要求の
 * ハンドリング)に沿う防御的強化で、機能要件は変えない。`will-navigate` は **レンダラー起点の遷移**でのみ
 * 発火し、`webContents.loadURL()` による**アプリ起点の再読込(applyActiveModel/reloadIfApplied)では発火しない**
 * ため、モデル切替やマッピング反映の再読込は妨げない。同一オリジンの遷移(dev の HMR フルリロード=
 * `location.reload()` 等)は許可する。
 *
 * このモジュールは Electron の型に依存するが、実挙動(遷移拒否・権限拒否)自体はオフスクリーンの
 * `BrowserWindow({show:false})` で検証できる(.claude/rules/build-commands.md)。
 */

import { shell, type Session, type WebContents } from 'electron';

/** http/https 以外のスキームは外部で開かない(file:・javascript:・カスタムスキーム等を弾く)。 */
function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** 2つの URL が同一オリジンかを判定する(いずれかが不正 URL なら false)。 */
function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * `will-navigate`/`will-redirect` を監視し、**現在のページと別オリジンへの遷移を拒否**する。
 * 自オリジン内の遷移(HMR のフルリロード等)は許可する。dev/prod でオリジンが異なるが、
 * 判定は「遷移先 vs 現在コミット済み URL(`getURL()`)」の相対比較なので環境を問わず効く。
 */
export function guardNavigation(contents: WebContents): void {
  const block = (event: { preventDefault(): void }, url: string): void => {
    const current = contents.getURL();
    // 初回 loadURL がまだコミットされていない間(getURL() が空 / about:blank)は判定基準が無い。
    // ここで発火し得るのは **アプリ起点の初回読み込みに伴うリダイレクト**(読み込み先はアプリが
    // 決めた localhost / Vite / file のみ)なので許可する。空のまま拒否すると `new URL('')` 例外で
    // isSameOrigin が false になり、初回ナビゲーション自体を止めてウィンドウが無言で固まる
    // (reviewer が 302 を挟む loadURL で実測・確認)。
    if (current === '' || current === 'about:blank') {
      return;
    }
    // 現在のページと同一オリジンなら許可(dev の location.reload 等)。それ以外は封じる。
    if (!isSameOrigin(url, current)) {
      event.preventDefault();
    }
  };
  contents.on('will-navigate', (event, url) => block(event, url));
  // サーバー側リダイレクト(3xx の Location)で外部へ飛ばされるのも塞ぐ。
  contents.on('will-redirect', (event, url) => block(event, url));
}

/**
 * 新規ウィンドウ要求を**一律拒否**する `setWindowOpenHandler` 用のハンドラ。
 * キャラクターウィンドウのように外部リンクを開く導線を一切持たない画面で使う
 * (万一の `window.open(evil)` でブラウザすら開かせない=多層防御)。
 */
export function denyWindowOpen(): { action: 'deny' } {
  return { action: 'deny' };
}

/**
 * 新規ウィンドウ要求を **http/https に限って外部ブラウザで開き**、それ以外は拒否する
 * `setWindowOpenHandler` 用のハンドラ。Control Panel の権利タブ等、正当な外部リンクを持つ画面で使う。
 * Electron の子ウィンドウは常に開かせない(`action: 'deny'`)。
 */
export function openExternalHttpOnly({ url }: { url: string }): { action: 'deny' } {
  if (isHttpUrl(url)) {
    void shell.openExternal(url);
  }
  return { action: 'deny' };
}

/**
 * セッションの Web 権限要求を**すべて拒否**する。このアプリはカメラ/マイク/位置情報/通知等を
 * 一切使わないため、要求も事前チェックも一律 false にして余地を残さない。
 * 両ウィンドウは既定セッションを共有するため、起動時に一度呼べば足りる。
 */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
