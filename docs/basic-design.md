# ヨリマシ.app 基本設計書

> 本ファイルはNotionの基本設計書のミラーです。**Notionが正本**。要件定義書(WHAT)と詳細設計書(HOW: 実装レベル)の間を橋渡しする文書。
> 作成日: 2026-07-16 / 更新日: 2026-07-29(未決事項C0決着。6.1のconfigスキーマから`notion`/`obsidian`セクションを削除＝v1スコープ外・C-25)。2026-07-27: 未決事項C6決着。`general.displaySize`の有効範囲をモックアップのスライダーと一致させ0.2〜1.0へ変更 / 対象: FR-1〜FR-15(FR-8/FR-9は欠番)、非機能要件・セキュリティ要件を含む

## 1. 本書の位置づけ・対象範囲

- 要件定義書(何を作るか)と詳細設計書(どう実装するか)の間を埋める、システム構成・画面構成・データ構造・外部IFの設計書。
- 本書で扱う: システム全体構成、画面設計、主要コンポーネント設計、データ設計、外部インターフェース設計、セキュリティ設計。
- 本書で扱わない: 具体的なコード実装、テストケース、パラメータの具体値(詳細設計書へ)。

## 2. システム全体構成

```
│ Electron アプリ (メインプロセス)
│  ┌──────────────────────────────────┐
│  │ ローカルサーバー (Node.js http+ws)     │
│  │  127.0.0.1:8765 ・トークン認証必須      │
│  │  config.json (Zodバリデーション)        │
│  └──────┬───────────────────────────┘
│       │ IPC / HTTP
│  ┌────┴───────(Renderer)  ┌──────────────────────────(Renderer)
│  │ キャラクター表示ウィンドウ  │  Control Panel ウィンドウ(1つ)
│  │ CharacterRenderer(FR-5)  │  ┌──────────┐┌────────────┐
│  │ 透過・最前面・クリックスルー │  │会話ペイン  │◀│ 6タブ(FR-7) │
│  └────────────────────────  │  │(FR-15)   │↑│            │
│                             │  └──────────┘│└────────────┘
│                             │    タブで折りたたみ─┘
│                             └────────────────────────────
┌──────────────────┐
│ Claude Code(別プロセス)  │
│ hooks → dispatch.sh    │
│ (FR-2)                  │
└──────────────────┘
│ 外部動画生成AIサービス(ブラウザ・別プロセス) ─ Pika/Canva等、スプライトセットの生成のみに使用(FR-5)
```

## 3. プロセス構成

| プロセス | 実行環境 | 役割 |
|---|---|---|
| Electron Main | Node.js | ウィンドウ生成、ローカルサーバー、config.json管理 |
| キャラクター表示ウィンドウ | Chromium(Renderer) | CharacterRendererによるLive2D/スプライトセット描画 |
| Control Panelウィンドウ | Chromium(Renderer) | 左に会話ペイン(FR-15)、右に6タブUI(FR-7)。config編集 |
| Claude Code hooks | bash(dispatch.sh) | イベントをローカルサーバーへPOST |

## 4. 画面設計

### 4.1 画面一覧

| 画面 | 種別 | 対応FR |
|---|---|---|
| キャラクター表示ウィンドウ | 常駐(透過・最前面) | FR-6 |
| メニューバーアイコン | 常駐(メニューバー) | FR-6(クリックスルー時の常設操作面) |
| 会話ペイン | Control Panelウィンドウ内の左ペイン(常時表示、折りたためない) | FR-15(既定は展開) |
| Control Panel・ホーム | タブ | FR-1, FR-2 |
| Control Panel・モデル管理 | タブ | FR-5 |
| Control Panel・モード設定 | タブ | FR-1, FR-3 |
| Control Panel・全体設定 | タブ | FR-10, 配色テーマ |
| Control Panel・ログ | タブ | FR-11 |
| Control Panel・権利情報 | タブ | FR-12 |
| オンボーディング(4画面) | 初回起動のみ | FR-14(各画面詳細は詳細設計で確定) |

### 4.2 Control Panelタブ構成(モックアップ済み)

- **ホーム**: 現在のアダプタ切替、Code Adapter接続状態、表示中モデルを一目で確認。
- **モデル管理**: セット中モデル一覧(形式バッジ付き)、モード連動自動切替、追加形式選択(スプライトセットを既定)、画像アップロード→AI生成アシストフロー、全10状態マッピング、削除(インライン確認付き)。
- **モード設定**: Code Adapter(監視パス・ポート・連続失敗閾値)、Chat Adapter(mock/real切替、real選択時の警告表示、real時の応答モデル選択=Opus 4.8/Sonnet 5/Haiku 4.5)。
- **全体設定**: 配色テーマ(light/dark/system 3選択)、表示サイズ・クリックスルー・自動起動、EmotionEngineパラメータ。
- **ログ**: hooksイベントログ一覧、エクスポート(パス仮名化)、消去。
- **権利情報**: Live2D利用区分、外部動画生成AIサービスのToS注意、OSSライセンス一覧、フォント、持ち込みモデルの著作権注意、Anthropic API利用に関する注記。

