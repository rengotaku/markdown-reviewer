package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

// cmdRevisions lists a file's revision history, newest first — the same
// projection ListRevisions returns (id / timestamp / author, content
// omitted), so `mr restore` can be pointed at an id without opening the web
// UI first.
func cmdRevisions(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 1 {
		return fmt.Errorf("usage: mr revisions <path> [--json]")
	}
	root, rel, _, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	metas, err := reviewstore.ListRevisions(root, rel)
	if err != nil {
		return err
	}
	if flags["json"] != "" {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(metas)
	}
	if len(metas) == 0 {
		fmt.Println("履歴はありません。")
		return nil
	}
	for _, m := range metas {
		fmt.Printf("%s  %s  %s\n", m.ID, m.Ts, m.Author)
	}
	return nil
}

// cmdRestore writes the file's canonical body back to a prior revision
// (issue #282). It shares reviewstore.Restore's side effects with the HTTP
// handler: the current body is snapshotted as a new "before restore"
// revision first (undoable), then anchors are re-pointed onto the restored
// body, then this writes the result to disk atomically.
//
// Concurrency (codex review): the CLI and the Web UI's PUT /api/files run in
// separate processes, so the handler's per-path lockPath buys this nothing.
// Between the read above and the write below, the Web UI can save a body
// that never makes it into any revision (PUT deliberately does not
// snapshot, #280) — an unconditional overwrite here would silently discard
// that save. A full cross-process lock is more machinery than a single-user
// local tool warrants (YAGNI), so instead this re-reads the file
// immediately before writing and compares its sha to what was read above:
// if anything changed the file out from under this command, it aborts
// without writing rather than guessing which version should win. The race
// window between that re-read and the rename is not closed (doing so would
// need the cross-process lock this deliberately skips), but the much wider
// and much more likely window — a save that lands during Restore's own
// read-revisions/append-revision/reanchor work — is.
//
// review.json rollback (codex review round 2): reviewstore.Restore persists
// its re-anchored review.json as one of its side effects, *before* this
// function's CAS check runs. If the CAS check then aborts the canonical-file
// write, the anchors would be left pointing at a body that was never
// actually written — the file stays whatever the concurrent writer put
// there, but review.json now describes positions in the restored body that
// don't exist on disk, orphaning comments that used to resolve fine. This
// snapshots review.json's raw bytes before calling Restore and, on an abort,
// writes them back — but see restoreReviewJSON's own doc comment (codex
// review round 3): the write-back is itself a second CAS, not an
// unconditional overwrite, because an unconditional one reopens exactly the
// same class of lost-write bug this function exists to close.
func cmdRestore(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 2 {
		return fmt.Errorf("usage: mr restore <path> <id> [--author NAME]")
	}
	root, rel, abs, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	beforeSha := files.Sha256Hex(raw)

	reviewPath, reviewBefore, reviewBeforeExisted, err := snapshotReviewJSON(root, rel)
	if err != nil {
		return err
	}

	// external, not "ai": the CLI cannot tell who actually produced the
	// content sitting on disk right now (a save through the Web UI, an
	// external editor, an AI edit — resolveRegistered/os.ReadFile give no
	// hint). That is the same situation SyncExternalEdit is in for exactly
	// the same reason, so this reuses its label instead of guessing "ai".
	author := flags["author"]
	if author == "" {
		author = "external"
	}
	restored, found, err := reviewstore.Restore(root, rel, pos[1], author, string(raw))
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("revision %q not found for %s", pos[1], pos[0])
	}

	// Snapshot review.json again right after Restore returns — this is the
	// state we expect to still find it in if the canonical-file CAS check
	// below aborts. Anything Restore itself did (e.g. moving an anchor, or
	// picking up a comment someone added before Restore's own internal
	// ReadReview) is already folded into this snapshot; only a write landing
	// *after* this point and before the rollback runs counts as "someone
	// else touched it" — see restoreReviewJSON's doc comment.
	_, reviewAfterRestore, reviewAfterRestoreExisted, err := snapshotReviewJSON(root, rel)
	if err != nil {
		return err
	}

	if err := writeIfUnchangedSince(abs, beforeSha, []byte(restored)); err != nil {
		if rerr := restoreReviewJSON(reviewPath, reviewBefore, reviewBeforeExisted, reviewAfterRestore, reviewAfterRestoreExisted); rerr != nil {
			fmt.Fprintln(os.Stderr, "mr: warning: "+rerr.Error())
		}
		return fmt.Errorf("%s changed on disk while restoring (someone else saved it in the meantime); nothing was written — re-run `mr restore %s %s` to try again", pos[0], pos[0], pos[1])
	}
	if err := reviewstore.RecordAppWrite(root, rel, restored); err != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: recording app write failed: "+err.Error())
	}
	fmt.Printf("%s を %s の内容へ復元しました（復元前の内容は新しい revision として保存済み）\n", pos[0], pos[1])
	return nil
}

