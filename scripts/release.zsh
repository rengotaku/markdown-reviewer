#!/bin/zsh
# Cuts a release end to end: preflight -> tag -> watch GoReleaser -> verify the
# published artifacts -> upgrade the local install -> restart it -> wait until
# it actually answers.
#
# Invoked through `make release` / `make release-verify` (issue #187). The steps
# themselves are unchanged from the manual procedure; what this removes is the
# turn-by-turn waiting between them, plus the fixed `sleep` after kickstart that
# routinely raced the server's startup.
#
# Usage:
#   scripts/release.zsh release  vX.Y.Z    # preflight + tag + everything below
#   scripts/release.zsh verify   vX.Y.Z    # publish checks + brew + kickstart only
#
# `verify` runs against an already-published version, which is what makes this
# script testable without cutting a throwaway release.

set -e
set -u

MODE="${1:-}"
VERSION="${2:-}"

REPO="rengotaku/markdown-reviewer"
TAP_REPO="rengotaku/homebrew-tap"
CASK_PATH="Casks/markdown-reviewer.rb"
CASK_NAME="markdown-reviewer"
LAUNCHD_LABEL="com.user.markdown-reviewer"
# Matches internal/launchd's DefaultPort. Override for a non-default install.
HEALTH_PORT="${HEALTH_PORT:-15174}"
# GoReleaser publishes 4 archives plus checksums.txt.
EXPECTED_ASSETS=5
WORKFLOW="release.yml"

die() { print -u2 -- "release: $*"; exit 1; }
step() { print -- "\n==> $*"; }
note() { print -- "    $*"; }

[[ -n "$MODE" ]] || die "mode required (release|verify)"
[[ "$MODE" == "release" || "$MODE" == "verify" ]] || die "unknown mode '$MODE' (release|verify)"
[[ -n "$VERSION" ]] || die "VERSION required, e.g. VERSION=v1.2.3"
[[ "$VERSION" =~ '^v[0-9]+\.[0-9]+\.[0-9]+$' ]] \
  || die "VERSION must look like vX.Y.Z (got '$VERSION')"

# require <cmd>... — abort rather than silently skipping a check because a tool
# is missing. Optional (platform-specific) tools are probed separately below.
require() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' not found in PATH"
  done
}

# ---------------------------------------------------------------- preflight

preflight() {
  step "Preflight"
  require git gh

  git rev-parse --git-dir >/dev/null 2>&1 || die "not a git worktree"

  local branch
  branch=$(git rev-parse --abbrev-ref HEAD) || die "cannot read current branch"
  [[ "$branch" == "main" ]] \
    || die "release must be cut from main (on '$branch'). Use the main worktree."

  git fetch origin --tags --quiet || die "git fetch failed"

  # Not `[ -n "$(git status --porcelain 2>/dev/null)" ]`: that reads a failed
  # git as a clean tree. Capture first, abort on failure, then inspect.
  local dirty
  dirty=$(git status --porcelain) || die "git status failed"
  [[ -z "$dirty" ]] || die "working tree is not clean:\n$dirty"

  local local_sha remote_sha
  local_sha=$(git rev-parse main) || die "cannot resolve main"
  remote_sha=$(git rev-parse origin/main) || die "cannot resolve origin/main"
  [[ "$local_sha" == "$remote_sha" ]] \
    || die "main ($local_sha) differs from origin/main ($remote_sha); pull or push first"

  local rc=0
  git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null || rc=$?
  case $rc in
    0) die "tag $VERSION already exists locally. Pick a new version, or see the recovery steps in the release runbook." ;;
    1) : ;;
    *) die "cannot check tag $VERSION (git rev-parse rc=$rc)" ;;
  esac

  local ci
  ci=$(gh run list --branch main --workflow=ci.yml --limit 1 \
        --json conclusion --jq '.[0].conclusion') \
    || die "cannot read main's CI status"
  case "$ci" in
    success) note "main CI: success" ;;
    "")      die "no CI run found for main; refusing to release blind" ;;
    *)       die "main CI is '$ci' (needs success). Wait for it, or fix main first." ;;
  esac

  note "main is clean, in sync, and green — releasing $VERSION"
}

# ------------------------------------------------------------------ tagging

push_tag() {
  step "Tagging $VERSION"
  git tag "$VERSION" || die "git tag failed"
  # Roll the local tag back if the push fails, so a retry isn't blocked by a
  # tag that only exists on this machine.
  git push origin "$VERSION" || {
    git tag -d "$VERSION" >/dev/null 2>&1 || true
    die "git push of tag failed (local tag removed so you can retry)"
  }
  note "pushed $VERSION"
}

