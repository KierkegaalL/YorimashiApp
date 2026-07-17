# CLAUDE.md — ヨリマシ.app

> このファイルは Claude Code 向けルールの **入口** です。詳細ルールは `.claude/rules/` に分離しています。実装・調査・git 操作の前に、必ず該当する rules ファイルを参照してください。

## プロジェクト概要

**ヨリマシ.app** は、Claude Codeでの作業実況とClaudeとのチャット対話を、憑坐(よりまし)キャラクター「**常世灯里**(とこよ あかり)」が感情豊かに反応しながら伴走するデスクトップ常駐アプリ。開発者自身のClaude Code活用基盤(ハーネスエンジニアリング)の一環。

- **技術スタック**: Electron + TypeScript + React + Vite / PixiJS + pixi-live2d-display(Live2D描画、Cubism 2/4/5両対応) / Zod(設定バリデーション) / Node.js http+ws(ローカルサーバー) / Chrome Manifest V3(拡張機能)
- **デザイン方向性**: 電脳オカルト×HUD(和風オカルト+ターミナルUI)
- **対応OS**: macOSのみ(v1)
- **中心構造**:
  - **EmotionEngine**(FR-4): Mood 3種(idle/confident/tired) + Reaction 7種(thinking/happy/proud/worried/panic/curious/sleepy) = **全10状態**。単一の情報源は `src/shared/emotions.ts`
  - **Adapter**(FR-1〜3): Code Adapter(Claude Code hooks) / Chat Adapter(mock・real)。どちらも同一のEmotionEngineを共有
  - **CharacterRenderer**(FR-5): Live2D形式とスプライトセット形式を抽象化。EmotionEngineは形式を意識しない
- **Ruby / Ruby on Railsは検討の上、不採用**(FR-6の透過・常時最前面要件をNext.js/Rails単体では満たせないため。Electronは変更しない前提で確定)

## ディレクトリ構成

```
YorimashiApp/
├── CLAUDE.md                  # 本ファイル(ルールの入口)
├── Memory.md                  # セッション間の状況記録(完了/未決事項13件/技術情報)
├── docs/
│   ├── requirements.md        # 要件定義書(Notionのミラー)
│   ├── basic-design.md        # 基本設計書(Notionのミラー)
│   ├── data.md                # config.json / manifest.json / ディレクトリ構成
│   ├── api.md                 # ローカルサーバーAPI / hooks連携
│   ├── security.md            # トークン認証・CSP・パストラバーサル対策
│   ├── detailed-design/       # 詳細設計7件(すべて確定済み)
│   └── mockups/
│       └── control-panel.jsx  # UIモックアップ(UIの正)
├── .claude/
│   ├── settings.json          # hooks配線
│   ├── rules/                 # 詳細ルール(下記参照)
│   ├── agents/reviewer.md     # チェック専用サブエージェント(Sonnet 5固定)
│   ├── commands/check-loop.md # /check-loop
│   └── hooks/                 # hook実行スクリプト
├── src/
│   ├── main/                  # Electron Main
│   ├── preload/               # contextBridge
│   ├── shared/                # emotions.ts(全10状態の単一の情報源) / config-schema.ts
│   └── renderer/              # character / control-panel
└── dev-assets/                # 開発用モデル(.gitignore対象・配布物に含めない)
```

## 実装時に必ず守るべき原則

1. **実装後チェックループは必須**
   実装の指示を受けて作業した後は、必ずチェック専用のサブエージェント(`reviewer`)を起動し、指摘が0件になるまで「修正→再チェック」を繰り返すこと。手順は [.claude/rules/build-commands.md](.claude/rules/build-commands.md) に明文化。`/check-loop` コマンドで呼び出せる。

2. **要件・基本設計は Notion を正とする**
   要件の追加・変更は必ず Notion を先に更新し、その後 `docs/requirements.md`・`docs/basic-design.md` へ反映すること。Notion ページへのリンクは [.claude/rules/features.md](.claude/rules/features.md)。**正本自体が古くなることがある**ため、差分を見つけたらどちらが正しいか判断してから直す(過去に `windowPosition` の記載漏れが実際に発生した)。

3. **詳細設計は `docs/detailed-design/` を正とする**
   7件すべて確定済み。**実測に基づく決定**を含むため、実装で覆さないこと(主な実測事項は [Memory.md](Memory.md))。UIの正は `docs/mockups/control-panel.jsx`、感情↔クリップ対応(`clips`)の正は各モデルの `manifest.json`(config.jsonには複製しない)。

