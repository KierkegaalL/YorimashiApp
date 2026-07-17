# chat-adapter-errors.md — Chat Adapterのエラーハンドリング

**ステータス**: 確定(2026-07-16)
**対応FR**: FR-3
**関連**: api.md 6章、emotion-classification.md、要件定義書 C-08

## 背景

Chat Adapterのreal接続時、Anthropic APIのレート制限・ネットワーク断・タイムアウト等の異常系挙動が未確定。

## 結論

| 論点 | 決定 |
|---|---|
| 実装方式 | **公式SDK(`@anthropic-ai/sdk`)をMainプロセスで使う**。生fetchで自前実装しない |
| レート制限 | **SDKの自動リトライに任せる**。自前でバックオフを書かない |
| リトライ中の表情 | **`worried`を出さない**。送信時から出ている`thinking`が正しい状態 |
| ネットワーク断 | 事前検知しない。`APIConnectionError`を捕まえる。オフライン判定は**エラー文言の改善にのみ**使う |
| タイムアウト | **`AbortSignal`による無通信ウォッチドッグが必須**。SDKの`timeout`は凍ったstreamに効かない |
| mockへの自動切替 | **絶対にしない**。提案すらUIのボタンに留める |

## 検討ログ

以下はすべてSDK 0.112.1をローカルのモックサーバーに対して実行し、実測した結果に基づく。

### 前提: 実装場所とSDK

api.md 6章は「Messages APIを**直叩き**」と記述しているが、**公式SDK(`@anthropic-ai/sdk`)を使う**。理由は論点1で示すとおり、本ドキュメントが問うているリトライ・バックオフ・`retry-after`の尊重をSDKが既に実装しており、自前で書き直す理由がないため。

実行場所は**Electron Mainプロセス**とする。

- APIキーは`config.chatAdapter.anthropicApiKey`にあり、config.jsonを所有するのはMain。
- security.md は全レンダラーに`contextIsolation: true` / `sandbox: true`を課している。Rendererから直接APIを叩くとキーをRendererへ渡すことになり、この前提が崩れる。
- キャラクターウィンドウはブラウザ拡張のiframeからも読まれる(FR-8)。Renderer側にキーを置く設計は、その経路にもキーを晒す。

> **要決着**: `@anthropic-ai/sdk`は`package.json`に未追加で、**要件定義書5章(技術スタック)にも記載がない**(Electron / PixiJS / Zod等は列挙されているが、Anthropic SDKだけ無い)。追加はスタック変更にあたるためNotion正本の更新が要る。

### 論点1: レート制限時の挙動

#### リトライは自前で書かない。SDKが既にやっている

モックサーバーを立て、ステータスコード別にSDKの挙動を実測した(`maxRetries`は既定の2)。

| 返したステータス | 総試行回数 | リトライ間隔 | 送出された例外クラス | `error.type` |
|---|---|---|---|---|
| 429 | **3回** | **1.01s, 1.01s** | `RateLimitError` | `rate_limit_error` |
| 529 | **3回** | 0.50s, 0.83s | `InternalServerError` | `overloaded_error` |
| 400 | 1回 | — | `BadRequestError` | `invalid_request_error` |
| 401 | 1回 | — | `AuthenticationError` | `authentication_error` |

429では**`retry-after: 1`ヘッダを正確に尊重して1.01秒間隔で再試行**し、529ではヘッダが無いため指数バックオフ+ジッタ(0.50s → 0.83s)で再試行している。400/401はリトライされない。

つまり本ドキュメントの論点「リトライするか、即座にエラー表示するか」は、**SDKを使う限り既に答えが出ている**。アプリ側ですべきことは自前のバックオフ実装ではなく、`maxRetries`の設定と、リトライを尽くした後の扱いだけ。

**実装上の注意(実測で判明)**:

