#!/usr/bin/env bash
#
# PostToolUse hook: ファイル編集後に lint / 型 / 関連テストを自動実行する。
# 各 npm script が未整備の間はグレースフルに no-op する（空リポでも失敗しない）。
#
# 本プロジェクトは Electron + TypeScript。Main/Preload と Renderer で tsconfig が
# 別なので、`npm run typecheck` が両方（typecheck:node / typecheck:web）を順に
# 実行する。片方だけ通っても安心しないこと（.claude/rules/build-commands.md）。
#
# 入力: stdin に PostToolUse の JSON。tool_input.file_path を対象とする。
# 出力: 問題があれば非0で終了し、メッセージを stderr に出す。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 0

# --- 対象ファイルパスを stdin JSON から取得 -------------------------------
INPUT="$(cat 2>/dev/null || true)"
FILE_PATH=""
if command -v python3 >/dev/null 2>&1 && [ -n "$INPUT" ]; then
  FILE_PATH="$(printf '%s' "$INPUT" | python3 -c 'import sys,json;
try:
    d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))
except Exception:
    print("")' 2>/dev/null)"
fi

# package.json が無ければプロジェクト未整備 → no-op
if [ ! -f "$REPO_ROOT/package.json" ]; then
  exit 0
fi

# JS/TS ファイル以外は対象外
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.mts|*.cts) ;;
  "") ;;  # ファイル不明時は全体チェックにフォールバック
  *) exit 0 ;;
esac

STATUS=0
run() {
  # npm script が存在する場合のみ実行
  local script="$1"; shift
  if node -e "process.exit(require('./package.json').scripts?.['$script']?0:1)" 2>/dev/null; then
    echo "▶ npm run $script"
    if ! npm run --silent "$script" "$@"; then
      STATUS=1
    fi
  fi
}

# ESLint / Prettier / 型チェック（存在する script のみ走る）
run lint
run typecheck

# 関連ユニットテスト（対象ファイルが分かる場合）
# Vite プロジェクトのため vitest を優先し、jest も一応見る
if [ -n "$FILE_PATH" ] && node -e "process.exit(require('./package.json').scripts?.test?0:1)" 2>/dev/null; then
  if npx --no-install vitest --version >/dev/null 2>&1; then
    echo "▶ vitest related $FILE_PATH"
    npx --no-install vitest related "$FILE_PATH" --run --passWithNoTests || STATUS=1
  elif npx --no-install jest --version >/dev/null 2>&1; then
    echo "▶ jest --findRelatedTests $FILE_PATH"
    npx --no-install jest --findRelatedTests "$FILE_PATH" --passWithNoTests || STATUS=1
  fi
fi

if [ "$STATUS" -ne 0 ]; then
  echo "❌ lint/型/テストに失敗しました。修正してから次に進んでください。" >&2
fi
exit "$STATUS"