4. **対称性チェック(このプロジェクト最重要ルール)**
   Live2D/スプライトセットのどちらかに関わる変更をしたら、**必ずもう一方の分岐も同時に確認・修正する**。実際に「片方だけ直す」事故が2度発生している。`grep`で機械的に確認してから完了とすること。非対称が正当な場合は**その理由を明記する**(黙って片方だけ書くと実装漏れと誤読される)。詳細・既知の非対称は [.claude/rules/constraints.md](.claude/rules/constraints.md)。

5. **「動作確認済み」と自己申告しない**
   ElectronのGUIはサンドボックスから起動できないため、実際の画面確認・操作確認はユーザーが行う。ただし**GUIを伴わない検証(オフスクリーン実行・モックサーバー・ライブラリ実測)は可能**であり、**推測で設計やコードを書かない**こと。詳細は [.claude/rules/build-commands.md](.claude/rules/build-commands.md)「サンドボックスで可能な検証」。

6. **やりとりは日本語で行う**
   本プロジェクトでの回答・質問・報告は日本語で行うこと。

7. **スコープはヨリマシ.appに限定**
   本リポジトリでの会話・作業は「ヨリマシ.app」に関するものに限定する。

8. **使用モデルの使い分け**
   タスクの性質に応じて使用モデルを切り替えること。
   - **新規作成**(新しいファイル・機能・ドキュメントをゼロから作成する): **Opus 4.8**(`claude-opus-4-8`)を使用する。
   - **既存・作成済みファイルへの実行**(修整対応、バグ修正、残タスク調査、リファクタ、レビュー等): **Sonnet 5**(`claude-sonnet-5`)を使用する。
   - **自動化(補助)**: `UserPromptSubmit` フック(`.claude/hooks/model-advisor.sh`)が依頼文を判定して推奨モデルを**助言**する(フックはモデルを切り替えられない。必要に応じ `/model` で切替)。
     - **警告時は実行を停止**: 現在のモデルが **Opus 4.8 のまま新規作成以外(既存/作成済みファイルへの修整・調査)の指示**を受けた場合、フックが警告を注入する。警告を受けたら、**その指示の実行に着手せず**、返信の冒頭でユーザーに不一致を明示し `/model` での Sonnet 5 切替を求めて停止すること。ユーザーが切替後に指示を再送するか、Opus 続行を明示的に指示した場合のみ実行してよい。
     - レビュー・整合チェック・残タスク調査は `reviewer` サブエージェント(Sonnet 5 固定)を起動して行う。詳細は [build-commands.md](.claude/rules/build-commands.md)。

9. **マージ先(実装着手時に `develop` へ移行)**
   現在は設計フェーズのため `main` へ直接コミットする。**コードの実装に着手する時点で `develop` を切り、以降のマージ先は常に `develop`** とする(決定済み)。詳細は [.claude/rules/git-workflow.md](.claude/rules/git-workflow.md)。コミット・プッシュは**ユーザーの指示があったときのみ**行う。

10. **セッション消費量の節約(チェックポイント方式)**
    詳細設計1件・1機能の完了直後など、区切りのよいタイミングで、残タスクを `TaskCreate`/`TaskUpdate` に構造化して保持し、[Memory.md](Memory.md) を更新したうえで `/compact` の実行をユーザーに提案すること。数値ベースの消費量(%)は実行中に正確に取得できないため判断基準にしない。詳細は [build-commands.md](.claude/rules/build-commands.md)。

## `.claude/rules/` 参照一覧

| ファイル | 内容 |
|---|---|
| [features.md](.claude/rules/features.md) | 機能一覧(FR-1〜FR-14)、全10状態の定義、**Notion正本リンク**、現在のフェーズ |
| [build-commands.md](.claude/rules/build-commands.md) | ビルド・型チェックコマンド、**サンドボックスで可能な検証**、実装後チェックループ、モデル方針、チェックポイント方式 |
| [environments.md](.claude/rules/environments.md) | プロセス構成、ローカルサーバー(127.0.0.1:8765)、userData配下のデータ配置、mock/real |
| [git-workflow.md](.claude/rules/git-workflow.md) | ブランチ戦略(**実装着手時にdevelop化**)、コミットルール・粒度 |
| [constraints.md](.claude/rules/constraints.md) | **対称性チェック**、検証ルール、正本の一覧、プロジェクト固有の制約、非機能要件、**開発hooksとアプリのhooks受信の区別** |

## 現在のフェーズ

**設計フェーズ完了。実装は未着手**(スキャフォールドのみ)。詳細設計7件はすべて確定済みで、Notion正本の一括更新(A1+B)も完了。**未決事項が13件**残っており、うち実装着手をブロックするのは開発用Live2Dモデルの実配置(A2)のみ。

一覧・優先度・次の一手は [Memory.md](Memory.md) を参照。
