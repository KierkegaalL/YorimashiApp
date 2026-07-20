/**
 * 利用者のプロジェクトへ配置する `dispatch.sh` の**単一の情報源**(api.md 1.3)。
 *
 * ファイル(`resources/dispatch.sh`)ではなくTS内の文字列として持つ理由:
 *  - electron-vite / electron-builder のアセット同梱設定を増やさずに済み、
 *    「開発では動くが配布物に入っていない」という事故が起きない。
 *  - オンボーディング(FR-14/#10)は `buildDispatchScript()` の結果を書き出すだけでよく、
 *    テンプレートの実体が2箇所(リポジトリのファイルとTS)に分裂しない。
 *
 * **秘密をプロジェクト内に書かない**: トークンをこのスクリプトへ埋め込むと、利用者の
 * プロジェクト(=gitに入りうる場所)へ認証情報を書き込むことになる。security.md はトークンを
 * userData配下の `.token`(0600)に置くと定めているので、スクリプトは**実行時に読む**。
 * 埋め込むのは秘密ではないデータディレクトリのパスのみ。
 *
 * > **注意**: これは**アプリの利用者側**のプロジェクトに置くスクリプトであり、
 * > このリポジトリ自身の開発用hooksとは別物(CLAUDE.md / api.md 1.2の注記)。
 * > オンボーディング実装時にこのリポジトリの `.claude/` を書き換えないこと。
 */

/** `buildDispatchScript()` が置換するプレースホルダ。 */
const DATA_DIR_PLACEHOLDER = '__YORIMASHI_DATA_DIR__';

/**
 * dispatch.sh 本体。
 *
 * 満たすべき要件(api.md 1.3):
 *  - stdinのJSONをそのままPOSTする薄いスクリプト。重い処理をしない。
 *  - **必ず `exit 0`**。curlは `-m 2` でタイムアウトし、失敗してもClaude Code本体を止めない。
 *
 * 実装上の判断:
 *  - **jqを必須にしない**。api.md 1.3は `jq` でイベント名を付与する例を示すが、jqはmacOSに
 *    標準では入っていない。jqがあれば `hookEventName` を付与し、無ければ本文を素通しする。
 *    どちらでもサーバー側が解釈できる(Claude Code自身が `hook_event_name` を含めるため。
 *    shared/hook-events.ts の resolveHookEventName が両対応)。
 *  - ポートは `.port` から読む(競合フォールバック後の実ポートに追従する)。
 *  - トークンが読めない場合は**何もせず正常終了する**。認証なしで投げても401になるだけで、
 *    利用者の作業を遅らせるだけだから。
 */
const DISPATCH_SCRIPT_TEMPLATE = `#!/bin/bash
# ヨリマシ.app — Claude Code hooks ディスパッチャ (FR-2)
#
# 使い方: .claude/settings.json の hooks から、イベント名を第1引数に渡して呼び出す。
#   "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch.sh PreToolUse"
#
# このスクリプトは Claude Code の実行を絶対に妨げない:
#   - 常に exit 0 で終わる
#   - curl は -m 2 で打ち切る
#   - アプリが起動していなければ黙って終わる

set -u

EVENT_NAME="\${1:-}"

# アプリのデータディレクトリ(トークンとポートの置き場)。環境変数で上書きできる。
# 既定値はシングルクォートで埋める(パスに空白や $ を含んでも展開されないようにするため。
# buildDispatchScript() のエスケープもシングルクォート文脈を前提にしている)。
if [ -z "\${YORIMASHI_DATA_DIR:-}" ]; then
  YORIMASHI_DATA_DIR='${DATA_DIR_PLACEHOLDER}'
fi

TOKEN_FILE="$YORIMASHI_DATA_DIR/.token"
PORT_FILE="$YORIMASHI_DATA_DIR/.port"

# トークンが無い = アプリ未起動/未セットアップ。何もしない。
[ -r "$TOKEN_FILE" ] || exit 0
TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null) || exit 0
[ -n "$TOKEN" ] || exit 0

# 実際にバインドされたポート(競合時は8765以外になる)。読めなければ既定値。
PORT=8765
if [ -r "$PORT_FILE" ]; then
  FILE_PORT=$(cat "$PORT_FILE" 2>/dev/null)
  case "$FILE_PORT" in
    ''|*[!0-9]*) ;;   # 空・数値以外は無視して既定値のまま
    *) PORT="$FILE_PORT" ;;
  esac
fi

BODY=$(cat)
[ -n "$BODY" ] || BODY='{}'

# jq があればイベント名を付与する。無ければ素通し(サーバーは Claude Code 由来の
# hook_event_name も解釈するため、どちらでも動く)。
if [ -n "$EVENT_NAME" ] && command -v jq >/dev/null 2>&1; then
  ENRICHED=$(printf '%s' "$BODY" | jq -c --arg ev "$EVENT_NAME" '. + {hookEventName: $ev}' 2>/dev/null)
  [ -n "$ENRICHED" ] && BODY="$ENRICHED"
fi

curl -sS -o /dev/null -m 2 \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -H "X-App-Token: $TOKEN" \\
  --data-binary "$BODY" \\
  "http://127.0.0.1:$PORT/hook" >/dev/null 2>&1

exit 0
`;

/**
 * 配置用の dispatch.sh を生成する(オンボーディング FR-14/#10 が書き出す)。
 *
 * @param dataDir アプリの userData ディレクトリ(`app.getPath('userData')`)。
 *                トークンとポートの読み出し元。**秘密ではない**ためスクリプトに埋めてよい。
 */
export function buildDispatchScript(dataDir: string): string {
  // シングルクォート内に埋めるため、`'` を安全に閉じ直す形へエスケープする
  // (パスに `'` を含むディレクトリ名は実在しうる)。
  const escaped = dataDir.replace(/'/g, `'\\''`);
  return DISPATCH_SCRIPT_TEMPLATE.replace(DATA_DIR_PLACEHOLDER, escaped);
}
