# character-window.md — キャラクター表示ウィンドウ詳細設計

**ステータス**: 確定(2026-07-16)。ただし「実装前に決着が必要な事項」を1件残す(末尾参照)
**対応FR**: FR-6
**関連**: basic-design.md 5.1(CharacterRenderer)、security.md 7章(モデルアセット配信)、要件定義書 C-19

## 背景

FR-6は「透過・枠なし・常に最前面・クリックスルー」という要件までは確定しているが、以下の挙動の詳細は未確定。

## 結論

| 論点 | 決定 |
|---|---|
| 初期配置 | プライマリディスプレイの**workAreaの右下**、マージン24px |
| 位置の永続化 | `config.general.windowPosition`(nullable)。nullなら初期配置を計算 |
| 起動時の位置検証 | **必須**。現在のディスプレイ構成で十分に可視でなければ最寄りへクランプ |
| マルチモニタ | 保存位置をそのまま採用。可視性を失ったときだけ介入する |
| 最前面レベル | `setAlwaysOnTop(true, 'floating')` |
| 操作面 | メニューバーアイコン(常設) + 右クリックメニュー(クリックスルーOFF時) |

## 検討ログ

以下はすべて実機(macOS / Electron 43.1.1)で実測した結果に基づく。検証時のディスプレイ構成は2画面で、**内蔵2240×1260@2xがプライマリ、外部1920×1080@1xがその「下」(y=1260)にx方向へ169ずれて配置**という、単純な横並びではない構成だった。

### 論点1: マルチモニタ挙動

#### 最重要の実測結果: macOSは画面外座標を補正しない

`BrowserWindow.setBounds({ x: 99999, y: 99999, width: 400, height: 400 })` を実行し、直後に`getBounds()`で読み戻したところ、**要求した座標がそのまま返ってきた**(クランプなし)。

つまり本ドキュメントが警告していた「見えない場所にウィンドウが出る」は、OSが救ってくれない実在のリスクである。**アプリ側で自前の可視性検証・クランプを実装することが必須**であり、これを省略すると、モニタを外した状態で起動した際にキャラクターが永久に到達不能になる。

危険な経路は具体的には**起動時**である。2画面環境で外部モニタ上に置いたまま終了 → モニタを外して起動 → 保存された座標をそのまま`setBounds`する → 画面外に出る、という流れになる。したがって検証は「保存位置を適用する直前」に必ず挟む。

#### 方針: 見失ったときだけ介入する

ユーザーが意図して置いた位置を、アプリが勝手に動かしてはならない。介入するのは**そのままでは操作不能になる場合だけ**に限る。判定と復帰は以下とする。

```typescript
const MIN_VISIBLE = 80; // 掴んで動かせる最低限の露出量(px)

/** 現在のディスプレイ構成で十分に可視か。どれか1つのworkAreaと十分に重なればよい */
function isSufficientlyVisible(bounds: Rect, displays: Display[]): boolean {
  return displays.some(d => {
    const i = intersect(bounds, d.workArea);
    return i.width  >= Math.min(MIN_VISIBLE, bounds.width)
        && i.height >= Math.min(MIN_VISIBLE, bounds.height);
  });
}

/** 見失った場合の復帰先: ウィンドウ中心から最寄りのディスプレイのworkArea内へ引き戻す */
function clampToNearest(bounds: Rect): Point {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const wa = screen.getDisplayNearestPoint(center).workArea;
  return {
    x: Math.round(Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width  - bounds.width)),
    y: Math.round(Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - bounds.height)),
  };
}

function resolvePosition(saved: Point | null, size: Size): Point {
  if (!saved) return defaultPosition(size);                       // 初回起動
  const bounds = { ...saved, ...size };
  if (isSufficientlyVisible(bounds, screen.getAllDisplays())) return saved;  // 尊重する
  return clampToNearest(bounds);                                  // 見失った場合のみ介入
}
```

