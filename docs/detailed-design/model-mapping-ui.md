# model-mapping-ui.md — モデルマッピング編集画面詳細設計

**ステータス**: 確定(2026-07-16)
**対応FR**: FR-5
**関連**: data.md 2章(manifest.json)、docs/mockups/control-panel.jsx(モックアップ)、security.md 7章

## 背景

Control Panelのモデル管理タブに、全10状態(Mood3+Reaction7)のマッピング編集UIはモックアップ済み。ただし以下の実装挙動が未確定。

## 結論

| 論点 | 決定 |
|---|---|
| プレビュー再生の描画先 | **Control Panel内のプレビュー枠**。`CharacterRenderer`を両形式共通で使う |
| Live2Dの選択UI | 行タップで**インライン展開**し、モーション/表情の2つのselectを全幅で出す |
| スプライトセットの差し替え | 「変更/設定」= 取り込みと同じ`<input type=file>`(当初案のダイアログ+ドロップから訂正。下記論点3)。削除はインライン確認。差し替えは寸法を`baseResolution`と一致必須 |
| 自動マッピング | **Live2Dのみ**。同義語辞書 + 最長一致スコアリング。取り込み時に1度だけ実行 |
| マッピングの正本 | `manifest.json`。自動検出結果も手動修正もここへ書く |

## モックアップの実測(前提の確認)

`docs/mockups/control-panel.jsx`(1095行)を読み、本ドキュメントが前提としていた記述との差を確認した。**論点1と論点2は、モックアップに現物が存在しないことが判明した**ため、新規に設計する。

| 本ドキュメントの当初の記述 | モックアップの実際 |
|---|---|
| 「『試しに再生する』ボタンを押した時」 | **プレビュー再生のUIは存在しない**(「再生」の語はヒント文中の説明のみ) |
| 「ドロップダウンに出すか」(Live2D) | **Live2D行に編集コントロールが一切ない**。ラベルと`要設定`のみの読み取り専用 |
| 「モックアップの『変更』ボタン」(スプライトセット) | 存在する(`Upload`アイコン、L826)。ただし**スプライトセット分岐にのみ**ある |
| 削除(未割当に戻す)導線 | **存在しない** |

**スプライトセット行には「変更」があるのにLive2D行には何もない**、というのはモックアップ自体に埋め込まれた非対称である。FR-5は「編集画面自体は対象モデルの形式に応じて自動で切り替わる」としており、両形式とも編集可能であることが前提なので、Live2D側の編集導線は本設計で補う。

その他、実装時に効く前提:

- **表示幅は`width: 400`固定**(モックアップの実値。2026-07-18の2ペイン化以前は`maxWidth: 400`中央寄せだった)。この幅の制約が論点2の結論を決めている。
- `EMOTION_STATES`がモックアップ内に**再定義**されている(L73-94)。`src/shared/emotions.ts`と重複するが形が違う(モックアップ側は`prompt`・`live2d`等を持つオブジェクト配列)。実装時は`shared/emotions.ts`を単一の情報源とし、プロンプト文言は別テーブルへ分離する。
- モックアップの`unmapped`判定は`s.live2d === '未割当'`を**両形式で流用**している(L810に`// デモ用に同じ未設定状態を流用`と明記あり)。デモ専用であり実装には持ち込まない。
- `lucide-react`を使用しているが`package.json`に未追加。実装時に依存として追加する(権利情報タブのOSS一覧にはISCとして既に記載あり)。

## 検討ログ

### 論点1: プレビュー再生の挙動

**Control Panel内にプレビュー枠を設け、そこで再生する。キャラクター表示ウィンドウでは再生しない。**

キャラクターウィンドウ側で再生する案を退けた理由:

- キャラクターウィンドウは別ディスプレイにいるかもしれない(character-window.mdのとおり位置は自由)。ユーザーの視線はControl Panelにある。
- 既定で`clickThrough: true`のため、キャラクターウィンドウは操作対象として扱われていない。

