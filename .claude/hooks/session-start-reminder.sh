#!/bin/bash
# SessionStart hook: セッション冒頭で、踏みやすい前提を注入する。
# 終了コード0でstdoutをそのままコンテキストに注入する(SessionStartの仕様)。

cat <<'EOF'
[ヨリマシ.app 開発ハーネス]
- ルールの入口は CLAUDE.md。詳細は .claude/rules/ に分離してある(features / build-commands /
  environments / git-workflow / constraints)。作業前に該当ファイルを参照すること。
- 状況の引き継ぎは Memory.md。前回までの完了作業・未決事項・次の一手はここにある。
- 要件・基本設計は Notion が正本。docs/requirements.md・docs/basic-design.md はミラー。
  差分がないか Notion MCP(notion-fetch) で確認すること(正本側が古いこともある)。
- Live2D/スプライトセットのどちらかに触れる変更は、必ず両方の分岐を確認すること
  (CLAUDE.md 原則4「対称性チェック」/ .claude/rules/constraints.md)。
- Electron の GUI はサンドボックスから起動できない。「動作確認済み」と自己申告しないこと。
  ただし GUI を伴わない検証(オフスクリーン実行・モックサーバー・ライブラリ実測)は可能で、
  推測で設計を書かないこと(.claude/rules/build-commands.md)。
EOF

exit 0
