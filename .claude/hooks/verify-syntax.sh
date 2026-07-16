#!/bin/bash
# PostToolUse hook (matcher: Edit|Write|MultiEdit)
# .tsx/.jsx編集後にesbuildで構文チェックする。目視での括弧確認に頼らない(CLAUDE.md「構文・型チェック」)。
# 失敗時はdecision:blockでClaudeにフィードバックする(ツール自体は既に実行済みのため、取り消しはできない)。

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

case "$file_path" in
  *.tsx|*.jsx) ;;
  *) exit 0 ;;
esac

if [ ! -f "$file_path" ]; then
  exit 0
fi

if ! out=$(npx --yes esbuild "$file_path" --outfile=/dev/null 2>&1); then
  reason="esbuildで構文エラーを検出しました($file_path):
$out"
  jq -n --arg reason "$reason" '{decision: "block", reason: $reason}'
  exit 0
fi

exit 0
