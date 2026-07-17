#!/usr/bin/env bash
#
# PostToolUse hook (matcher: Edit|Write|MultiEdit)
#
# CLAUDE.md 原則4「対称性チェック」の実装。
# Live2D/スプライトセットのどちらか一方の分岐にだけ触れる変更を検知して注意喚起する。
# 本プロジェクトで実際に「片方だけ直し忘れる」事故が2度発生したための予防策。
#
# 設計上の要点:
#   - **ファイルの中身ではなく「変更行」を見る**。原則4は「変更をしたら両方確認する」
#     というルールなので、判定対象は差分でなければならない。ファイル全体を見る実装は、
#     形式非依存の編集でも両形式に言及するファイルなら必ず発火してしまう。
#   - 判定は HEAD からの未コミット差分に対して行う。片側を直した時点から、もう片側を
#     直すまでの間は鳴り続ける(=コミット前に両方揃えるべき、という原則どおりの挙動)。
#   - 両側に触れている変更では鳴らさない(原則が満たされているため)。
#
# ハードブロックはせず additionalContext での注意喚起に留める。
# フックは補助であり判断はしない(constraints.md)。誤検知もあるため最終判断は人/Claudeが行う。

set -uo pipefail

INPUT="$(cat 2>/dev/null || true)"
[ -z "$INPUT" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

python3 - "$INPUT" <<'PY' 2>/dev/null
import json, os, re, subprocess, sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

path = (data.get("tool_input") or {}).get("file_path") or ""
if not path or not os.path.isfile(path):
    sys.exit(0)

# 本フック自身はマーカー語を全部含むため、編集すると必ず自己検知する。除外する。
if os.path.basename(path) == "symmetry-reminder.sh":
    sys.exit(0)

repo = os.path.dirname(os.path.abspath(path))
def git(*args):
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=5)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None

if git("rev-parse", "--is-inside-work-tree") is None:
    sys.exit(0)

# --- 変更行を取り出す -----------------------------------------------------
# 追跡済み: HEAD からの未コミット差分(staged + unstaged)
# 未追跡  : ファイル全体を「追加された行」として扱う
diff = git("diff", "HEAD", "--unified=0", "--", os.path.abspath(path))
if diff:
    changed = [l[1:] for l in diff.splitlines()
               if (l.startswith("+") or l.startswith("-"))
               and not l.startswith("+++") and not l.startswith("---")]
elif diff == "":
    tracked = git("ls-files", "--error-unmatch", os.path.abspath(path))
    if tracked:
        sys.exit(0)              # 追跡済みで差分なし = 実質変更なし
    try:
        changed = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except Exception:
        sys.exit(0)
else:
    sys.exit(0)

if not changed:
    sys.exit(0)
body = "\n".join(changed)

# --- 形式固有のマーカー ---------------------------------------------------
# 実装識別子だけでなく散文も拾う。ドキュメントは「Live2D」という語で書かれるため、
# Live2DRenderer 等の識別子だけを見ていると設計文書を丸ごと取りこぼす。
#
# EMOTION_STATES は**意図的に含めない**。全10状態は両形式が共有する単一の情報源であり、
# 形式固有のマーカーではない(これを spriteset 専用扱いにしていたのが従来の最大の誤り)。
LIVE2D = {
    "Live2D": r"Live2D",
    "live2d": r"\blive2d\b",
    "Cubism": r"[Cc]ubism",
    "moc3/model3/exp3": r"\.(moc3|model3\.json|exp3\.json|motion3\.json)",
    "emotionMap": r"emotionMap",
    "ParamMouth": r"ParamMouth",
}
SPRITESET = {
    "スプライトセット": r"スプライトセット",
    "spriteset": r"\bspriteset\b|SpriteSet",
    "baseResolution": r"baseResolution",
    "clips": r"\bclips\b",
    "WebP": r"[Ww]ebP|\.webp",
    "色キー/クロマ": r"色キー|クロマ|chroma",
}

def hits(table):
    return sorted({name for name, pat in table.items() if re.search(pat, body)})

l_hits, s_hits = hits(LIVE2D), hits(SPRITESET)

# 両方に触れている、またはどちらにも触れていない → 原則4の対象外。鳴らさない。
if bool(l_hits) == bool(s_hits):
    sys.exit(0)

rel = os.path.relpath(os.path.abspath(path), repo)
if l_hits:
    touched, missing = "Live2D", "スプライトセット"
    detected, examples = ", ".join(l_hits), "SpriteSetRenderer / baseResolution / clips 等"
else:
    touched, missing = "スプライトセット", "Live2D"
    detected, examples = ", ".join(s_hits), "Live2DRenderer / cubismVersion / emotionMap 等"

msg = (
    f"対称性チェック(CLAUDE.md 原則4): {rel} の**変更行**が {touched} 側にのみ触れています"
    f"(検出: {detected})。{missing} 側({examples})に対応する変更が要るか、"
    f"grep で機械的に確認してください。"
    f"**非対称が正当な場合もあります**(例: スプライトセットの生成パイプラインはLive2Dに対応物を持たない)。"
    f"その場合は「なぜ非対称でよいか」をコメント/ドキュメントに明記してください"
    f"(黙って片方だけ書くと実装漏れと誤読されます)。"
)
print(json.dumps({
    "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}
}))
PY
exit 0