// snapshotReviewJSON returns the entry's review.json path and its raw bytes
// right now (before reviewstore.Restore has a chance to rewrite it), plus
// whether the file existed at all — cmdRestore's CAS-abort path needs all
// three to roll the sidecar back to exactly this state. A missing file is
// not an error (existed=false); everything else is.
func snapshotReviewJSON(root, rel string) (path string, before []byte, existed bool, err error) {
	dir, err := reviewstore.EntryDir(root, rel)
	if err != nil {
		return "", nil, false, err
	}
	path = filepath.Join(dir, reviewstore.ReviewFileName)
	before, err = os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return path, nil, false, nil
		}
		return "", nil, false, err
	}
	return path, before, true, nil
}

// restoreReviewJSON undoes reviewstore.Restore's review.json write, putting
// it back to the pre-Restore snapshot (`target`/`targetExisted`) — but only
// if review.json still matches `guard`/`guardExisted`, the snapshot taken
// right after Restore returned (see cmdRestore's call site).
//
// Round-2 rollback wrote `target` back unconditionally, comparing nothing.
// That reopened the same class of bug the canonical-file CAS guard exists to
// close: between Restore returning and this rollback running (the
// canonical-file CAS check, which can itself take a moment), the Web UI can
// add a comment or reply — a successful save with no revision to recover it
// from — and an unconditional write-back here would silently discard it
// (codex review round 3). So this rollback is itself a compare-and-swap,
// mirroring writeIfUnchangedSince's "if it changed, don't touch it" policy
// instead of guessing which version should win.
//
// The guard is deliberately the *post-Restore* snapshot, not the original
// pre-Restore one: Restore's own review.json write (e.g. moving an anchor,
// or folding in a comment someone added before Restore's internal
// ReadReview ran) is expected and must not itself look like tampering — only
// a write landing after Restore returned counts. A mismatch there means a
// third party touched review.json in that narrow window; that write is left
// alone and reported as a warning instead of overwritten. The anchors
// Restore moved then stay pointing at a body that was never written, but
// that's a self-healing inconsistency, not data loss: the next comment read
// runs SyncExternalEdit, which detects the canonical file no longer matches
// the newest revision and re-resolves anchors against what's actually on
// disk.
func restoreReviewJSON(path string, target []byte, targetExisted bool, guard []byte, guardExisted bool) error {
	current, err := os.ReadFile(path)
	currentExisted := err == nil
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	if currentExisted != guardExisted || (guardExisted && files.Sha256Hex(current) != files.Sha256Hex(guard)) {
		return fmt.Errorf("review.json changed after the restore attempt started; leaving it as-is instead of rolling it back — comment anchors may briefly point at the wrong lines until the next `mr comments`/`mr review` re-resolves them")
	}

	if !targetExisted {
		// Rolling back to "didn't exist" means removing whatever is there
		// now — but only reachable here once the guard above has confirmed
		// nothing but Restore touched it since the pre-Restore snapshot, so
		// removing it doesn't discard a third party's write.
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return atomicWriteFile(path, target)
}

// writeIfUnchangedSince is cmdRestore's compare-and-swap guard, pulled into
// its own function so the race it closes (see cmdRestore's doc comment) is
// unit-testable without racing goroutines against real wall-clock timing —
// callers just supply a `beforeSha` that no longer matches what's on disk.
//
// It re-reads target and compares its sha to beforeSha; on a match it writes
// data atomically, on a mismatch it writes nothing and returns an error.
var errCASMismatch = fmt.Errorf("file changed on disk since it was last read")

func writeIfUnchangedSince(target, beforeSha string, data []byte) error {
	current, err := os.ReadFile(target)
	if err != nil {
		return err
	}
	if files.Sha256Hex(current) != beforeSha {
		return errCASMismatch
	}
	return atomicWriteFile(target, data)
}

// atomicWriteFile writes data to a temp file beside target and renames it
// into place, so a process interrupted mid-write (e.g. Ctrl-C) never leaves
// target half-written. Mirrors internal/handler's atomicWrite / the
// reviewstore package's atomicWrite — both unexported to their own packages,
// so `mr restore` needs its own copy rather than importing either.
func atomicWriteFile(target string, data []byte) error {
	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, ".tmp-mr-*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpPath, target); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	committed = true
	return nil
}