watch_workflow() {
  step "Waiting for the release workflow"

  # The run appears a beat after the tag push; poll for it rather than assuming
  # the newest run is ours.
  local run_id="" i
  for i in {1..20}; do
    run_id=$(gh run list --workflow="$WORKFLOW" --limit 10 \
              --json databaseId,headBranch \
              --jq "[.[] | select(.headBranch == \"$VERSION\")][0].databaseId") \
      || die "cannot list workflow runs"
    [[ -n "$run_id" && "$run_id" != "null" ]] && break
    sleep 3
  done
  [[ -n "$run_id" && "$run_id" != "null" ]] \
    || die "no $WORKFLOW run found for $VERSION after 60s"

  note "run $run_id — $(gh run view "$run_id" --json url --jq .url)"
  gh run watch "$run_id" --exit-status \
    || die "release workflow failed. Read it with: gh run view $run_id --log-failed"
  note "workflow succeeded"
}

# ------------------------------------------------------------ publish checks

verify_release() {
  step "Verifying the published release"
  require gh base64 grep

  local assets count
  assets=$(gh release view "$VERSION" --repo "$REPO" --json assets --jq '.assets[].name') \
    || die "release $VERSION not found"
  count=$(print -- "$assets" | grep -c . || true)
  [[ "$count" -eq "$EXPECTED_ASSETS" ]] \
    || die "expected $EXPECTED_ASSETS assets, found $count:\n$assets"
  note "assets: $count"

  local cask
  cask=$(gh api "repos/$TAP_REPO/contents/$CASK_PATH" --jq '.content' | base64 -d) \
    || die "cannot read the tap's cask"
  local want="version \"${VERSION#v}\""
  local rc=0
  print -r -- "$cask" | grep -qF -- "$want" || rc=$?
  case $rc in
    0) note "tap cask: ${VERSION#v}" ;;
    1) die "tap cask does not declare ${VERSION#v} yet (GoReleaser's cask push may have failed)" ;;
    *) die "cannot inspect the tap cask (grep rc=$rc)" ;;
  esac
}

# ------------------------------------------------------- local install (mac)

upgrade_local() {
  step "Upgrading the local install"
  if ! command -v brew >/dev/null 2>&1; then
    note "brew not found — skipping (nothing to upgrade on this machine)"
    return 0
  fi
  if ! brew list --cask "$CASK_NAME" >/dev/null 2>&1; then
    note "$CASK_NAME is not installed via brew — skipping"
    return 0
  fi

  # Refresh only the tap that carries this cask. A bare `brew update` walks
  # every tap and costs ~30-60s for no benefit here.
  local tap_dir
  tap_dir=$(brew --repository "$TAP_REPO" 2>/dev/null) || tap_dir=""
  if [[ -n "$tap_dir" && -d "$tap_dir/.git" ]]; then
    git -C "$tap_dir" pull --ff-only --quiet \
      || die "could not fast-forward the tap at $tap_dir"
  else
    note "tap checkout not found — falling back to brew update"
    brew update >/dev/null || die "brew update failed"
  fi

  brew upgrade --cask "$CASK_NAME" || die "brew upgrade failed"

  local installed
  installed=$(brew list --cask --versions "$CASK_NAME") || die "cannot read installed version"
  print -r -- "$installed" | grep -qF -- "${VERSION#v}" \
    || die "brew reports '$installed' after upgrade, expected ${VERSION#v}"
  note "installed: $installed"
}

restart_service() {
  step "Restarting the launchd service"
  if ! command -v launchctl >/dev/null 2>&1; then
    note "launchctl not found — skipping"
    return 0
  fi
  local target="gui/$(id -u)/$LAUNCHD_LABEL"
  if ! launchctl print "$target" >/dev/null 2>&1; then
    note "$LAUNCHD_LABEL is not loaded — skipping restart"
    return 0
  fi
  launchctl kickstart -k "$target" || die "launchctl kickstart failed"
  note "kickstarted $LAUNCHD_LABEL"
}

# Poll instead of sleeping: the server binds only after its file watcher has
# registered, so a fixed wait either races startup (the failure this replaces)
# or wastes time being conservative.
wait_until_healthy() {
  step "Waiting for the service to answer"
  if ! command -v launchctl >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    note "no launchctl/curl — skipping health check"
    return 0
  fi
  local url="http://localhost:$HEALTH_PORT/api/config" i
  for i in {1..60}; do
    if curl -sf -o /dev/null --max-time 2 "$url"; then
      note "healthy after ${i}s: $url"
      return 0
    fi
    sleep 1
  done
  die "service did not answer $url within 60s. Check the logs under ~/Library/Logs/markdown-reviewer/"
}

# --------------------------------------------------------------------- main

if [[ "$MODE" == "release" ]]; then
  preflight
  push_tag
  watch_workflow
fi

verify_release
upgrade_local
restart_service
wait_until_healthy

step "Done: $VERSION"
print -- "    https://github.com/$REPO/releases/tag/$VERSION"
