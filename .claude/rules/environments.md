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
| Control Panelウィンドウ | Chromium（Renderer） | 6タブUI、config編集 |
| Claude Code hooks | bash（`dispatch.sh`） | **アプリ利用者側**からローカルサーバーへPOST |
| Chrome拡張機能 | Chrome（別プロセス） | `/panel`・`/character`をiframe表示する薄い殻 |

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

**Rendererもこのサーバーから読み込む**（`loadURL('http://localhost:8765/character')`）。Electron専用のカスタムプロトコルは使わない（security.md 7章）。これは拡張機能から読めるようにするための決定だが、**副次的にWebCodecsの有効化条件でもある**（`file://`や`data:`はsecure contextでないためWebCodecsが使えない。detailed-design/spriteset-pipeline.md）。

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

- `dev-assets/` — 開発・検証専用のモデル置き場。**`.gitignore`対象**。配布物に絶対に含めない（constraints.md）。
- `docs/mockups/` — デザインモックアップ。gitで追跡する（実装の土台であり使い捨ての開発用資材ではない）。`src/`の外に置くことでビルド・`tsc`の対象外にしている。

> **現状**: `dev-assets/`は未作成、Live2Dモデル資材も未配置。このためLive2D側の実測が一切できず、detailed-design 側に「未検証」の項目が残っている（constraints.md「既知の非対称」）。

## Chat Adapterのモード

| モード | 挙動 | コスト |
|---|---|---|
| `mock`（**既定**） | 固定返答。擬似streamingで流す | **0**。課金しない |
| `real` | Anthropic API実接続（`@anthropic-ai/sdk`をMainで使用） | 課金あり |

**既定値を誤って`real`に変更しない**（要件定義書 C-08。課金トリガーはreal切替時のみ）。

## プレビューについて

`.claude/launch.json` は**用意していない**。`npm run dev`（electron-vite dev）はElectronのGUIウィンドウを開くため、Claude Codeのプレビュー機能（`preview_start`）では扱えない。

ローカルサーバー実装後は `http://localhost:8765/panel` / `/character` がブラウザで開けるようになるため、その時点で launch.json を追加する価値が出る。
