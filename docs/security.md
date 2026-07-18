# security.md — セキュリティ設計リファレンス

> 基本設計書 8章の詳細版。実装時のセキュリティ対策のリファレンス。

## 1. 露出面の整理

```
外部から叩かれ得る経路
 ① dispatch.sh(hooks) → POST /hook          … 信頼できる(自分のマシンの自分のスクリプト)
 ② ブラウザで開いている「他の任意のサイト」 → fetch('http://localhost:8765/...')
```

②が本題。ローカルサーバーは`localhost`にバインドしている限り外部ネットワークからは届かないが、**同じマシンのブラウザで開いている無関係なサイトのJSからは届く**。対策は以下の5点。

## 2. 対策1: バインドアドレスの明示

```typescript
server.listen(8765, '127.0.0.1'); // '0.0.0.0'にしない。LAN内からのアクセスも遮断
```

## 3. 対策2: 共有トークンによる認証

起動時にランダムトークンを生成し、userData配下にパーミッション600で保存。

```typescript
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const tokenPath = path.join(app.getPath('userData'), '.token');
const authToken = fs.existsSync(tokenPath)
  ? fs.readFileSync(tokenPath, 'utf-8')
  : (() => {
      const t = crypto.randomBytes(24).toString('hex');
      fs.writeFileSync(tokenPath, t, { mode: 0o600 });
      return t;
    })();

function isAuthorized(req: http.IncomingMessage): boolean {
  const header = req.headers['x-app-token'];
  return header === authToken;
}
```

- `dispatch.sh`はファイルからトークンを読んでヘッダに付与。
- `/panel`・`/character`はトークン確認**なし**で読める(HTMLの入れ物を返すだけ)。ただしそのHTML内に`<script>window.__TOKEN__="...";</script>`のようにサーバー側で埋め込み、以降の実データ取得(WS/fetch)はこのトークン付きで行う。
- 外部サイトが`<iframe src="http://localhost:8765/panel">`を仕込んでも、**別オリジンなのでiframe内のJS変数(トークン)は読み取れない**(同一オリジンポリシー)。表示はできても中身を盗めない。
- WebSocketのハンドシェイクにも同じトークン認証を適用する(`ws://localhost:8765/ws?token=...`、upgrade時に検証)。

## 4. 対策3: クリックジャッキング対策(CSP)

自オリジン以外からの埋め込みは拒否する。

```typescript
res.setHeader(
  'Content-Security-Policy',
  `frame-ancestors 'self'`
);
```

`/panel`・`/character`両方のルートに同じCSPを適用する。

## 5. 対策4: Electronプロセス自体の基本強化

```typescript
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,   // レンダラーとNode APIを分離(必須)
    nodeIntegration: false,   // レンダラーに直接Node権限を渡さない
    sandbox: true,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

キャラクター表示ウィンドウ・Control Panelウィンドウ両方に適用する。

## 6. 対策5: モデルインポート時のzip-slip対策

zipや任意フォルダを受け入れる以上、展開先が意図したディレクトリの外に出ないようにする。

```typescript
function safeExtractPath(baseDir: string, entryName: string): string {
  const target = path.normalize(path.join(baseDir, entryName));
  if (!target.startsWith(path.normalize(baseDir) + path.sep)) {
    throw new Error('不正なパスを含むアーカイブです');
  }
  return target;
}
```

`../../`のようなパスを含むエントリでうっかりuserDataの外にファイルを書かれることを防ぐ。`GET /models/*`配信時のパス検証にも同じ考え方を適用する。

会話ペイン(FR-15)の**@参照**(作業ログ・設定等のアプリ管理ファイルを文脈に含める)と**添付**(real時)も、読み出すファイルパスが意図した領域内に収まることを同じ考え方で検証する。@参照が指すのはアプリが管理する固定の対象(作業ログ・表示中のモデル・設定)に限り、**メッセージ本文の文字列から任意パスを解決しない**。添付はユーザーがダイアログで選んだファイルに限定する。

## 7. 対策6: モデルアセット配信の統一

`app-model://`のようなElectron専用カスタムプロトコルは使わない。カスタムプロトコルは`file://`や`data:`と同様secure contextとして扱われず、動画デコード(WebCodecs)が使えなくなる(実測で確認済み、detailed-design/spriteset-pipeline.md参照)。モデルアセットは最初から`http://localhost:8765/models/<uuid>/...`という通常のHTTPルートで、トークン認証+パス検証つきで配信する。Electron側のキャラクターウィンドウも`BrowserWindow.loadURL('http://localhost:8765/character')`でこのローカルサーバーから読み込む形に統一する。

## 8. 対策7: hooksイベントログのアクセス権限

```typescript
fs.writeFileSync(hookEventLogPath, line, { mode: 0o600, flag: 'a' }); // 自分のOSユーザーのみ読み書き可
```

ファイルパス・プロジェクト名を含めてフル保存する方針(要件定義書C-03)のため、パーミッション制御は必須。

## 9. チェックリスト(要件定義書7章との対応)

1. ローカルサーバーは127.0.0.1限定バインド → 2章
2. 全リクエストにトークン認証を必須化(hooks含む、WSハンドシェイクも含む) → 3章
3. 全レンダラーで`contextIsolation: true` → 5章
4. アーカイブ展開時のパストラバーサル検証を必須化 → 6章、7章
