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
#   scripts/release.zsh release   vX.Y.Z   # preflight + tag + everything below
#   scripts/release.zsh preflight vX.Y.Z   # the safety checks only — publishes nothing
#   scripts/release.zsh verify    vX.Y.Z   # publish checks + brew + kickstart only
#
# `release` publishes for real the moment its checks pass — there is no prompt,
# because the point is to stop babysitting it. Use `preflight` to see whether a
# release *would* go out. (Written after running `release` with a throwaway
# version to "just watch the checks", which published v99.0.0 to the tap for
# real and had to be reverted.)
#
# `preflight` and `verify` both run against real state without publishing, which
# is what makes this script testable without cutting a throwaway release.

set -e
set -u

MODE="${1:-}"
VERSION="${2:-}"

REPO="rengotaku/markdown-reviewer"
TAP_REPO="rengotaku/homebrew-tap"
CASK_PATH="Casks/markdown-reviewer.rb"
CASK_NAME="${CASK_NAME:-markdown-reviewer}"
# Matches internal/launchd's DefaultLabel. Override for a non-default install.
LAUNCHD_LABEL="${LAUNCHD_LABEL:-com.user.markdown-reviewer}"
# Matches internal/launchd's DefaultPort. Override for a non-default install.
HEALTH_PORT="${HEALTH_PORT:-15174}"
WORKFLOW="release.yml"
# Newest run id seen before the tag push; set by push_tag, read by
# watch_workflow to reject a stale run left over from a re-pushed tag.
LAST_RUN_ID=0
# Set by restart_service when it actually restarted something, so the health
# check knows whether anything is expected to come up.
SERVICE_RESTARTED=0

die() { print -u2 -- "release: $*"; exit 1; }
step() { print -- "\n==> $*"; }
note() { print -- "    $*"; }

[[ -n "$MODE" ]] || die "mode required (release|preflight|verify)"
case "$MODE" in
  release|preflight|verify) : ;;
  *) die "unknown mode '$MODE' (release|preflight|verify)" ;;
esac
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

  # Match the run to this exact commit. Taking "the newest run on main" would
  # accept the *previous* commit's green run whenever the push that produced
  # HEAD hasn't registered its run yet — i.e. it would wave through the one
  # case the check exists to catch.
  local ci
  ci=$(gh run list --branch main --workflow=ci.yml --limit 20 \
        --json headSha,status,conclusion \
        --jq "[.[] | select(.headSha == \"$remote_sha\")][0] | if . == null then \"\" else .status + \"/\" + (.conclusion // \"\") end") \
    || die "cannot read main's CI status"
  case "$ci" in
    completed/success) note "main CI: success for $remote_sha" ;;
    "")                die "no CI run found for main@$remote_sha; refusing to release blind. Wait for CI to start." ;;
    completed/*)       die "main CI for $remote_sha is '${ci#completed/}' (needs success). Fix main first." ;;
    *)                 die "main CI for $remote_sha is still ${ci%%/*}. Wait for it to finish." ;;
  esac

  note "main is clean, in sync, and green — releasing $VERSION"
}

# ------------------------------------------------------------------ tagging

push_tag() {
  step "Tagging $VERSION"
  # Remember the newest existing run so watch_workflow can require a *newer*
  # one. Without this, re-pushing a deleted tag after a failed release (the
  # documented recovery) would immediately latch onto that tag's old failed
  # run and abort before the new one is even queued.
  LAST_RUN_ID=$(gh run list --workflow="$WORKFLOW" --limit 1 \
                 --json databaseId --jq '.[0].databaseId // 0') \
    || die "cannot list workflow runs"
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

  # The run appears a beat after the tag push, so poll for it — and require an
  # id newer than the one recorded before pushing, so a stale run for a
  # re-pushed tag can't be mistaken for ours.
  local run_id="" i
  for i in {1..20}; do
    run_id=$(gh run list --workflow="$WORKFLOW" --limit 20 \
              --json databaseId,headBranch \
              --jq "[.[] | select(.headBranch == \"$VERSION\") | select(.databaseId > $LAST_RUN_ID)][0].databaseId") \
      || die "cannot list workflow runs"
    [[ -n "$run_id" && "$run_id" != "null" ]] && break
    sleep 3
  done
  [[ -n "$run_id" && "$run_id" != "null" ]] \
    || die "no new $WORKFLOW run found for $VERSION after 60s (last seen run before the push: $LAST_RUN_ID)"

  note "run $run_id — $(gh run view "$run_id" --json url --jq .url)"
  gh run watch "$run_id" --exit-status \
    || die "release workflow failed. Read it with: gh run view $run_id --log-failed"
  note "workflow succeeded"
}

# ------------------------------------------------------------ publish checks

verify_release() {
  step "Verifying the published release"
  require gh base64 grep

  # GoReleaser publishes one archive per target plus checksums.txt.
  local -a EXPECTED_ASSETS
  local plain="${VERSION#v}" os arch
  for os in darwin linux; do
    for arch in amd64 arm64; do
      EXPECTED_ASSETS+=("markdown-reviewer_${plain}_${os}_${arch}.tar.gz")
    done
  done
  EXPECTED_ASSETS+=("checksums.txt")

  local assets
  assets=$(gh release view "$VERSION" --repo "$REPO" --json assets --jq '.assets[].name') \
    || die "release $VERSION not found"

  # Check names, not just the count: a goreleaser config change that drops
  # darwin/arm64 while adding some other file still totals five, and a
  # count-only check would call that release verified.
  local want missing="" rc
  for want in $EXPECTED_ASSETS; do
    rc=0
    print -r -- "$assets" | grep -qxF -- "$want" || rc=$?
    case $rc in
      0) : ;;
      1) missing="$missing\n  - $want" ;;
      *) die "cannot inspect the asset list (grep rc=$rc)" ;;
    esac
  done
  [[ -z "$missing" ]] || die "release $VERSION is missing expected assets:$missing\ngot:\n$assets"
  note "assets: all ${#EXPECTED_ASSETS} expected files present"

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
  SERVICE_RESTARTED=1
  note "kickstarted $LAUNCHD_LABEL"
}

# Poll instead of sleeping: the server binds only after its file watcher has
# registered, so a fixed wait either races startup (the failure this replaces)
# or wastes time being conservative.
wait_until_healthy() {
  step "Waiting for the service to answer"
  # Gate on "did we restart something", not on "does launchctl exist": on a mac
  # without the cask installed (or with the agent unloaded) both launchctl and
  # curl are present, so probing anyway would spend 60s failing on a service
  # nobody started.
  if (( ! SERVICE_RESTARTED )); then
    note "no service was restarted — skipping health check"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    note "curl not found — skipping health check"
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

if [[ "$MODE" == "preflight" ]]; then
  preflight
  step "Preflight passed — nothing published"
  print -- "    run 'make release VERSION=$VERSION' to publish for real"
  exit 0
fi

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