security.md 7章によりモデルアセットは`http://localhost:8765/models/<uuid>/...`でHTTP配信されるため、**Control Panelからも同じURLで読める**。Electron専用のカスタムプロトコルを使わない設計がここで効いており、プレビュー用に別経路を用意する必要がない。

#### 実装方式: 両形式とも`CharacterRenderer`を通す

```
「感情とモーションの対応」Section
 ├─ プレビュー枠(Section先頭に固定、120×120程度)
 │   └─ createRenderer(targetModel).mount(previewEl)
 └─ 各感情の行(全10状態)
     └─ ▶ ボタン → previewRenderer.setState(s.key)
```

スプライトセットのプレビューは`<img src=".../happy.webp">`だけでも動く(アニメーションWebPは`<img>`でそのまま再生される)。しかしそれを採ると**スプライトセットとLive2Dでプレビューの実装が分岐し、しかもEmotionEngineが実際に通る経路とも別物になる**。`CharacterRenderer.setState()`を使えば、プレビューは本番と同一の経路を通るため、マッピングの検証としても意味を持つ。両形式で同じインターフェースを叩く形に統一する。

代償として、Live2DモデルのプレビューにはControl Panel側にもPixiJSの実行とWebGLコンテキストが必要になる。非機能要件のメモリ目安(200MB前後)に対しては、**マッピングSectionが表示されている間だけ`mount()`し、離れたら`destroy()`する**遅延マウントで抑える。常時2インスタンスを抱えることはしない。

### 論点2: Live2Dのモーション/表情選択UI

#### 列挙元

`manifest.json`の`emotionMap`は`{ motion, expression }`の2フィールドを持つ(data.md 2.1)。モックアップの表示形式も`'TapBody / exp_smile'`、未設定側は`'— / exp_normal'`と、**「モーション / 表情」の2値**を前提にしている。よって選択UIも2つ必要。

列挙元はCubismのバージョンで異なる。

| cubismVersion | 定義ファイル | モーション | 表情 |
|---|---|---|---|
| cubism4(および5) | `*.model3.json` | `FileReferences.Motions`のキー(グループ名) | `FileReferences.Expressions[].Name` |
| cubism2 | `*.model.json` | `motions`のキー | `expressions[].name` |

**Cubism 2と4でファイル名もキー構造も異なる**ため、列挙処理はバージョン分岐が必須。要件定義書はCubism 2/4/5両対応を掲げており、モックアップのデモモデルも「ちびキャラ(開発用) / Cubism 2」であるため、cubism2は主要経路であって後回しにできない。

> **実測確認済み(A2)**: 上表の構造を開発用モデル(`dev-assets/live2d/`、Cubism2=Shizuku / Cubism4=Haru)で実測し、想定どおりであることを確認した。
> - Cubism4(Haru `haru_greeter_t03.model3.json`, `Version:3`): モーションは`FileReferences.Motions`のキー(実データ: `"Idle"`(3件)・`"Tap"`(2件))、表情は`FileReferences.Expressions[].Name`(実データ: `f00`〜`f07`)。
> - Cubism2(Shizuku `shizuku.model.json`): モーションは`motions`のキー(実データ: `idle`・`tap_body`・`pinch_in`・`pinch_out`・`shake`・`flick_head`)、表情は`expressions[].name`(実データ: `f01`〜`f04`)。
>
> 実装時に注意すべき実測差分:
> - **表情の`Name`はファイル名と一致しない**。Cubism4 Haruは`Name:"f00"→File:"F01.exp3.json"`と1つずれる。列挙・保存には必ず`Name`(cubism2は`name`)を使い、ファイル名から導出しない。
> - **モーションのグループ名の命名規則は一定でない**。公式サンプル2体の実測ではCubism4 Haruが`Idle`/`Tap`(PascalCase)、Cubism2 Shizukuが`idle`/`tap_body`等(snake_case)だったが、これは**モデル作者の命名慣習**であり、Cubism仕様がバージョンごとに規則を強制しているわけではない(n=1×2)。「cubism4なら常にPascalCase」とハードコードしない。自動マッピング(下記SYNONYMS/`normalize()`)は特定の命名規則に依存せず、大文字小文字・区切り差を吸収する実装にする。
>   - なお`tap_body`の`body`は`hit_areas`の当たり判定名(`head`/`mouth`/`body`)に由来する反応モーションだが、**全モーショングループが`hit_areas`と1:1対応するわけではない**(`pinch_in`/`shake`等は対応する当たり判定を持たない)。

