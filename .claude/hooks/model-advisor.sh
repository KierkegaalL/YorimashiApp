#!/usr/bin/env bash
#
# UserPromptSubmit hook: 依頼文を判定し、CLAUDE.md 原則8（使用モデルの使い分け）に
# 沿った推奨モデルをセッションに助言として注入する。
#
# 注意: フックは実行中セッションのモデルを切り替えられない。本フックは
#       「推奨モデル」を提示し、必要なら /model での切替を促すだけの助言。
#       現在モデルが検知できない場合は警告を出さず、依頼内容ベースの推奨のみ表示する。
#
# 入力: stdin に UserPromptSubmit の JSON（.prompt に依頼文）。
# 出力: hookSpecificOutput.additionalContext に1行の助言。

# 意図的に set -e は付けない。失敗時も末尾 exit 0 で握りつぶし、助言なし（安全側）に倒す。
set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ -z "$INPUT" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

python3 - "$INPUT" <<'PY' 2>/dev/null
import json, sys, os
from collections import deque

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

# 英語混じり語のため小文字化して照合（日本語は影響を受けない）
p = (data.get("prompt") or "").lower()

# --- 現在のモデルを検知 -------------------------------------------------
# フック入力に model があればそれを、無ければ transcript の末尾 assistant 発話の
# message.model を採用する。取得できない場合は空文字（＝警告を出さない）。
def detect_model(data):
    m = data.get("model")
    if isinstance(m, str) and m:
        return m
    tpath = data.get("transcript_path") or ""
    if not tpath or not os.path.isfile(tpath):
        return ""
    try:
        # 末尾400行のみ保持（長大な transcript でも全文をリスト化しない）
        with open(tpath, encoding="utf-8") as f:
            lines = deque(f, maxlen=400)
        for line in reversed(lines):
            try:
                d = json.loads(line)
            except Exception:
                continue
            msg = d.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("model"), str) and msg["model"]:
                return msg["model"]
    except Exception:
        return ""
    return ""

model = detect_model(data).lower()
is_opus48 = "opus-4-8" in model  # claude-opus-4-8 系

# 新規作成を示すシグナル（強めの語に限定して過検出を避ける）
create = ["新規", "新しく", "新しい", "ゼロから", "作成", "つくって", "作って",
          "生成", "立ち上げ", "セットアップ", "初期化", "雛形", "scaffold",
          "create", "新設", "起こして"]
# 既存/作成済みファイルへの実行を示すシグナル
# （「確認」「チェック」「対応」「改善」「整合」「見直し」等の汎用語は過検出の
#   ため除外し、修整・調査を直接示す語に絞る）
modify = ["修正", "修整", "直し", "直して", "変更", "更新", "調査", "残タスク",
          "リファクタ", "レビュー", "バグ", "不具合", "追記", "既存",
          "作成済み", "fix", "review", "debug"]

# 「作成済み」は修整側のシグナル。create の「作成」と部分一致で衝突するため、
# create 判定用テキストからは「作成済み」を除去してから照合する。
p_for_create = p.replace("作成済み", "")
has_c = any(k in p_for_create for k in create)
has_m = any(k in p for k in modify)

OPUS = "Opus 4.8 (claude-opus-4-8)"
SONNET = "Sonnet 5 (claude-sonnet-5)"

# 「新規作成以外」= 修整・調査シグナルがあり、新規作成シグナルが無い状態。
is_non_creation = has_m and not has_c

if is_opus48 and is_non_creation:
    # 現在 Opus 4.8 かつ新規作成でない依頼 → 警告。指示の実行は着手せず停止する。
    msg = ("⚠️ [モデル方針 警告 / CLAUDE.md 原則8] 現在のモデルは Opus 4.8 ですが、"
           "この依頼は新規作成ではなく既存/作成済みファイルへの修整・調査と推定されます。"
           f"原則8では {SONNET} を使用すべきタスクです。**この指示の実行には着手せず**、"
           "返信の冒頭でユーザーにこの不一致を明示し、`/model` での Sonnet 5 への切替を求めて"
           "停止してください。ユーザーが切替後に指示を再送するか、Opus での続行を明示的に"
           "指示した場合のみ実行してください。")
else:
    if has_c and not has_m:
        rec = f"新規作成と推定 → {OPUS} を推奨"
    elif has_m and not has_c:
        rec = f"既存/作成済みファイルへの実行と推定 → {SONNET} を推奨"
    elif has_c and has_m:
        rec = f"新規作成と修整が混在の可能性。新規部分は {OPUS}、既存部分は {SONNET}"
    else:
        rec = f"判定不能。新規作成なら {OPUS}、既存ファイルへの修整・調査なら {SONNET}"
    msg = ("[モデル方針 / CLAUDE.md 原則8] " + rec +
           "。現在のモデルが異なる場合は /model で切替を検討（本フックは切替を強制しない）。")

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": msg
    }
}))
PY
exit 0