- **529は`InternalServerError`クラスで飛んでくる**。500と同じクラスなので、クラス名だけでは区別できない。`e.type === 'overloaded_error'`で判別する。
- **`APIConnectionError`は`APIError`のサブクラス**(TypeScript SDK)。`catch`を`APIError`から先に書くとネットワークエラーを取りこぼす。**具体的なクラスから順に並べる**。

```typescript
try {
  // ...
} catch (e) {
  if (e instanceof Anthropic.AuthenticationError)      { /* 401: 設定へ誘導 */ }
  else if (e instanceof Anthropic.RateLimitError)      { /* 429: リトライ尽き */ }
  else if (e instanceof Anthropic.APIConnectionError)  { /* 通信断。APIErrorより先に */ }
  else if (e instanceof Anthropic.APIError)            { /* その他のHTTPエラー */ }
  else                                                  { /* 中断・想定外 */ }
}
```

#### リトライ中に`worried`を出さない

論点は「リトライする場合、EmotionEngineに`worried`等の反応をさせるか(ユーザーへのフィードバックとして)」だが、**出さない**。実測した時間が理由になる。

- 429のリトライは**2.0秒で完結**した(1回目失敗 → 1.01s待ち → 2回目 → 1.01s待ち → 3回目)。
- 一方`emotionEngine.reactionDurationMs`の既定は**3000ms**。

つまり`worried`を出すと、**リクエストが成功した後もまだ心配顔が画面に残る**。1秒後に届いた応答に対して灯里が心配し続けるという、事実と食い違う表示になる。クールダウン(1500ms)も相まって、直後の正しいReactionを潰す可能性すらある。

そもそも送信時に`thinking`が発火しており(emotion-classification.md)、**リトライ中の正しい状態は「まだ応答を待っている」=`thinking`そのもの**である。ユーザーから見ればリトライは実装の内部事情であって、待っていることに変わりはない。透過的に再試行されるのはSDKの正しい振る舞いであり、それをわざわざ顔に出す必要はない。

表情を出すのは**リトライを尽くして失敗が確定したとき**だけとする。

#### 失敗確定時の表情

| 状況 | 表情 | 理由 |
|---|---|---|
| リトライ後に成功 | 分類結果に従う(emotion-classification.md) | 内部のリトライはユーザーに関係ない |
| リトライを尽くして失敗(429 / 5xx / 通信断) | **`panic`** | emotion-classification.mdが「panicの主たる発火源はAPIエラー」として本ドキュメントに預けた箇所 |
| 401 / 400 / 404(リトライ不能) | **`worried`** | 設定ミスであって異常事態ではない。`panic`は過剰 |

`panic`と`worried`を分けるのは、**ユーザーが取れる行動が違う**ため。401はAPIキーを直せば済む(worried=困っている)。レート制限や通信断はユーザーにできることが少なく、灯里が慌てる(panic)ほうが状況に合う。

### 論点2: ネットワーク断時の挙動

#### `navigator.onLine`は使えない(そもそも存在しない)

論点は「`navigator.onLine`を併用するか」だが、**Mainプロセスに`navigator.onLine`は存在しない**。Electron 43.1.1で実測した結果:

| 判定手段 | Mainプロセスでの結果 |
|---|---|
| `typeof navigator` | `object`(存在はする) |
| `navigator.onLine` | **`undefined`** |
| `net.isOnline()`(Electron API) | `true`(利用可能) |
| `fetch` / `AbortSignal.timeout` | 利用可能 |

`navigator`オブジェクト自体はあるので`typeof navigator !== 'undefined'`のようなガードは通過してしまうが、`onLine`は`undefined`である。**「オンラインではない」と誤判定する実装を書きかねない**ので注意する。

#### 事前検知はしない

`net.isOnline()`は使えるが、**接続の可否判定には使わない**。これが真を返しても意味するのは「ネットワークインターフェースが生きている」ことだけで、`api.anthropic.com`に到達できるかは別問題(社内プロキシ、DNS障害、Anthropic側の障害では`isOnline()`は`true`のまま)。事前チェックを入れると、通ったのに失敗する・落ちたのに実は通る、の両方が起きて判定が二重化する。