#### UI: 行タップでインライン展開

モックアップの表示幅は`width: 400`固定。`Row`はラベルを左、コントロールを右に置くレイアウトなので、**右側に残る幅は180px程度しかなく、2つのselectを横並びにすると読めない**。

よって行自体をタップして**インラインで展開**し、モーション・表情のselectを全幅で表示する。

```
┌────────────────────────────────┐
│ happy            TapBody / exp_smile  ▶ │  ← 通常時(モックアップのRowのまま)
├────────────────────────────────┤
│   モーション  [ TapBody          ▾ ]    │  ← 展開時
│   表情        [ exp_smile        ▾ ]    │
│                        [自動に戻す]     │
└────────────────────────────────┘
```

一度に展開するのは1行だけ(`expandedKey: string | null`)。これはモックアップが既に採用している`deleteConfirmId`(同時に1つだけ確認状態を持つ)と同じ考え方で、新しい概念を持ち込まずに済む。

各selectの先頭には`— (なし)`を置き、`null`を選べるようにする。data.md 2.1の`panic`が`{ "motion": null, "expression": null }`であるとおり、**両方nullは正当な状態**(実行時に`idle`へフォールバックする、C-18)。

#### 自動検出と手動修正の関係

**自動検出はモデル取り込み時に1度だけ実行し、結果を`manifest.json`へ書く。以後は再実行しない。**

CLAUDE.mdが定めるとおり`manifest.json`がマッピングの正本であり、自動検出はその初期値を作るだけの存在にすぎない。起動のたびに自動検出を走らせると、ユーザーの手動修正を黙って上書きしかねない。「自動検出を上書きしたら記憶するか」という問いに対しては、**そもそも上書きという概念を作らない**(自動検出は初期値の生成器であって、実行中に競合しない)ことで答える。

やり直したい場合のために、展開行の`[自動に戻す]`(その状態だけ再検出)と、Section単位の`[自動割り当てをやり直す]`(全10状態、確認ダイアログつき)を用意する。どちらもユーザーの明示的な操作を起点とする。

### 論点3: スプライトセットのクリップ差し替え

#### 「変更」ボタンの挙動: 追加フローと同じ`<input type=file>`(当初案から訂正)

**当初案(ダイアログ+ドロップの両対応)は、実装フェーズで判明した制約により`<input type=file>`のみへ訂正した。** decode-video.mdの「WebCodecs → HTMLVideoElement」訂正と同じ構図で、動画の取得方法が当初の想定と異なるための修正であり、結論(差し替えと新規追加で経路を分けない)は維持される。

当初は次の両対応を予定していた:

- ~~**クリック**: `dialog.showOpenDialog`をmp4/webmフィルタつきで開く~~
- ~~**行へのドロップ**: 同じ取り込み処理へ流す~~

実装した方式(取り込みフロー`SpritesetAddFlow`と統一):

- **クリック**: Rendererの隠し`<input type="file" accept="video/*">`を開き、選ばれた`File`を`decodeAndKeyVideo`(decode-video.ts)へ渡す。
- ドロップは**実装しない**。

理由:

1. **デコードはRenderer(Chromium)でしか行えない**(spriteset-pipeline.md / decode-video.md)。`HTMLVideoElement`でデコードするにはブラウザが握る`File`オブジェクトが要る。`dialog.showOpenDialog`が返すのは**Main側のファイルパス文字列**で、それをRendererの`<video>`に読ませるにはローカルサーバー経由の再配信等が別途要る。ユーザー操作起点の`<input type=file>`なら`File`が直接手に入り、余計な経路を作らずに済む。
2. **追加フロー(2b-2)自体がすでに`<input type=file>`のみ**でドロップ非対応。「追加時に覚えた操作が差し替え時に通じない」という当初の懸念は、追加側も`<input>`ボタン方式に落ち着いたことで、**むしろ`<input>`で揃えるほうが一貫する**形になった。
3. Renderer→Mainへ**パスを渡さない**という既存の不変条件(Renderer由来のパスを信じる経路を作らない。model-manage.ts / security.md)とも整合する。バイト列はRendererに留まり、Mainへ渡るのは色キー抜き済みPNGフレームだけ。

