# git-workflow.md — ブランチ戦略・コミットルール

## 現在のブランチ運用（設計フェーズ）

**現在は `main` への直接コミットで運用する。** ブランチは `main` のみ存在する。

理由: 現在は詳細設計ドキュメントの整備が中心で、1人開発かつレビュー相手がいない。設計ドキュメント1件ごとにコミットする粒度に対して、ブランチとPRを挟む利益がない。

## 実装着手時に `develop` へ移行する（決定済み）

**コードの実装に着手する時点で `develop` を切り、以降は下記のブランチ戦略へ移行する。** これは決定事項であり、移行のタイミングで改めて判断し直さない。

```bash
git switch main
git switch -c develop
git push -u origin develop
```

移行後、本ファイルの「現在のブランチ運用」の節を削除し、下記を有効なルールとする。

### 移行後のブランチ構成

| ブランチ | 役割 |
|---|---|
| `main` | リリース済み安定版。**直接マージ禁止。** |
| `develop` | 統合ブランチ。**全作業ブランチのマージ先。** |
| `feature/<name>` | 新機能。`develop` から分岐 → `develop` へマージ。 |
| `fix/<name>` | バグ修正。`develop` から分岐 → `develop` へマージ。 |
| `chore/<name>` | 雑務（設定・ドキュメント等）。`develop` から分岐 → `develop` へマージ。 |

### 移行後のマージルール

- **マージ作業を行う際は、必ず `develop` ブランチへマージすること。**
- 作業ブランチは **`develop` から分岐** する。
- Claude Code が git 操作（`git merge` や PR 作成）を行う際は、**マージ先ブランチが `develop` になっていることを毎回確認してから実行** すること。
- 誤って `main` 等へのマージ操作を指示された場合も、**`develop` へのマージに置き換えて実行** すること。

```bash
git switch develop && git pull
git switch -c feature/character-window

# ...実装 + 実装後チェックループ（build-commands.md）...

git push -u origin feature/character-window
gh pr create --base develop --head feature/character-window   # base は必ず develop
```

> マージ済みの作業ブランチは `git branch -d <branch>` で削除する。区切りのよいタイミングで `git branch --merged develop` を確認しまとめて削除するとよい。

## コミットメッセージ

- **命令形の要約**（英語）+ 本文（日本語可）。本文には**なぜそう決めたか**を書く。
- 実測に基づく判断は**測定結果を本文に残す**。後から「なぜこの値なのか」を再調査しなくて済むようにする。
- 対応するFR番号を要約に含める（例: `Decide character window placement and controls (FR-6)`）。
- **「Live2Dだけ直した」「スプライトセットだけ直した」というコミットメッセージは書かない**（constraints.md 対称性チェック）。両方確認した上でコミットし、非対称が正当な場合はその理由を本文に書く。
- 末尾に以下を付す:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## コミットの粒度

- **詳細設計1件 = 1コミット**（設計フェーズ）。
- **1機能 = 1コミット**（実装フェーズ）。実装とチェックループ完了までを1つにまとめる。
- Notion正本の更新を伴う変更は、**Notion → docs/ミラー → 実装**の順で行い、ミラー反映を独立したコミットにする（どの決定がどの正本更新に対応するかを追えるようにする）。

## コミット・プッシュのタイミング

- **ユーザーから指示があったときのみ**コミットする。勝手にコミットしない。
- プッシュも同様。
