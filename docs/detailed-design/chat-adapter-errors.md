# chat-adapter-errors.md — Chat Adapterのエラーハンドリング

**ステータス**: 確定(2026-07-16)
**対応FR**: FR-3
**関連**: api.md 5章、emotion-classification.md、要件定義書 C-08

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
| APIキー取得の案内 | **OAuthサインインは提供しない**(Anthropicは第三者アプリ向けの公開OAuth連携を提供していないため)。モード設定タブのAPIキー欄に取得手順を常設し、失敗を待たず事前に案内する |

## 検討ログ

以下はすべてSDK 0.112.1をローカルのモックサーバーに対して実行し、実測した結果に基づく。

### 前提: 実装場所とSDK

検討当時のapi.md(旧6章)は「Messages APIを**直叩き**」と記述していたが、**公式SDK(`@anthropic-ai/sdk`)を使う**方針とした。理由は論点1で示すとおり、本ドキュメントが問うているリトライ・バックオフ・`retry-after`の尊重をSDKが既に実装しており、自前で書き直す理由がないため。**api.md側は既にSDK採用の記述へ修正済み(現5章。未決事項C4・2026-07-28決着)**。

実行場所は**Electron Mainプロセス**とする。

- APIキーは`config.chatAdapter.anthropicApiKey`にあり、config.jsonを所有するのはMain。
- security.md は全レンダラーに`contextIsolation: true` / `sandbox: true`を課している。Rendererから直接APIを叩くとキーをRendererへ渡すことになり、この前提が崩れる。