**方針: 送ってみて`APIConnectionError`を捕まえる。** SDKは接続エラーも自動リトライするため(429と同じ経路)、一時的な瞬断は透過的に回復する。

`net.isOnline()`は**エラー文言の出し分けにのみ使う**。ユーザーに見せる文言が変わるだけで、制御フローは変えない。

| `net.isOnline()` | 文言 |
|---|---|
| `false` | 「ネットワークに接続されていないようです」 |
| `true` | 「Anthropicのサーバーに接続できませんでした」 |

#### 再接続後の自動リトライ

**しない。** SDKのリトライを尽くして失敗した時点でユーザーに失敗を返し、再送はユーザーの操作に委ねる。バックグラウンドで勝手に再送すると、ユーザーが諦めて別の話題を打った後に古いメッセージの応答が割り込む。チャットの文脈が壊れるほうが害が大きい。

### 論点3: タイムアウト

**この論点が最も危険だった。「タイムアウト値を決める」という素朴な答えは誤りである。**

#### 実測: SDKの`timeout`は凍ったstreamに効かない

ヘッダと数チャンクだけ送って以降だんまりになるSSEサーバーを立て、3つの方式を試した(しきい値はいずれも3秒)。

| 方式 | 結果 |
|---|---|
| クライアント生成時の`timeout: 3000` | **効かない**(8秒経っても中断せず) |
| リクエスト単位の`{ timeout: 3000 }` | **効かない**(同上) |
| `{ signal: AbortSignal.timeout(3000) }` | **3.0秒で`APIUserAbortError`** |

SDKの`timeout`オプションは**応答ヘッダの受信までしかカバーしない**。ヘッダが返ってきた後にstreamが凍ると、`timeout`をいくら短くしても中断されず、**アプリは永久にハングする**。そのときキャラクターは`thinking`のまま固まり続ける(送信時に`thinking`を発火させたきり、完了もエラーも来ないため)。ユーザーから見れば灯里が考え込んだまま二度と戻ってこない。

さらに悪いことに、**SDKの既定`timeout`は600000ms(10分)** で、しかもタイムアウト自体もリトライ対象である。`maxRetries: 2`と掛け合わせると最悪**30分**待つ計算になる。既定値のまま使ってはいけない。

> TypeScript SDKの`timeout`は**ミリ秒**単位(Pythonは秒)。`timeout: 30`と書くと30ミリ秒になる。

#### 対策: 無通信(idle)ウォッチドッグ

`AbortSignal.timeout(N)`は効くが、これは**壁時計の締切**なので、Nを超える正当な長文応答まで殺してしまう。必要なのは「**Nミリ秒のあいだ1チャンクも来なかったら中断**」という、受信のたびにリセットされるタイマーである。

```typescript
async function streamWithIdleTimeout(client, params, idleMs) {
  const ac = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ac.abort(new Error(`idle>${idleMs}ms`)), idleMs);
  };
  arm();
  try {
    const stream = client.messages.stream(params, { signal: ac.signal });
    stream.on('text', arm);          // ← チャンク受信のたびに延命する
    return await stream.finalMessage();
  } finally {
    clearTimeout(timer);
  }
}
```

**実測で意図どおり動くことを確認した**(しきい値2秒):

| stream | 結果 |
|---|---|
| 0.8秒間隔で6チャンク(合計4.8秒)= 遅いが生きている | **5.6秒で完走**。合計時間がしきい値を超えても中断しない |
| 3チャンク送信後に凍る | **4.4秒で`APIUserAbortError`**(2.4秒受信 + 2秒無通信) |

壁時計方式ならどちらも殺していた。無通信方式なら「生きているか」だけで判定できる。

#### 設定値

| 項目 | 値 | 根拠 |
|---|---|---|
| 無通信しきい値 | **30秒**(暫定) | 初回トークンまでは数秒かかりうるが、トークン間が30秒空くのは異常。実使用でチューニングする |
| `maxRetries` | 2(SDK既定のまま) | 実測で429/5xxに適切に効いている |
| `timeout` | 60秒 | ヘッダすら返らない場合の保険。既定の10分は長すぎる |