取り込み後の処理はspriteset-pipeline.mdで確定済みのパイプライン(Chromiumでデコード → 色キー抜き → sharpでアニメーションWebPへ)をそのまま通す。**差し替え時のみ`setSpritesetClip`が寸法を既存の`baseResolution`と一致必須にする**(単一baseResolution前提を壊さないため。別解像度にするならモデルを作り直す)。

#### 削除(未割当に戻す)導線

モックアップに存在しないため新設する。展開行に`[削除]`を置き、**モデル削除と同じインライン確認**(モックアップL533-555の`deleteConfirmId`パターン)を踏襲する。別のモーダルを持ち込まない。

**`idle`は削除できない**。C-18により`idle`は必須で、他の状態のフォールバック先でもある。`idle`の行には削除を出さない(グレーアウトではなく非表示。押せないボタンを見せる意味がない)。

削除は`manifest.json`の`clips`から当該キーを除去し、WebPファイル自体も削除する。実行時は`clips`にキーが無い状態 = 未割当として`idle`へフォールバックする。

### 論点4: 自動マッピングのマッチングロジック

#### 適用範囲: Live2Dのみ

**スプライトセット形式には自動マッピングを実装しない。**

モックアップのスプライトセット追加フローは、全10状態を行として並べ、**各行ごとに個別の「取り込む」ボタンで動画を受け取る**(L693-732)。つまりクリップと感情の対応は生成フローの構造上1:1で確定しており、名前から推測する余地がそもそも無い。

一方Live2Dは、モーショングループ名・表情名を**モデルの作者が自由に付ける**(モックアップのヒント文も「モデルごとのモーション名は作者によって違うため、ここで割り当てます」と述べている)。自動マッピングが必要なのはこちらだけである。

この非対称は形式の性質に由来する正当なものだが、「スプライトセット側を実装し忘れている」と誤読されないよう明記しておく。

#### アルゴリズム

```typescript
/** 比較用に名前を正規化する。'exp_smile_soft.exp3.json' -> 'smilesoft' */
function normalize(name: string): string {
  return name
    .replace(/\.(exp3\.json|motion3\.json|mtn|json)$/i, '') // 拡張子
    .toLowerCase()
    .replace(/^exp[_-]?/, '')          // 表情名の慣用プレフィックス
    .replace(/[^a-z0-9぀-ヿ一-鿿]/g, ''); // 記号・空白を除去
}

const SYNONYMS: Record<EmotionState, string[]> = {
  idle:      ['idle', 'normal', 'neutral', 'default', 'wait', '待機', '通常'],
  confident: ['confident', 'smilesoft', 'softsmile', 'fine', '自信', '昂揚'],
  tired:     ['tired', 'weary', 'exhausted', 'down', '疲', '減衰'],
  thinking:  ['thinking', 'think', 'thought', '考'],
  happy:     ['happy', 'smile', 'joy', 'laugh', 'fun', '笑', '喜'],
  proud:     ['proud', 'pride', 'boast', '得意', '誇'],
  worried:   ['worried', 'worry', 'sad', 'sorrow', 'trouble', '困', '悲', '心配'],
  panic:     ['panic', 'surprise', 'surprised', 'shock', '驚', '慌'],
  curious:   ['curious', 'question', 'wonder', 'interest', '疑問', '興味'],
  sleepy:    ['sleepy', 'sleep', 'doze', 'yawn', '眠', '寝'],
};

/** 候補名がその状態にどれだけ合致するか。0なら不一致 */
function score(state: EmotionState, candidate: string): number {
  const n = normalize(candidate);
  if (n === state) return 1000;                       // 完全一致が最優先
  let best = 0;
  for (const syn of SYNONYMS[state]) {
    if (n.includes(syn)) best = Math.max(best, syn.length); // 長い語ほど具体的
  }
  return best;
}
```