> **決着済み(A1+B一括Notion更新)**: Anthropic SDK は要件定義書5章(技術スタック)へ追加済み。`package.json`にも `@anthropic-ai/sdk` を追加した(#12。導入時のバージョンは **0.112.3**)。

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

> **決着済み(A1+B一括Notion更新)**: `chatAdapter` に `idleTimeoutMs`(既定30000)・`maxRetries`(2)・`timeout`(60000)・`classifier`・`classifierModel` を追加済み(basic-design.md 6.1 / docs/data.md / config-schema.ts すべて反映)。#12の実装はこの3値を config から読む。

### 論点4: mockモードへのフォールバック

**自動的に切り替えない。UIでの提案に留める。**

論点は「勝手に切り替えるのは驚き最小の原則に反する可能性があるため、提案に留めるべきか」と書かれているが、これは驚き最小の原則より深刻な問題である。

**mockは固定返答を返すモード**である(要件定義書4.3)。real接続が失敗したときに黙ってmockへ落とすと、ユーザーが投げた質問に対して**あらかじめ用意された固定文が、Claudeの回答であるかのように返る**。これは機能の劣化ではなく、**アプリが自分の状態について嘘をつく**ことになる。ユーザーは灯里がClaudeと話していると思っているのに、実際には何とも話していない。

C-08が「既定はmock、課金トリガーはreal切替時のみ」と定めているのは、mockとrealが**コストの違うモード**であることを明示するためであり、両者が相互に代替可能だからではない。realを選んだユーザーは「実際にClaudeに繋ぐ」ことを選んでいる。それが壊れているなら、壊れていると伝えるのが正しい。

したがって:

- 失敗時は**エラーを表示する**(灯里は`panic`)。
- 「モックモードに切り替える」ボタンを添えて、**ユーザーが明示的に押した場合のみ**切り替える。
- 連続失敗しても提案の表示以上のことはしない。回数で挙動を変えない(閾値を跨いだ瞬間にアプリの振る舞いが変わるのは、それ自体が驚きになる)。

### 論点5: APIキー取得・入力の案内（2026-07-18追加）

**背景**: 論点1の失敗確定時の表情表で、401(認証エラー)は「設定ミスであって異常事態ではない」ため`worried`+「モード設定を開く」ボタンとしている(chat-pane.mdの表と対応)。しかしこれは**キーが間違っている/未設定であることが発覚した後**の事後対応であり、real初回利用者が最初から迷わずキーを用意できるような**事前の案内**が存在しない。

ユーザーから「Anthropic APIキーを手動で入力させるのは難しいのでは」という懸念が出た。検討した結果:

- **OAuthでの「Claudeにサインイン」は選択肢にならない**。AnthropicはMessages API(本アプリが使う`@anthropic-ai/sdk`)に対して、第三者アプリ向けの公開OAuth連携を提供していない。Claude Code CLIのアカウントログインはAnthropic公式ツール専用の内部的な仕組みであり、一般アプリが同じ経路を使うことはできない。
- したがって**摩擦を減らす方向で対応する**。モード設定タブのAPIキー入力欄に、取得手順(console.anthropic.comでのアカウント作成・キー発行・貼り付け)を常設のガイドとして表示し、`real`へ切り替えた時点で(401を待たずに)見えるようにする。

**決定**: モード設定タブのAPIキー行の直下に、番号付きの手順(4ステップ)と「console.anthropic.com を開く」ボタンを表示する(`docs/mockups/control-panel.jsx`の`API_KEY_STEPS`に反映済み)。

- **外部サイトへの遷移**: `src/main/index.ts`は既に`webContents.setWindowOpenHandler()`で`window.open()`呼び出しを捕まえ、`shell.openExternal()`へリダイレクトしたうえでElectronウィンドウ自体は乗っ取らせない実装を持つ。「console.anthropic.com を開く」ボタンは、Rendererから素朴に`window.open(url)`(または`<a target="_blank">`)を呼ぶだけでこの既存機構に乗り、安全に外部ブラウザで開ける見込みが高い。**専用のpreload IPCを新設する前提は置かない**。ただし実装時にRenderer側でURLを動的に組み立てる必要が生じた場合等は、既存機構で足りるか、その時点で判断する（実装TODO参照）。
- この節で決めるのは**APIキー取得ボタンのみ**であり、Live2D公式サイトのランタイム取得や7.3(外部動画生成AIサービス連携)への外部リンクボタン導入を決めるものではない。7.3は「特定ベンダー非依存」を明記しており(basic-design.md)、特定URLへ固定で遷移するボタンは現状の設計方針と衝突しうるため、**同種のボタンを7.3側に広げるかどうかは別途検討する**(勝手に広げない)。
- ガイドは常設(折りたたみ等はしない)。`real`を選んでいる間は誰でも迷わず参照できる状態を優先する。
- **論点1(401時の事後対応)を置き換えるものではない**。事前案内はキー未取得に起因する401を減らす効果を狙うものであり、誤入力等による401は引き続き起こりうるため、論点1の「401→`worried`+『モード設定を開く』ボタン」はそのまま維持する。両者は併存する。

## 検出した不整合(本ドキュメントでは修正しない)

**Chat Adapterの失敗はMoodを動かせない。** basic-design.md 5.2はMoodが`successStreak`/`failStreak`で遷移すると定め、5.3は「どちらのAdapterも同一のEmotionEngineインスタンスを共有」としている。しかし実際の`failStreakThreshold`/`successStreakThreshold`は**`codeAdapter`ブロックの下にある**(config-schema.ts・data.md・basic-design.md の3箇所とも)。

つまりChat Adapterで連続してAPIエラーが起きても、参照すべきしきい値が自分の設定に無い。`codeAdapter`の値を横から読むのは、設定画面(モード設定タブはCode/Chatを別セクションとして分けている)とも噛み合わない。

Moodの2層構造はEmotionEngineの概念なので、**しきい値は`emotionEngine`ブロックへ移すのが筋**だと考えるが、これはbasic-design.md 6.1 = Notion正本の変更を伴うため本ドキュメントでは決定しない。

> **解消済み(A1+B一括Notion更新)**: `failStreakThreshold` / `successStreakThreshold` は `emotionEngine` ブロックへ移設され、Code/Chat両Adapterで共有する形になった(config-schema.ts にコメントで明記)。上の不整合は残っていない。

## 実装時のTODO

- [x] **(決着済み)** `@anthropic-ai/sdk`を技術スタック(要件定義書5章)へ追加 — A1+B一括Notion更新で反映済み
- [x] **(決着済み)** `chatAdapter`に無通信しきい値・`maxRetries`・`timeout`・`classifier`を追加(basic-design.md 6.1) — 同上
- [x] **(決着済み)** `failStreakThreshold`/`successStreakThreshold`を`emotionEngine`へ移設 — 同上
- [x] **(実装済み・#12)** `@anthropic-ai/sdk`(0.112.3)を`package.json`へ追加
- [x] **(実装済み)** 権利情報タブ(FR-12)のOSS一覧に`@anthropic-ai/sdk`を追加する — `generate-oss-licenses.mjs`の自動走査で`src/shared/oss-licenses.ts`に反映済み(手動追加不要)
- [x] **(実装済み・#12)** 無通信ウォッチドッグを`src/main/chat-adapter/real-responder.ts`に実装。**SDKの`timeout`だけに頼らない**
- [ ] 無通信しきい値(暫定30秒)の実使用でのチューニング(実接続を日常的に使い始めてから)
- [x] **(実装済み・#12)** api.md 5章の「直叩き」の記述をSDK採用に合わせて更新(章番号はFR-8/9削除にともない6章→5章へ繰り上がっている)
- [x] **(実装済み・#12)** 「console.anthropic.com を開く」ボタン(論点5)。**既存の`setWindowOpenHandler`に`window.open(url)`で乗せられたため、専用IPCは追加していない**

## 実装記録(#12・2026-07-20)

実装は `src/main/chat-adapter/real-responder.ts`(**Electron非依存**。`net.isOnline()`は関数として注入)と、既存 `chat-adapter.ts` の real 分岐。**mockとrealは同じ経路を通る**(分類・sustain/release・終端イベント・履歴の積み方は共通で、差し替わるのは本文の取得元だけ)。

本ドキュメントに書かれていなかったため、#12で決めて明記した事項:

| 論点 | 決定 | 理由 |
|---|---|---|
| システムプロンプト | **付けない** | 要件はrealを「Anthropic APIに実接続する」としか定義しておらず、灯里としてのロールプレイは要求していない。灯里が担うのは応答への**感情表現**であって応答の人格ではない。勝手なペルソナ注入は「Claudeと話している」という理解と食い違う |
| `max_tokens` | **4096**(コード内定数) | Messages APIの必須パラメータだが、会話1往復の長さのためにconfigスキーマ(=Notion正本)を変更する理由が無い。mock-responder.ts のチャンク設定と同じ判断 |
| 会話履歴の保持場所 | **Main**(メモリのみ・C-22どおり永続化しない) | realは文脈を渡さないと毎ターン記憶喪失になる。Rendererから送らせると「画面に見えている会話」と「APIへ送る会話」が別経路になり、ずれても誰も気づけない。system行・エラー行のようにAPIへ送ってはならない表示専用の行もある |
| 再送/再生成 | `isRetry` を Main へ伝え、**userターンを積み直さない** | 会話ペインも `echoUser=false` で吹き出しを積み直さないため、揃えないと画面1回・API2回になる |
| 中断時の部分受信 | **履歴へ積む** | 画面にはそれが残っている。積まないと画面とAPIの文脈がずれる |
| 失敗時の応答 | 履歴へ**積まない**(userターンは残す) | 「再送する」で同じ問いをやり直せるようにするため |
| **新規送信時、末尾が未回答のuserターンなら置き換える**(issue #15) | **決定**: 直前のuserターンをpopしてから新しいuserターンをpush | 失敗/中断で応答が積まれないまま新しいメッセージを送ると、`user`ターンが連続しAnthropic Messages APIの「user/assistant交互」制約に違反して**再び400になる**(一度失敗すると`/clear`するまで以降の送信も全部400になり続ける)。上記「失敗時の応答」行の「userターンは残す」は**再送(`isRetry`)経路のみ**に適用される。新規送信(非retry)は、末尾に未回答userターンが残っていればそれを取り消し新しい発話に置き換える。**画面には古い失敗メッセージが吹き出しとして残るが、APIへ送る履歴からは取り消される**(最初から積まなかった「表示専用の行」とは異なり、一度積んだ実データを後から取り消す非対称。会話が「つながっていない」ように見えないよう、画面側の表示自体は変更しない) |
| APIキーのRendererへの露出 | `hasApiKey` と**末尾4文字のみ**。本体は返さない | security.md 5章。画面に平文を描くとスクリーンショット・画面共有・DevToolsから漏れる。結果としてこの画面はキーを「編集」できず、**入れ替える**か**消す**かのみ |
| APIキーの形式検査 | **しない**(空白のtrimだけ) | `sk-ant-`前提の検査を入れると、キーの体裁が変わったときに正しいキーをアプリが拒否する側の事故になる。正しさはAPIが401で答える |
| コンテキスト使用量の表示 | **実トークン数のみ。パーセンテージは出さない** | 分母(モデルのコンテキストウィンドウ長)はAPI応答に含まれず、ハードコードするとモデル更新時に古い分母でもっともらしい%を出し続ける = 実測に見える推測値になる。モックアップのメーター表現からの意図的な差分 |
| **クレジット残高不足の専用検出**(issue #16) | **決定**: `err.type === 'billing_error'` または メッセージ文字列に`"credit balance"`が含まれる場合、専用の案内(`action: 'open-billing-page'`)を出す。どちらにも一致しなければ通常の`configuration`扱い(400の汎用文言)にフォールバックする | 「モード設定を開く」ではクレジット残高は直せない(Anthropic側の課金ページでの対応が要る)ため、他の設定ミスと区別する必要がある。**実測(issue #15調査)で判明**: SDKの型定義には専用の`'billing_error'`というErrorTypeが存在するが、実際にAnthropic APIが返した「クレジット残高不足」のレスポンスは`type: 'invalid_request_error'`だった(型が示唆する分類と実際の挙動が食い違った実例)。型チェックだけでは検出できないため、メッセージの文字列マッチングを主たる検出手段としつつ、型チェックも将来への備えとして残す。文言が変わって検出できなくなっても通常のconfiguration扱いへ黙ってフォールバックするだけで、誤った案内を出したり壊れたりはしない(推測で決め打ちしない/嘘をつかない) |

**実測(オフスクリーン・実SDK 0.112.3 + 実HTTPサーバー + 実SSE)**: 38件。無通信しきい値2秒で、凍ったstreamは**2012msで中断**、0.8秒間隔×5チャンク(合計4015ms)の遅いstreamは**中断せず完走**した。これは壁時計方式では両方とも殺されるケースで、idle方式であることの実証になっている。エラー分類は401/403/404/400/429/500/529と通信断を実際に返させて確認し、いずれの文言にもAPIキーが混入しないことを確認した。APIキー未設定時は**APIへ1回もリクエストしない**(サーバーへのヒット数0で確認)。429は`maxRetries:2`で総試行3回・透過的に成功することを再確認した。

**ChatAdapterレベル**: 37件(実EmotionEngine/実ConfigStore)。履歴の積み方(正常・再送・失敗・中断・`/clear`)、real全経路での`release('thinking')`、設定APIがキー本体を返さないこと、mockの`usage`が常に`null`であることを確認した。

**reviewer 1周目(7件: 重大2/中2/軽微3)への対応**:

| # | 指摘 | 対応 |
|---|---|---|
| 1(重大) | 応答モデル選択(`/model`・フッターチップ)がローカルstateのみを回し、実際にAPIへ送るモデル(config)と同期していなかった | `App.tsx`が`ChatConfigSnapshot.model`を state 化し`ConversationPane`へpropsで渡す形に変更。変更要求は`onSetResponseModel`→`chat.setConfig({model})`→Main側configを更新→`onConfigChanged`で戻る、という既存のmode/adapterと同じ経路に統一した |
| 2(重大) | `/clear`(`reset()`)と進行中streamが競合すると、resetで空になった新しい履歴の先頭に`assistant`ターンが積まれ、Messages APIの「先頭user」要求に反する不正な配列になりうる | `runStream`開始時に`this.turns`への参照(`turnsAtStart`)を保持し、応答を積む直前に`this.turns === turnsAtStart`を確認してから積む(`pushAssistantTurn`)。reset由来なら黙って捨てる。回帰検証を追加(オフスクリーン[8][9]) |
| 3(中) | mockの固定返答がmode不問で履歴に残り、real切替後にAPIへ送られる | 意図的な挙動と判断し、理由をコードコメントに明記(`chat-adapter.ts`の`turns`フィールド)。mock/realで履歴を分けるとモード切替のたびに文脈が失われる方が実害が大きいため |
| 4(中) | 「再生成」ボタンが全assistantメッセージに出るが、実際には常に直近の質問だけを再送する(過去のメッセージへの操作に見えて実挙動と食い違う) | **最新のassistantメッセージにのみ**再生成ボタンを表示するよう`ConversationPane.tsx`を修正 |
| 5(軽微) | `ChatErrorKind`の`'not-implemented'`が real実装完了後デッドコード化 | `shared/chat.ts`から削除 |
| 6(軽微) | `will-quit`のコメントが「release('thinking')を通してから」と書いていたが、実際は`dispose()`の`disposed`フラグにより release は呼ばれない(直後にengineごと破棄するため実害は無い) | コメントを実態に合わせて修正 |
| 7(軽微) | `reset()`直後の即時再送が、abortの非同期解決を待つ一瞬の隙間で「応答の生成中です」エラーになりうる | `reset()`内で`this.active`を同期的に`null`化するよう変更 |

修正後、typecheck・buildを再確認し、オフスクリーン検証は**75件**(real-responder 38 + chat-adapter 37。AdapterTab SSR 4件は別途)全通過。

**issue #15(2026-07-27)への対応**: real接続で送信すると400になるとの報告を受け調査した結果、上記「新規送信時、末尾が未回答のuserターンなら置き換える」の欠落が根本原因と判明した(一度何らかの理由で失敗すると、以降の送信も`user,user`連続ターンで全部400になり続ける、原因が分かりにくい壊れ方をしていた)。`chat-adapter.ts`の`send()`を修正。あわせて`real-responder.ts`の`classifyError()`に**診断用ログ**を追加した — UIには引き続き一般化した文言のみ表示する(上表の方針は変えない)が、Main側コンソールに`Anthropic.APIError`の`status`/`type`/`message`/エラーボディを出力し、次回以降の切り分けを容易にした(APIキーはこれらのフィールドに含まれないことを確認済み)。オフスクリーン検証で、修正を一時的に戻すとテストが実際に失敗することを確認したうえで(=テストの有効性を検証したうえで)、修正後は交互制約違反・古い発話の残留がいずれも解消することを確認した(10件)。reviewerチェックループ1周目の指摘3件はいずれもドキュメント精度・将来配慮に関するもので実装の誤りではなく、本節への追記で対応した。

**reviewer 2周目(3件: 中〜重大1/軽微2)への対応**:

| # | 指摘 | 対応 |
|---|---|---|
| 1(中〜重大) | モード設定タブ(`AdapterTab.tsx`)が`ChatConfigChanged`を購読しておらず、会話ペイン(左)の`/mock`・`/real`・`/model`操作でMainのconfigが変わっても表示が古いまま残る。会話ペインとこのタブは同一ウィンドウに常時併存するため、実際に「もうrealなのにmockの表示のまま」という食い違いが起きる | `AdapterTab.tsx`のuseEffectで`api.onConfigChanged(reload)`を購読し、通知のたびに`getSettings()`で**取り直す**よう変更(`ChatConfigChanged`は`hasApiKey`/`apiKeyTail`を運ばないため差分適用ではなく再取得にした) |
| 2(軽微) | `apply()`が失敗時も`catch`で吸収し常にresolveするため、APIキー保存に失敗しても入力欄が空になり、ユーザーが打ち直しを強いられる | `apply()`の戻り値を`Promise<boolean>`(成否)に変更し、保存ボタンのハンドラは成功時のみ`setKeyDraft('')`する |
| 3(軽微) | コメントが`setWindowOpenHandler`の実装場所を`src/main/index.ts`と誤記(実際は`src/main/control-panel-window.ts`) | コメントを実ファイルパスへ修正 |

3周目の検証: typecheck・build・AdapterTab SSR(4件)を再確認。

**reviewer 3周目(1件・軽微)への対応**: `AdapterTab.tsx`の設定再取得(`reload`)で、成功時(`then`)は`cancelled`ガードがあるのに失敗時(`catch`)には無い非対称があった。アンマウント後に`getSettings()`が失敗すると無条件で`setError`を呼ぶ経路になっていた(実害はReactがアンマウント後の`setState`を無視するためほぼ無いが、一貫性のため修正)。`catch`側にも`if (!cancelled)`を追加。**4周目0件**でチェックループ終了。