### 4.3 デザインシステム

- **配色**: `THEMES`オブジェクト(light=白望/dark=漆黒)を単一の情報源とし、React Context(`ThemeCtx`)で各コンポーネントに供給。system選択時は`window.matchMedia('(prefers-color-scheme: dark)')`でOS設定を検知・追従。
- **タイプ**: 見出し=Zen Antique、本文/操作要素=M PLUS 1 Code、数値系=JetBrains Mono。
- **シグネチャモーション**: 呪紋(魔法陣)リングの二重回転 + HUD四隅ブラケット。Moodに応じて色・回転速度が変化。

### 4.4 会話ペイン (FR-15)

Control Panelウィンドウの左ペイン。既定で展開、常時表示で折りたためない。縁のタブでControl Panel(6タブ)側を折りたたむと会話ペインが全幅表示になる(状態はconfigに保存)。憑坐状態帯(呪紋リング+Mood)・会話履歴(メモリのみ・streaming)・入力欄で構成する。

**入力欄まわりの機能(C-23)**: スラッシュコマンド(`/clear`・`/mock`・`/real`・`/code`・`/panel`・`/model`)、@参照(作業ログ・表示中のモデル・設定をユーザーが明示選択して文脈に含める限定的参照。agentic機能ではない)、添付・応答モデル選択(いずれもreal時)、停止(中断時も`release`)、メッセージ操作(コピー・再生成)、コンテキスト使用量表示(real時のみ実測)、入力ヒント。送信時は`activeAdapter`をChatへ自動切替し明示する(C-24)。UI詳細は詳細設計(detailed-design/chat-pane.md)。

## 5. 主要コンポーネント設計

### 5.1 CharacterRenderer抽象化 (FR-5, FR-6)

```typescript
interface CharacterRenderer {
  mount(container: HTMLElement): void;
  setState(stateKey: string, opts?: { crossfadeMs?: number }): void;
  destroy(): void;
}
class Live2DRenderer implements CharacterRenderer { /* pixi-live2d-display */ }
class SpriteSetRenderer implements CharacterRenderer { /* WebPクロスフェード再生 */ }
function createRenderer(model: ModelSlot): CharacterRenderer {
  return model.renderType === 'live2d' ? new Live2DRenderer(model) : new SpriteSetRenderer(model);
}
```

EmotionEngineは`renderer.setState(key)`を呼ぶだけで、形式を意識しない。透過はLive2DはWebGLネイティブアルファ、スプライトセットは色キー抜き後のWebPアルファで実現(どちらもFR-6を満たす)。

