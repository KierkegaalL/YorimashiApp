# environments.md — 実行環境・ポート・データ配置

## 対象プラットフォーム

- **対応OS**: macOSのみ（v1）。Windows/Linuxは要件定義書10章でスコープ外。
- **配布**: 手動更新のみ。自動アップデート機構は配布フェーズで検討。
- **署名・notarize**: `config.distribution.macSigningIdentity` / `macNotarize` で管理（未設定が既定）。

## プロセス構成

| プロセス | 実行環境 | 役割 |
|---|---|---|
| Electron Main | Node.js | ウィンドウ生成、ローカルサーバー、config.json管理、Chat AdapterのAPI呼び出し |
| キャラクター表示ウィンドウ | Chromium（Renderer） | `CharacterRenderer`によるLive2D/スプライトセット描画 |
| Control Panelウィンドウ | Chromium（Renderer） | **左に会話ペイン（FR-15）、右に6タブUI（FR-7）** の1ウィンドウ。config編集 |
| Claude Code hooks | bash（`dispatch.sh`） | **アプリ利用者側**からローカルサーバーへPOST |

**APIキーを扱うのはMainのみ。** Rendererは`contextIsolation: true` / `sandbox: true` / `nodeIntegration: false` で、キーを渡さない（detailed-design/chat-adapter-errors.md）。

## ローカルサーバー

| 項目 | 値 |
|---|---|
| バインド | **127.0.0.1限定**（0.0.0.0にしない） |
| ポート | 8765（既定。`config.codeAdapter.serverPort`） |
| ポート競合時 | 順次別ポートを試行し、実際の値をconfig.jsonへ保存 |
| 認証 | 全リクエストにトークン必須（`/panel`・`/character`のHTML配信を除く） |

### エンドポイント

| メソッド/パス | 認証 |
|---|---|
| `POST /hook` | 必須（`X-App-Token`） |
| `GET /panel` | 不要（トークンはHTML内に埋め込み） |
| `GET /character` | 同上 |
| `GET /models/*` | 必須 + パス検証 |
| `WS /ws?token=...` | 必須（クエリ） |

**Rendererもこのサーバーから読み込む**（`loadURL('http://localhost:8765/character')`）。Electron専用のカスタムプロトコルは使わない（security.md 7章）。**カスタムプロトコルはsecure contextとして扱われずWebCodecsが使えなくなるため**（`file://`や`data:`も同様。detailed-design/spriteset-pipeline.md）。

> **現状**: ローカルサーバーは未実装。スキャフォールドは暫定的にVite dev server / `loadFile` 経由で読み込んでおり、サーバー実装時に移行が必要（`src/main/index.ts`にコメントで明記）。

## データ配置（userData配下）

```
<userData>/
 ├─ config.json               # Zodバリデーション、schemaVersionでマイグレーション
 ├─ .token                    # ローカルサーバー認証トークン、パーミッション0600
 ├─ models/
 │   └─ <uuid>/
 │       ├─ manifest.json     # clipsの正本
 │       ├─ model3.json / *.moc3   # live2dのみ
 │       └─ idle.webp 等       # spritesetのみ
 └─ logs/
     └─ hook-events.jsonl     # パーミッション0600、retentionDaysで自動削除（既定7日）
```

## 開発用アセット

- `dev-assets/` — 開発・検証専用のモデル置き場。**`.gitignore`対象**。配布物に絶対に含めない（constraints.md）。`dev-assets/live2d/` にモデル一式を配置する（`dev-assets/README.md` に期待するディレクトリ構成を記載）。
- `docs/mockups/` — デザインモックアップ。gitで追跡する（実装の土台であり使い捨ての開発用資材ではない）。`src/`の外に置くことでビルド・`tsc`の対象外にしている。

> **現状**: `dev-assets/live2d/`は準備済みだがモデル資材は未配置。配置され次第、Live2D側の実測（Cubism 2/4の列挙構造、持続中にモーションが尽きたときの挙動）を行う（constraints.md「既知の非対称」）。

## PixiJSのバージョン方針（確定・重要）

**PixiJS v6系で統一する。v8（npm最新）は使わない。**

`pixi-live2d-display`（Live2D描画に使う唯一のライブラリ）の安定版(0.4.0)は`peerDependencies`で`pixi.js: ^6`を要求する。実測で確認した重大な非対称:

- `pixi-live2d-display`の`Live2DModel`は`@pixi/display`(v6)の`Container`を継承しており、`pixi.js`(v8)の`Container`とは**別クラス**（`instanceof`で不一致）
- `npm install pixi.js@^8 pixi-live2d-display`は依存解決自体は通るが、**v6系サブパッケージ(`@pixi/core`等)とv8本体が別々に共存インストールされる**だけで統合されない
- beta版(0.5.0-beta)は`pixi.js: ^7`だが**2023-12-07以降更新なし**。事実上メンテナンス終了
- Cubism 2/4はそれぞれ`live2d.min.js`/`live2dcubismcore.js`という**外部ランタイム**（Live2D公式サイトから別途取得、npmには無い）を`window`にロードしないと、importした瞬間に例外を投げる

**この方針が拘束するのはLive2D側の実装のみ。** basic-design.md 5.1は`SpriteSetRenderer`を「WebPクロスフェード再生」としか記述しておらず、PixiJSの使用を前提としていない（アニメーションWebPは`<img>`やCanvas 2Dでも再生できる）。`CharacterRenderer`の抽象化自体には影響しないが、**Live2DRendererの実装は終始v6のAPIで書く**（v8のドキュメント・型を参照しない）。SpriteSetRendererの描画手段は別途、実装時にPixiJS(v6)を使うか`<img>`/Canvas 2Dで完結させるかを決める。

> **要注意**: `pixi-live2d-display`のpackage.jsonは`gh-pages`(prototype pollutionの既知critical脆弱性)を`dependencies`に誤って含む。distバンドルには痕跡がなくランタイムには使われないが、`node_modules`には物理的に入る。配布時にelectron-builderのファイル選定で確実に除外されるか確認が必要（実装時のTODO）。

## Chat Adapterのモード

| モード | 挙動 | コスト |
|---|---|---|
| `mock`（**既定**） | 固定返答。擬似streamingで流す | **0**。課金しない |
| `real` | Anthropic API実接続（`@anthropic-ai/sdk`をMainで使用） | 課金あり |

**既定値を誤って`real`に変更しない**（要件定義書 C-08。課金トリガーはreal切替時のみ）。

## プレビューについて

`.claude/launch.json` は**用意していない**。`npm run dev`（electron-vite dev）はElectronのGUIウィンドウを開くため、Claude Codeのプレビュー機能（`preview_start`）では扱えない。

ローカルサーバー実装後は `http://localhost:8765/panel` / `/character` がブラウザで開けるようになるため、その時点で launch.json を追加する価値が出る。