**スコアを「一致した同義語の長さ」にしている点が要**。これが無いと`exp_smile_soft`が`happy`(`smile`が部分一致)と`confident`(`smilesoft`が部分一致)の両方にヒットして決着しない。長い方=より具体的な語を勝たせることで、`smilesoft`(9文字) > `smile`(5文字)となり`confident`が取る。

マッチングの規則:

1. モーション候補・表情候補それぞれについて、全10状態を独立に評価する。
2. 各状態は最高スコアの候補を取る。スコア0なら**未割当**にする(無理に埋めない。C-18により実行時は`idle`へフォールバックするので、誤った割当より未割当のほうが害が小さい)。
3. **同じ候補名が複数の状態に使われてよい**。data.md 2.1で`TapBody`が`happy`と`confident`の両方に割り当たっているとおり、排他ではない。
4. 同点の場合はファイル内の出現順で先勝ち(結果を決定的にするため。同じモデルを2度取り込んで違う結果になってはいけない)。

#### 実測結果

上記の実装をdata.md 2.1の`emotionMap`例に登場する表情名・モーション名に対して実行した(表情: `exp_normal` / `exp_smile` / `exp_smile_soft` / `exp_tired` / `exp_proud` / `exp_worried` / `exp_curious`、モーション: `Idle` / `TapBody`)。

| 状態 | 自動割当(表情) | 自動割当(モーション) | data.md 2.1の例 |
|---|---|---|---|
| idle | exp_normal (6) | **Idle** (1000) | motion: Idle |
| confident | **exp_smile_soft** (9) | 未割当 | TapBody / exp_smile_soft |
| tired | **exp_tired** (1000) | 未割当 | exp_tired |
| thinking | 未割当 | 未割当 | exp_normal |
| happy | **exp_smile** (5) | 未割当 | TapBody / exp_smile |
| proud | **exp_proud** (1000) | 未割当 | exp_proud |
| worried | **exp_worried** (1000) | 未割当 | exp_worried |
| panic | 未割当 | 未割当 | null / null |
| curious | **exp_curious** (1000) | 未割当 | exp_curious |
| sleepy | 未割当 | 未割当 | null / null |

10状態中7つがdata.mdの例と一致した。狙いどおり`exp_smile_soft`は`confident`、`exp_smile`は`happy`へ分かれている。**一致しなかった2点は以下のとおりで、いずれも許容する**。

- **`exp_normal`の帰属**: data.mdは`thinking`に割り当てているが、自動検出は`idle`に割り当てる(`normal`が`idle`の同義語であるため)。結果`thinking`は未割当になるが、C-18により実行時は`idle`へフォールバックし、その`idle`が`exp_normal`を持つため、**画面上の見た目はdata.mdの例と実質同じになる**。害が無いので同義語辞書を捻じ曲げてまで合わせにいかない。
- **`TapBody`が全状態で未割当**: 後述のとおり意図した挙動。

`TapBody`のようなCubism標準サンプル由来の名前はどの同義語にも一致せず未割当になる。これは意図した挙動で、ユーザーが論点2のUIで手動割当する。**自動マッピングは「当たれば儲け」の初期値生成であり、精度を追わない。** 誤った割当を自信満々で埋めるより、未割当のまま`idle`へフォールバックさせるほうが害が小さい。

なお`normalize()`が`Idle` → `idle`(完全一致1000点)、`exp_smile_soft` → `smilesoft`と正しく畳めることも実測で確認済み。

### 論点5: モデル名の変更(モックアップに無い機能を追加した判断)

**モックアップ(docs/mockups/control-panel.jsx)には名前変更の導線が無い**。既定名`新しいモデル`(またはLive2Dのフォルダ/zipファイル名)で登録したまま、変更する手段が無い状態だった。