> **実装メモ(#5)**: 上の`createRenderer`は概念図。実装では **`async createRenderer(manifest, ctx): Promise<CharacterRenderer>`**(引数は`Manifest`+`RendererContext`、戻り値はPromise)としている。理由は、`pixi-live2d-display`がCubism外部ランタイム未ロードだと**import時点で例外を投げる**ため、ランタイム存在を確認してから`Live2DRenderer`を**動的import**する必要があり、動的importが非同期だから(`src/renderer/character/renderer/createRenderer.ts`)。抽象(`mount`/`setState`/`destroy`)自体は上記のとおり。

### 5.2 EmotionEngine (FR-4)

- Mood(idle/confident/tired)とReaction(thinking/happy/proud/worried/panic/curious/sleepy)の2層。全10状態。
- 優先度: panic > proud > worried > happy > curious > thinking > idle系。クールダウン(1.5秒目安)で連発を抑制。
- Reactionは既定でタイマー(3秒目安)でMoodに自動復帰する。ただし`sustain`付きで発火したReaction(Chat Adapter使用中の`thinking`、無操作中の`sleepy`)はタイマーで戻らず、明示的な`release()`が呼ばれるまで持続する。
- successStreak/failStreakによりMood自体も遷移(confident/tired)。しきい値は`emotionEngine`設定に持つ(Code/Chat両Adapterで共有するため)。

### 5.3 Adapter層 (FR-1〜FR-3)

- Code Adapter: hooksイベント → `engine.trigger()` / `engine.onToolResult()`。
- Chat Adapter: mock(キーワード判定) / real(Anthropic API + Haiku分類候補)。
- どちらも同一のEmotionEngineインスタンスを共有し、切替方式はホーム画面のトグルで行う。ただし会話ペイン(FR-15)からの送信時は、`activeAdapter`をChatへ自動切替しその旨を明示する(C-24。手動切替の唯一の例外)。

## 6. データ設計

### 6.1 config.json スキーマ(集約)

```typescript
const ModelSlotSchema = z.object({
  id: z.string(), name: z.string(),
  renderType: z.enum(['live2d', 'spriteset']),
  cubismVersion: z.enum(['cubism2', 'cubism4']).optional(), // live2dのみ。'cubism4'はCubism 5モデル(model3.json形式)も含む
  baseResolution: z.object({ width: z.number(), height: z.number() }), // 形式共通・必須。spritesetはmanifest.jsonから、live2dはmodel3.json/model.jsonのロード時に読み取って書き込む
  installedDir: z.string(), mappingFile: z.string().default('manifest.json'),
  assignedAdapter: z.enum(['code', 'chat']).nullable().default(null),
});
// 注: 感情↔クリップ(clips)の実体はここには持たせず、モデルごとのmanifest.jsonを正本とする(6.2参照)。
const AppConfigSchema = z.object({
  schemaVersion: z.literal(1),
  activeAdapter: z.enum(['code', 'chat']),
  chatAdapter: z.object({
    mode: z.enum(['mock', 'real']).default('mock'),
    anthropicApiKey: z.string().default(''),
    model: z.string().default('claude-sonnet-5'), // real時にユーザーが選択(Opus 4.8/Sonnet 5/Haiku 4.5)。mockでは未使用
    classifier: z.enum(['keyword', 'haiku']).default('keyword'), // mockでは常にkeyword(課金しない)
    classifierModel: z.string().default('claude-haiku-4-5'),
    idleTimeoutMs: z.number().default(30000), // streaming無通信ウォッチドッグのしきい値
    maxRetries: z.number().default(2),
    timeout: z.number().default(60000),
  }),
  codeAdapter: z.object({
    serverPort: z.number().default(8765),
    watchedProjectPaths: z.array(z.string()).default([]),
  }),
  model: z.object({
    slots: z.array(ModelSlotSchema).max(2).default([]),
    autoSwitchByMode: z.boolean().default(false),
    manualActiveId: z.string().nullable().default(null),
  }),
  emotionEngine: z.object({
    reactionDurationMs: z.number().default(3000),
    cooldownMs: z.number().default(1500),
    idleTimeoutMs: z.number().default(300000), // 無操作でsleepyへ移行するまでの時間
    failStreakThreshold: z.number().default(3), // Code/Chat両Adapterで共有
    successStreakThreshold: z.number().default(3),
  }),
  general: z.object({
    themeMode: z.enum(['light', 'dark', 'system']).default('system'),
    displaySize: z.number().min(0.2).max(1).default(0.5), // 常駐マスコットが画面を占有しすぎず視認できる範囲(モックアップのスライダーmin=20/max=100と一致。未決事項C6として決着・2026-07-27)
    windowPosition: z.object({ x: z.number(), y: z.number() }).nullable().default(null), // null=初回起動時。初期配置を計算する
    clickThrough: z.boolean().default(true),
    autostart: z.boolean().default(true),
    controlPanelCollapsed: z.boolean().default(false), // Control Panel(設定画面)側の折りたたみ状態(FR-15/C-23)
  }),
  onboarding: z.object({
    completed: z.boolean().default(false), // FR-14。falseの間だけ初回起動フローを表示する。スキップ完了もtrue
    completedAt: z.string().nullable().default(null), // ISO8601。未完了はnull
  }),
  // notion / obsidian は意図的に持たない(要件定義書10章スコープ外・C-25。未決事項C0の決着)
  logging: z.object({
    level: z.enum(['debug','info','warn','error']).default('debug'),
    hookEventLogPath: z.string().default('logs/hook-events.jsonl'),
    retentionDays: z.number().default(7),
    maskOnExport: z.boolean().default(true),
  }),
  distribution: z.object({
    macSigningIdentity: z.string().nullable().default(null),
    macNotarize: z.boolean().default(false),
    live2dCommercialLicense: z.boolean().default(false),
  }),
});
```

### 6.2 モデルディレクトリ構成

```
userData/models/<uuid>/
 ├─ manifest.json         # renderType, baseResolution, clips定義等(スプライトセットの正本)
 ├─ model3.json / *.moc3  # Live2D形式のみ
 └─ idle.webp, happy.webp 等  # スプライトセット形式のみ(全10状態分、idle以外は欠落可)
```

config.jsonの`ModelSlotSchema`は形式共通の最小限のメタデータ(renderType, cubismVersion, baseResolution等)のみを保持し、感情↔クリップの実際の対応(clips)はモデルごとのmanifest.jsonが正本となる。

### 6.3 hooksイベントログ

- 形式: JSONL(1行1イベント)、パーミッション0600。
- フィールド: `hookEventName, tool_name, exit_code, filePath, timestamp`。ファイルパス・プロジェクト名も含めて保存(7日で自動削除)。

## 7. 外部インターフェース設計

### 7.1 Claude Code hooks連携 (FR-2)

| イベント | トリガー |
|---|---|
| PreToolUse | engine.trigger('thinking') |
| PostToolUse | engine.onToolResult(true) |
| PostToolUseFailure | engine.onToolResult(false) |
| Notification | engine.trigger('curious') |
| Stop | Moodのみ idle寄りに重心移動 |
| UserPromptSubmit | engine.trigger('curious', クールダウン短め) |

`dispatch.sh`はexit 0固定、curlは2秒タイムアウトで非ブロッキング。

### 7.2 ローカルサーバーAPI一覧

| エンドポイント | 用途 | 認証 |
|---|---|---|
| POST /hook | hooksイベント受信 | 必須 |
| GET /panel | Control PanelのHTML配信 | 不要(トークンはHTML内に埋め込み) |
| GET /character | キャラ表示用HTML配信 | 同上 |
| GET /models/* | モデルアセット配信 | 必須 + パス検証 |
| WS /ws | Mood/Reaction配信、viewer制御 | 必須(クエリ付与) |

### 7.3 外部動画生成AIサービス連携 (FR-5)

| 工程 | 担当 |
|---|---|
| 元画像の準備 | ユーザー |
| クロマグリーン合成 | アプリ(自動) |
| 動画生成 | ユーザー(外部サービス) |
| 色キー抜き+WebP変換 | アプリ(自動) |

APIを直接叩かず、プロンプト提示→ユーザーが外部サービスで実行→結果を取り込む、の半自動フロー(特定ベンダー非依存)。

## 8. セキュリティ設計

- 認証: 起動時にランダムトークンを生成しuserData配下に0600で保存。hooksはファイルから読んでヘッダ付与、/panel,/characterはHTML内にJS変数として埋め込み(別オリジンなので取得不可)。
- CSP: `frame-ancestors 'self'`。
- Electron: 全レンダラーで`contextIsolation: true, nodeIntegration: false, sandbox: true`。
- パストラバーサル対策: zip展開・`/models/*`配信ともに、解決後パスがベースディレクトリ内に収まることを検証。
- ナビゲーション・新規ウィンドウ・権限要求の抑止: `/panel`・`/character`とも通常のHTTPオリジンから読み込むため、レンダラーは自オリジン外への`will-navigate`/`will-redirect`を拒否する(アプリ起点の再読込は妨げない)。新規ウィンドウはキャラクター表示ウィンドウで一律拒否(リンク導線を持たないため)、Control Panelはhttp/https限定で外部ブラウザ起動しElectronの子ウィンドウは常に拒否する。Web権限要求(カメラ/マイク/位置情報/通知等、いずれも本アプリは未使用)は全セッションで一律拒否する。詳細は[security.md](security.md)対策8。

## 9. スプライトセット生成パイプライン設計 (FR-5)

1. 静止画アップロード(透過PNG推奨)
2. アプリがクロマグリーン背景に合成した画像を生成(background_key.png)
3. ユーザーが外部AIで感情ごとの動画(mp4/webm)を生成・ダウンロード
4. 取り込み時: 色キー抜き(背景色に近い画素のうち、画像の縁に連結した領域のみを背景と判定する境界連結判定を採用し、内部のグリーン系の画素(緑の髪飾り・瞳のハイライト等)を保護) → 背景マスクを1px膨張(エッジの中間色除去) → アニメーションWebPへエンコード
5. `idle`のみ必須。他は欠落時`idle`にフォールバック

具体的な画像処理ライブラリの選定は詳細設計で行う(要件定義書の未確定事項参照)。

## 10. 非機能要件への対応方針

- **パフォーマンス**: キャラクター描画は無操作時にfpsを落とす(60→15fps目安)。
- **可用性**: ローカルサーバーは起動時にポート使用中を検知した場合、順次別ポートを試行(実際の値はconfig.jsonに保存)。
- **保守性**: 新規連携先はCharacterRenderer/Adapterの実装クラスを追加するだけで拡張可能。

## 11. 詳細設計へ引き継ぐ事項

- 会話ペインのUI構成(入力欄・履歴表示・streaming表示)、折りたたみタブの振る舞い、ウィンドウ幅の配分(FR-15)
- キャラクター表示ウィンドウのマルチモニタ挙動・初期配置ロジック・右クリックメニュー項目一覧(FR-6)
- モデルマッピング編集画面の実際の挙動(プレビュー再生等)
- オンボーディング各画面の詳細
- リップシンクとstreaming表示の同期方式
- Chat Adapterのエラーハンドリング
- キーワードベース感情分類の具体的な辞書/ロジック
- スプライトセットの色キー抜きに使用する具体的な画像処理ライブラリ選定

---
本書は要件定義書の内容をベースに作成している。要件側に変更が入った場合は、本書も合わせて更新すること。