`bounds`(モニタ全域)ではなく**`workArea`(メニューバー・Dockを除いた領域)を基準にする**。workAreaはDockの表示状態・位置を自動で反映するため、Dockの下にキャラクターが潜り込む事故をアプリ側で計算せずに避けられる。

`getDisplayNearestPoint()`は範囲外の座標を渡しても必ず実在するディスプレイを返すことを確認済み(`(99999, 99999)`→外部モニタを返した)。復帰先の決定に安全に使える。

#### 検証結果(実機2画面構成、8ケース)

上記の実装を実機で実行し、全ケースが可視な位置に解決することを確認した。

| 入力 | 結果 | 挙動 |
|---|---|---|
| null(初回起動) | (1816, 836) | 初期配置を計算 |
| プライマリ内 (100, 100) | そのまま | 可視なので尊重 |
| 外部モニタ内 (300, 1400) | そのまま | 可視なので尊重 |
| 画面外の遠方 (99999, 99999) | (1689, 1940) | 外したモニタの残骸を想定。クランプ |
| 負座標 (-5000, -5000) | (0, 30) | クランプ(y=30はメニューバー下端) |
| ディスプレイ間の隙間 (0, 1500) | そのまま | 外部モニタと231px重なるため可視 |
| メニューバーに食い込む (100, 0) | そのまま | 370px可視。ユーザーの意図として尊重 |
| 端でギリギリ露出 (2200, 200) | (1840, 200) | 露出40px < MIN_VISIBLE のためクランプ |

**「ディスプレイ間の隙間」ケースが重要**: 実機の構成では2枚のディスプレイがx方向にずれているため、どのディスプレイにも属さない座標帯が存在する。単純に「プライマリのbounds内か」で判定する実装だとこのケースを誤判定する。workAreaとの重なり面積で判定することで正しく処理できている。

#### 未解決のトレードオフ: MIN_VISIBLE の値

最後のケース(露出40px)は現状クランプされるが、**「画面端からキャラクターが半分だけ覗いている」配置はデスクトップマスコットとしてはむしろ望ましい**という見方もできる。MIN_VISIBLE=80pxはこれを許さない。

現状は「見失うリスクの回避」を優先して80pxとしたが、これはチューニング可能なパラメータとして扱う。なお**ドラッグ操作中は一切クランプしない**(ユーザーは掴んでいる最中なので見失いようがない)。検証は起動時と`display-removed`/`display-metrics-changed`受信時のみ行う。

#### ディスプレイ構成変更の監視

`screen`モジュールの`display-added` / `display-removed` / `display-metrics-changed` を購読し、受信時に`resolvePosition`を再適用する。ただし前述のとおり、可視性を失った場合のみ実際に移動する。

### 論点2: 初期配置ロジック

```typescript
function defaultPosition(size: Size): Point {
  const wa = screen.getPrimaryDisplay().workArea;
  const MARGIN = 24;
  return {
    x: Math.round(wa.x + wa.width  - size.width  - MARGIN),
    y: Math.round(wa.y + wa.height - size.height - MARGIN),
  };
}
```

**プライマリディスプレイのworkAreaの右下**とする。理由:

- **プライマリ固定**: 初回起動時点では「最後に表示した位置」が存在しない。メニューバーのあるディスプレイ = ユーザーが今見ている画面である可能性が最も高い。
- **右下**: 上端(メニューバー)・左上(信号機ボタンを持つ他アプリのウィンドウが集まる領域)を避けられる。workArea基準なのでDockとも衝突しない。
- **マージン24px**: 画面端にぴったり吸着していると、初回起動時にキャラクターが見切れているように見える。

`windowPosition`は**ドラッグ終了時に保存する**(`moved`イベントのたびに書くとconfig.jsonへの書き込みが頻発するため、ドラッグ完了時にデバウンスして保存する)。

#### 未解決: ウィンドウサイズの算出元が形式間で非対称(**実装前に決着が必要**)

`defaultPosition`は`size`を引数に取るが、**その`size`をどう決めるかが形式間で揃っていない**。