要件定義書・basic-design.mdのFR-5は「モデル管理」を包括的に定義しており、削除やスロット選択と同様に**個別のUI操作としてモックアップに明示されていない**が、既定名のまま変更できないのはFR-5の趣旨(モデルを管理する)に反する実装漏れと判断し、**モックアップに存在しない機能として追加した**。要件レベルの変更(Notion正本の更新)を伴うほどの新規要件とは考えていない(削除機能も同様の粒度でモックアップの明示なしに実装済みの前例がある)。

**決定**: モデル一覧の名前ラベルをクリックするとインライン編集(鉛筆アイコンで導線を示す)。Enter確定・Escapeキャンセル・blurは確定として扱う。**名前は`config.model.slots[].name`のみが正本**で、manifest.json・ファイルシステムには一切触れない(`installedDir`とは独立)。検証(前後空白除去・空文字拒否・上限40文字)はMain側`parseModelName`に一本化し、UI側は上限文字数だけ`maxLength`で反映する(二重実装せず、かつ上限超過時の入力消失を防ぐ)。実装は`src/main/model/model-service.ts`(`renameModel`/`parseModelName`)・`src/renderer/control-panel/src/ModelTab.tsx`(`ModelNameEditor`)。

形式非依存: `renameModel`は`renderType`で分岐しない(config.model.slotsの`name`フィールドのみを操作するため、対称性チェックの対象外)。

## 検出した不整合(本ドキュメントでは修正しない)

実装前に決着が必要なものを記録する。いずれも要件・基本設計に関わるため、Notion正本の更新を伴う。

1. ~~**`displaySize`の範囲がモックアップとスキーマで食い違う。**~~ **決着済み(2026-07-27・未決事項C6)**: `git log`でスキーマの`0.1〜2.0`が初回スキャフォールドから決定根拠の記録無く存在していたことを確認し、モックアップのスライダー範囲(`min="20" max="100"`=0.2〜1.0)の方をユーザーに確認のうえ正とした。**常駐マスコットが画面を占有しすぎず視認できる範囲**という判断。スキーマ・data.md・basic-design.md(Notion正本)を`min(0.2).max(1)`へ統一済み(既定値0.5は変更なし)。
2. ~~**`cubismVersion`のenumにcubism5が無い。**~~ **決着済み(2026-07-28棚卸しで判明。追加のコード変更は無し)**: `config-schema.ts`・`docs/data.md`・`docs/basic-design.md`の3箇所とも`z.enum(['cubism2', 'cubism4'])`の直後に「`'cubism4'`はCubism 5モデル(model3.json形式)も含む」とコメントで明示済み(A1+B一括反映時に対応)。enumに`cubism5`を追加する変更は不要と判断された。
3. ~~**権利情報タブのOSS一覧に`sharp` / `libvips`が無い**~~ **決着済み(2026-07-28棚卸しで判明。追加のコード変更は無し)**: `sharp`が`package.json`の`dependencies`に入って以降、`generate:licenses`の自動走査で`sharp`(MIT)・`@img/sharp-darwin-arm64`(Apache-2.0)・`@img/sharp-libvips-darwin-arm64`(LGPL-3.0-or-later)が`src/shared/oss-licenses.ts`へ既に反映されており、`RightsTab.tsx`が動的表示している。下記の「libvips自体はnpm package.jsonを持たない」という懸念は誤りで、`@img/sharp-libvips-*`パッケージがpackage.json上でLGPL-3.0-or-laterを宣言しているため自動走査で拾える。**ただしlibvips本体(Cソース)のNOTICE同梱条件は配布フェーズの別課題として残る**(自動生成=権利表示完了ではない、という下記注意は引き続き有効)。
   - **FR-12実装時の補足(2026-07-21)**: OSS一覧は`scripts/generate-oss-licenses.mjs`が`dependencies`を推移的に辿って自動生成する方式にした。**LGPL-3.0の表記・同梱条件は配布NOTICE段階で別途対応が必要**(「自動生成したから権利表示は完了」と誤解しないこと)。