`stream.finalMessage()`を使う。SDKは`.on()`イベントを`new Promise()`で包む必要がないよう完了・エラー・中断を内部で処理している。

> **要決着**: `chatAdapter`は`{ mode, anthropicApiKey, model }`しか持たず、**無通信しきい値・`maxRetries`・`timeout`を置く場所がない**。emotion-classification.mdが要求している`classifier`と合わせて、basic-design.md 6.1(Notion正本)の変更が要る。

### 論点4: mockモードへのフォールバック

**自動的に切り替えない。UIでの提案に留める。**

論点は「勝手に切り替えるのは驚き最小の原則に反する可能性があるため、提案に留めるべきか」と書かれているが、これは驚き最小の原則より深刻な問題である。

**mockは固定返答を返すモード**である(要件定義書4.3)。real接続が失敗したときに黙ってmockへ落とすと、ユーザーが投げた質問に対して**あらかじめ用意された固定文が、Claudeの回答であるかのように返る**。これは機能の劣化ではなく、**アプリが自分の状態について嘘をつく**ことになる。ユーザーは灯里がClaudeと話していると思っているのに、実際には何とも話していない。

C-08が「既定はmock、課金トリガーはreal切替時のみ」と定めているのは、mockとrealが**コストの違うモード**であることを明示するためであり、両者が相互に代替可能だからではない。realを選んだユーザーは「実際にClaudeに繋ぐ」ことを選んでいる。それが壊れているなら、壊れていると伝えるのが正しい。

したがって:

- 失敗時は**エラーを表示する**(灯里は`panic`)。
- 「モックモードに切り替える」ボタンを添えて、**ユーザーが明示的に押した場合のみ**切り替える。
- 連続失敗しても提案の表示以上のことはしない。回数で挙動を変えない(閾値を跨いだ瞬間にアプリの振る舞いが変わるのは、それ自体が驚きになる)。

## 検出した不整合(本ドキュメントでは修正しない)

**Chat Adapterの失敗はMoodを動かせない。** basic-design.md 5.2はMoodが`successStreak`/`failStreak`で遷移すると定め、5.3は「どちらのAdapterも同一のEmotionEngineインスタンスを共有」としている。しかし実際の`failStreakThreshold`/`successStreakThreshold`は**`codeAdapter`ブロックの下にある**(config-schema.ts・data.md・basic-design.md の3箇所とも)。

つまりChat Adapterで連続してAPIエラーが起きても、参照すべきしきい値が自分の設定に無い。`codeAdapter`の値を横から読むのは、設定画面(モード設定タブはCode/Chatを別セクションとして分けている)とも噛み合わない。

Moodの2層構造はEmotionEngineの概念なので、**しきい値は`emotionEngine`ブロックへ移すのが筋**だと考えるが、これはbasic-design.md 6.1 = Notion正本の変更を伴うため本ドキュメントでは決定しない。

## 実装時のTODO

- [ ] **(要決着)** `@anthropic-ai/sdk`を技術スタック(要件定義書5章)へ追加
- [ ] **(要決着)** `chatAdapter`に無通信しきい値・`maxRetries`・`timeout`・`classifier`を追加(basic-design.md 6.1)
- [ ] **(要決着)** `failStreakThreshold`/`successStreakThreshold`を`codeAdapter`から`emotionEngine`へ移すか判断する
- [ ] `@anthropic-ai/sdk`を`package.json`へ追加し、権利情報タブ(FR-12)のOSS一覧にも追加する
- [ ] `streamWithIdleTimeout`をMain側に実装する。**SDKの`timeout`だけに頼らない**
- [ ] 無通信しきい値(暫定30秒)の実使用でのチューニング
- [ ] api.md 6章の「直叩き」の記述を、SDK採用に合わせて更新する