- **スプライトセット**: `ModelSlot.baseResolution`(config.jsonが保持)× `general.displaySize` で決まる。
- **Live2D**: `ModelSlotSchema`に`baseResolution`が**存在しない**(basic-design.md 6.1でspriteset専用フィールドとして定義されている)。実際のキャンバスサイズはCubismモデル(`model3.json`)側が持っており、モデルをロードするまで確定しない。

つまりLive2D形式では「ウィンドウを作る時点で必要なサイズ」が「モデルをロードしないと分からない」という順序の問題が生じる。これは**CLAUDE.mdの対称性チェックが想定している典型的な非対称**であり、片方(スプライトセット)だけ見て実装すると必ずLive2D側で破綻する。

考えられる解決案(いずれもbasic-design.md 5.1 = **Notion正本の変更を伴う**ため、本ドキュメントでは決定しない):

1. `CharacterRenderer`に`getBaseSize(): Size`を追加し、両実装が自身の基準サイズを返す。ウィンドウは仮サイズで生成し、`mount()`後に`setSize()`で確定させる。
2. `ModelSlotSchema.baseResolution`をspriteset専用ではなく**形式共通の必須フィールド**に変更し、Live2Dの取り込み時に`model3.json`から読んでconfigへ書き込む。ウィンドウ生成前にサイズが確定するため順序の問題が消える。

**案2を推奨する**。ウィンドウ生成 → モデルロード → リサイズという流れは、透過ウィンドウのちらつき(生成直後に一瞬別サイズで描画される)を招きやすい。案2なら`baseResolution`が「形式を問わずモデルの基準解像度」という一貫した意味を持ち、6.1のコメント`// spritesetのみ`を削除するだけで済む。

### 論点3: 右クリックメニューとメニューバーアイコン

#### 前提: クリックスルーONでは右クリックメニューに到達できない

`general.clickThrough`の既定値は`true`であり、この間ウィンドウはマウスイベントを一切受け取らない。したがって**右クリックメニューは既定では開けない**。当初この項目一覧に挙がっていた「クリックスルーの一時解除」は、それ自体がクリックスルー中には押せないため成立しない。

この行き止まりの解消として**メニューバーアイコンを常設**することが決定した(要件定義書 C-19)。既定値`clickThrough: true`は維持する。

#### メニュー項目(メニューバーアイコン / 右クリック共通)

両者は**同一のテンプレートビルダーから生成する**。別々に定義すると必ず片方だけ更新される。

| 項目 | 種別 | 備考 |
|---|---|---|
| Control Panelを開く | normal | 既に開いていればフォーカス |
| — | separator | |
| モード: Code | radio | `activeAdapter`と同期 |
| モード: Chat | radio | 同上 |
| — | separator | |
| クリックスルー | checkbox | `general.clickThrough`と同期 |
| 位置をリセット | normal | `defaultPosition()`へ戻す。**最後の復帰手段** |
| — | separator | |
| ヨリマシ.appを終了 | normal | |

「位置をリセット」は、自動クランプが何らかの理由で機能しなかった場合の手動の逃げ道として必ず用意する。論点1で確認したとおりOSは救ってくれないため、この項目は保険として意味を持つ。

アイコンは`nativeImage`のテンプレート画像(`setTemplateImage(true)`)とし、macOSのライト/ダークメニューバーに自動追従させる。

#### `app.dock.hide()`について

常駐アプリなのでDockアイコンを出さない選択肢がある(`app.dock.hide()`が利用可能であることは確認済み)。ただし**Dockアイコンを消すとControl Panelウィンドウをアクティブ化する手段がメニューバー経由のみになる**ため、v1ではDockアイコンを表示したままとし、`dock.hide()`は将来の検討事項に留める。

### ウィンドウ生成オプション(FR-6の機構)

実測で確認済みの設定は以下。

