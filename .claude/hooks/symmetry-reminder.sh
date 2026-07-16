#!/bin/bash
# PostToolUse hook (matcher: Edit|Write|MultiEdit)
# Live2D/スプライトセットの二重実装が絡むファイルを触ったら、もう一方の分岐も
# 確認したかをリマインドする(ハードブロックはせず、additionalContextでの注意喚起に留める)。
# 本プロジェクトで実際に「片方だけ直し忘れる」バグが2度発生したための予防策。

set -euo pipefail

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if [ ! -f "$file_path" ]; then
  exit 0
fi

has_live2d=0
has_spriteset=0

grep -Eq "Live2DRenderer|renderType === 'live2d'|cubismVersion" "$file_path" 2>/dev/null && has_live2d=1
grep -Eq "SpriteSetRenderer|renderType === 'spriteset'|isSpriteset|EMOTION_STATES" "$file_path" 2>/dev/null && has_spriteset=1

if [ "$has_live2d" -eq 1 ] && [ "$has_spriteset" -eq 0 ]; then
  msg="対称性チェック: $file_path はLive2D関連の記述のみを含んでいます。スプライトセット側の対応する分岐も更新が必要か確認してください(CLAUDE.md参照)。"
elif [ "$has_spriteset" -eq 1 ] && [ "$has_live2d" -eq 0 ]; then
  msg="対称性チェック: $file_path はスプライトセット関連の記述のみを含んでいます。Live2D側の対応する分岐も更新が必要か確認してください(CLAUDE.md参照)。"
elif [ "$has_live2d" -eq 1 ] && [ "$has_spriteset" -eq 1 ]; then
  msg="対称性チェック: $file_path はLive2D/スプライトセット両方の記述を含みます。両分岐が対応する形で更新されているか、grep等で確認してください。"
else
  exit 0
fi

jq -n --arg ctx "$msg" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
exit 0
