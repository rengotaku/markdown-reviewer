#!/bin/zsh
# Render launchd plist with $HOME / project dir / port / REVIEW_ROOT and
# install it under ~/Library/LaunchAgents/. Idempotent: bootstrap → unload
# existing first; kickstart at the end to guarantee the agent actually runs.
#
# Override defaults via env:
#   PORT=15174                                   (default)
#   REVIEW_ROOT=$HOME/ot/works                   (default)
set -euo pipefail

PROJECT_DIR="${0:A:h:h}"
SRC_DIR="$PROJECT_DIR/launchd"
DEST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/markdown-reviewer"

PORT="${PORT:-15174}"
REVIEW_ROOT="${REVIEW_ROOT:-$HOME/ot/works}"

# launchctl は /bin にしか無い場合があるので絶対パスを優先
LAUNCHCTL="$(command -v launchctl || true)"
[[ -z "$LAUNCHCTL" && -x /bin/launchctl ]] && LAUNCHCTL=/bin/launchctl
[[ -z "$LAUNCHCTL" ]] && { echo "ERROR: launchctl not found" >&2; exit 1; }

mkdir -p "$DEST_DIR" "$LOG_DIR"

render_plist() {
    local src="$1" dest="$2"
    sed -e "s|__HOME__|$HOME|g" \
        -e "s|__PROJECT__|$PROJECT_DIR|g" \
        -e "s|__PORT__|$PORT|g" \
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
    echo "loaded: $label (port=$PORT, REVIEW_ROOT=$REVIEW_ROOT)"
}

LABEL="com.user.markdown-reviewer"
SRC="$SRC_DIR/$LABEL.plist"
DEST="$DEST_DIR/$LABEL.plist"

render_plist "$SRC" "$DEST"
reload_plist "$LABEL" "$DEST"

echo "logs: $LOG_DIR/"