```typescript
const win = new BrowserWindow({
  transparent: true,
  frame: false,
  resizable: false,
  hasShadow: false,      // 透過ウィンドウに影が付くと矩形の輪郭が見えてしまう
  skipTaskbar: true,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
});
win.setAlwaysOnTop(true, 'floating');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
```

#### `alwaysOnTop`のレベル選択(実測結果)

| レベル | `isAlwaysOnTop()` |
|---|---|
| `'normal'` | **false** |
| `'floating'` | true |
| `'pop-up-menu'` | true |
| `'screen-saver'` | true |

**`'normal'`を渡すと最前面が無効になる**(第1引数に`true`を渡していても`isAlwaysOnTop()`が`false`を返す)ので使ってはならない。

`'floating'`を採用する。`'screen-saver'`は他アプリのフルスクリーン表示(動画再生・プレゼンテーション)の上にまで居座るため、常駐マスコットとしては攻撃的すぎる。`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`と併用することで、Spaces切替には追従しつつ、フルスクリーンアプリを妨げない挙動になる。

#### クリックスルーの切替

```typescript
win.setIgnoreMouseEvents(true, { forward: true });  // ON
win.setIgnoreMouseEvents(false);                     // OFF
```

`{ forward: true }`を付けると、マウスイベントを下のウィンドウへ透過させつつ**Renderer側では`mousemove`を受け取り続けられる**。これはカーソルがキャラクターに乗ったときのホバー演出や、後述のアルファ判定に必要となる。

#### ドラッグ移動の実装方式

`-webkit-app-region: drag`は**採用しない**。ドラッグ領域はマウスイベントを吸収するため、同じ領域で右クリックメニューを出せなくなり、論点3と衝突する。

代わりに、Renderer側で`mousedown`→`mousemove`を検知してIPCでオフセットをMainへ送り、`win.setPosition()`で追従させる。この方式なら`contextmenu`イベントが生き残り、将来スナップ処理を挟む余地も残る。

#### 透過部分のクリック判定について(v1では対応しない)

ウィンドウは矩形であるため、クリックスルーOFF時は**キャラクターの周囲の透明な領域もクリックを奪う**。理想はカーソル位置のアルファ値を見て`setIgnoreMouseEvents`を動的に切り替える方式だが、v1では実装しない。

理由は2つ。第一に、既定が`clickThrough: true`であるため、この問題が表面化するのはユーザーが意図的にOFFにした「今キャラクターを操作している」場面に限られ、矩形で反応しても不自然ではない。第二に、**この処理はLive2Dとスプライトセットで実装が異なる**ためである。

- Live2D: PixiJSのWebGLキャンバスからの読み出し(`gl.readPixels`相当)が必要で、`mousemove`ごとに行うとコストが高い。
- スプライトセット: 2Dキャンバスの`getImageData`で安価に取得できる。

つまり実装するなら`CharacterRenderer`に`hitTest(x, y): boolean`を追加して両形式に実装させる必要があり、これはbasic-design.md 5.1(= Notion正本)の変更を伴う。**片方だけ実装すると必ず破綻する**ため、やるなら両形式同時に行う。

## 実装時のTODO

- [ ] **(要決着・実装前)** ウィンドウサイズの算出元の非対称を解消する。案2(`baseResolution`を形式共通の必須フィールドへ)を推奨。Notion基本設計書 6.1 の変更が必要
- [ ] `resolvePosition`をMain側に実装し、起動時と`display-*`イベント時に適用する
- [ ] `windowPosition`のドラッグ終了時デバウンス保存
- [ ] メニューバーアイコン(`Tray`)と右クリックメニューを共通ビルダーから生成
- [ ] MIN_VISIBLE(暫定80px)の実使用でのチューニング
- [ ] Rendererの読み込み元を`http://localhost:8765/character`へ移行(security.md 7章)。現在のスキャフォールドは暫定的にloadFile
- [ ] 将来検討: 透過部分のアルファ判定(`CharacterRenderer.hitTest()`の追加を伴う)、`app.dock.hide()`
