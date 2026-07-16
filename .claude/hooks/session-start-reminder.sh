#!/bin/bash
# SessionStart hook: 詳細設計・実装の作業を始める前に、Notionの正本を確認する習慣を強制する。
# 終了コード0でstdoutをそのままコンテキストに注入する(SessionStartの仕様)。

cat <<'EOF'
[ヨリマシ.app 開発ハーネス]
作業を始める前に、以下を確認してください:
- 要件定義書・基本設計書はNotionが正本。docs/requirements.md・docs/basic-design.mdと差分がないか、
  Notion MCP(notion-fetch)で最新版を取得して確認すること。
- Live2D/スプライトセットのどちらかに触れる変更は、必ず両方の分岐を確認すること(CLAUDE.md「対称性チェック」参照)。
EOF

exit 0