4. ~~**フォントをGoogle Fontsから`@import`している**(モックアップL105)。~~ **決着済み(2026-07-28・未決事項C2)**: `@fontsource/zen-antique`・`@fontsource/m-plus-1-code`・`@fontsource/jetbrains-mono`(いずれもOFL-1.1)でローカル同梱へ変更。`src/renderer/control-panel/src/fonts.css`(`main.tsx`でimport)。ビルド時にバンドルされ実行時の外部リクエストは発生しない。Notion正本(要件定義書9章)→`docs/requirements.md`へ反映済み。詳細はMemory.md「未決事項C2決着」参照。

## 実装時のTODO

- [x] `lucide-react`を依存に追加する(`package.json` に `^1.25.0` で追加済み。UI移植時)
- [x] モックアップの`EMOTION_STATES`を`src/shared/emotions.ts`へ寄せ、プロンプト文言は別テーブルへ分離する → **実装済み(第2段階b-2)**。`SpritesetAddFlow.tsx`は状態集合を`src/shared/emotions.ts`の`EMOTION_STATES`から直接importし(モックアップのローカル配列を複製しない)、プロンプト/ラベル文言は`src/shared/spriteset/clip-prompts.ts`の`CLIP_PROMPTS`(`Record<EmotionState, ClipPrompt>`)へ分離済み。このTODOのチェックだけが更新漏れだった
- [x] Cubism 2 / 4 の列挙処理を**実モデルで検証**した(A2、`dev-assets/live2d/` Shizuku/Haru)。上記「論点2/列挙元」の表を実測確認済み。表情の`Name`はファイル名と不一致・グループ名の命名規則が一定でない(作者慣習)点に注意(同節参照)
- [x] 自動検出時に**idleグループの存在を検証する**(Cubism4=`"Idle"` / Cubism2=`"idle"`)。無い場合、モーション終了後にフォールバック先が無く固まりうる(lipsync.md「尽きたときの挙動」①)。**実装済み(第2段階a)**: `live2d-import.ts` `autoMapLive2d` が `idleMotionMissing` を返し、`model-importer.ts` が取り込み時に警告としてUIへ伝える(取り込み自体は通す)
- [x] 取り込み時、**モデル定義ファイルが参照するパスが自身のモデルフォルダ内に閉じていることを検証する**(`../`等での逸脱を拒否)。security.md の`GET /models/*`パス検証と対になる入口側の検証。**公式サンプルHaru(`haru_greeter_t03.model3.json`)自体が`Sound`で兄弟フォルダ`../shizuku/sounds/`を相対参照する実例があり**、机上の懸念ではない(A2で発見)。**スプライトセットには対応物不要**(`clips`はアプリ自身が生成し、第三者が作成した定義ファイルのパス文字列を一切パースしないため。spriteset-pipeline.md)。**実装済み(第2段階a)**: `live2d-import.ts` `assertPathsWithin` がレンダリング必須アセット(moc/textures/physics/pose/expressions/motions)の逸脱を弾く。Sound/DisplayInfo/UserDataは検証対象外(v1で使わず、Haruが正当に外部参照するため。除外理由をコード冒頭に明記)
- [ ] プレビューの遅延マウント/destroyがメモリ目安(200MB前後)に収まるか実測する
- [x] **(決着済み・2026-07-27)** 上記「検出した不整合」1(`displaySize`の範囲)の決着。モックアップ側(0.2〜1.0)を正としNotion正本→docs→config-schema.tsへ反映済み
- [x] **(決着済み・2026-07-28棚卸し)** 上記「検出した不整合」2(cubismVersion enum)の決着。コメント明示のみで対応済み、enum追加は不要と判断
- [x] **(決着済み・2026-07-28棚卸し)** 上記「検出した不整合」3(OSS一覧のsharp/libvips)の決着。自動生成で既に反映済み(libvips本体のNOTICE同梱は配布フェーズの別課題として残る)
- [x] **(決着済み・2026-07-28)** 上記「検出した不整合」4(フォントのGoogle Fonts `@import`)の決着。未決事項C2参照
