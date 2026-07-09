#!/bin/zsh
# Render launchd plist with $HOME / project dir / port / REVIEW_ROOTS and
# install it under ~/Library/LaunchAgents/. Idempotent: bootstrap → unload
# existing first; kickstart at the end to guarantee the agent actually runs.
#
# Configure via env (REVIEW_ROOTS or REVIEW_ROOT is required):
#   PORT=15174                                   (default)
#   REVIEW_ROOTS=''                              (preferred; JSON array, see below)
#   REVIEW_ROOT=$HOME/notes                      (single directory; used only when REVIEW_ROOTS is empty)
#
# REVIEW_ROOTS is a JSON array of {name, path} objects, e.g.:
#   REVIEW_ROOTS='[{"name":"works","path":"'"$HOME"'/works"},{"name":"notes","path":"'"$HOME"'/notes"}]'
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
SRC_DIR="$PROJECT_DIR/launchd"
DEST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/markdown-reviewer"

PORT="${PORT:-15174}"
REVIEW_ROOTS="${REVIEW_ROOTS:-}"
REVIEW_ROOT="${REVIEW_ROOT:-}"

if [[ -z "$REVIEW_ROOTS" && -z "$REVIEW_ROOT" ]]; then
    echo "ERROR: REVIEW_ROOTS または REVIEW_ROOT を指定してください" >&2
    echo "  例: REVIEW_ROOT=\$HOME/notes $0" >&2
    exit 1
fi

# launchctl は /bin にしか無い場合があるので絶対パスを優先
LAUNCHCTL="$(command -v launchctl || true)"
[[ -z "$LAUNCHCTL" && -x /bin/launchctl ]] && LAUNCHCTL=/bin/launchctl
[[ -z "$LAUNCHCTL" ]] && { echo "ERROR: launchctl not found" >&2; exit 1; }

mkdir -p "$DEST_DIR" "$LOG_DIR"

# XML-escape REVIEW_ROOTS so the JSON inside the plist string is safe
# regardless of which characters the user used in name/path.
xml_escape() {
    print -r -- "$1" | sed -e 's|&|\&amp;|g' -e 's|<|\&lt;|g' -e 's|>|\&gt;|g'
}

render_plist() {
    local src="$1" dest="$2"
    local roots_escaped
    roots_escaped="$(xml_escape "$REVIEW_ROOTS")"
    sed -e "s|__HOME__|$HOME|g" \
        -e "s|__PROJECT__|$PROJECT_DIR|g" \
        -e "s|__PORT__|$PORT|g" \
        -e "s|__REVIEW_ROOTS__|$roots_escaped|g" \
        -e "s|__REVIEW_ROOT__|$REVIEW_ROOT|g" \
        "$src" > "$dest"
    chmod 600 "$dest"
}

reload_plist() {
    local label="$1" path="$2"
    if "$LAUNCHCTL" print "gui/$UID/$label" >/dev/null 2>&1; then
        "$LAUNCHCTL" bootout "gui/$UID/$label" 2>/dev/null || true
        # bootout は非同期。完全に unload されるまで待つ（KeepAlive=true 対策）
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            "$LAUNCHCTL" print "gui/$UID/$label" >/dev/null 2>&1 || break
            /bin/sleep 0.5
        done
    fi
    "$LAUNCHCTL" bootstrap "gui/$UID" "$path"
    # bootstrap は RunAtLoad=true でも実起動を skip する場合があるため
    # 明示的に kickstart して確実に起動させる。
    "$LAUNCHCTL" kickstart "gui/$UID/$label"
    if [[ -n "$REVIEW_ROOTS" ]]; then
        echo "loaded: $label (port=$PORT, REVIEW_ROOTS=$REVIEW_ROOTS)"
    else
        echo "loaded: $label (port=$PORT, REVIEW_ROOT=$REVIEW_ROOT)"
    fi
}

LABEL="com.user.markdown-reviewer"
SRC="$SRC_DIR/$LABEL.plist"
DEST="$DEST_DIR/$LABEL.plist"

render_plist "$SRC" "$DEST"
reload_plist "$LABEL" "$DEST"

echo "logs: $LOG_DIR/"
