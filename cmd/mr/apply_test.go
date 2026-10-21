package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

const applyBody = "# Title\n\nAlpha line\n\nBravo line\n"

// setupApplyDoc prepares an ingested doc with last_read recorded (via
// setupDoc) plus one open comment anchored to "Bravo line" and one resolved
// comment, and returns the absolute path of the doc.
func setupApplyDoc(t *testing.T) (abs, rel string) {
	t.Helper()
	root := withRoots(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	rel = setupDoc(t, root, applyBody)
	if _, err := reviewstore.AddComment("works", rel, reviewstore.Comment{
		ID:     "c-001",
		Scope:  "range",
		Body:   "Bravo を直して",
		Status: reviewstore.StatusOpen,
		Anchor: &reviewstore.Anchor{HeadingPath: []string{"# Title"}, Snippet: "Bravo line", Occurrence: 0},
	}); err != nil {
		t.Fatalf("AddComment c-001: %v", err)
	}
	if _, err := reviewstore.AddComment("works", rel, reviewstore.Comment{
		ID: "c-002", Scope: "file", Body: "done", Status: reviewstore.StatusResolved,
	}); err != nil {
		t.Fatalf("AddComment c-002: %v", err)
	}
	return filepath.Join(root, rel), rel
}

func writeApplyJSON(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "apply.json")
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func readBody(t *testing.T, abs string) string {
	t.Helper()
	b, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestApply_EditsAndRepliesInOneCall(t *testing.T) {
	abs, rel := setupApplyDoc(t)
	in := writeApplyJSON(t, `{
		"edits":   [{"old": "Alpha line\n", "new": "Alpha line\n\nInserted line\n"}],
		"replies": [{"id": "c-001", "body": "直しました"}]
	}`)

	out, err := captureStdout(t, func() error { return cmdApply([]string{abs, in}) })
	if err != nil {
		t.Fatalf("cmdApply: %v", err)
	}
	if !strings.Contains(out, "edits 1 件, replies 1 件") {
		t.Errorf("stdout = %q, want a summary of the applied counts", out)
	}
	if got := readBody(t, abs); !strings.Contains(got, "Inserted line") {
		t.Fatalf("body = %q, want the edit applied", got)
	}

	c, ok, err := lookupComment(rel, "c-001")
	if err != nil || !ok {
		t.Fatalf("lookupComment: ok=%v err=%v", ok, err)
	}
	if len(c.Replies) != 1 || c.Replies[0].Author != "ai" || c.Replies[0].Body != "直しました" {
		t.Errorf("replies = %+v, want one reply from ai", c.Replies)
	}
	if c.Status != reviewstore.StatusOpen {
		t.Errorf("status = %q, apply must not resolve", c.Status)
	}
	if _, ok := reviewstore.ResolveAnchor(readBody(t, abs), *c.Anchor); !ok {
		t.Errorf("anchor %+v no longer resolves after apply", *c.Anchor)
	}

	revs, err := reviewstore.ListRevisions("works", rel)
	if err != nil || len(revs) == 0 {
		t.Fatalf("ListRevisions: %v (len %d)", err, len(revs))
	}
	if revs[0].Author != "ai" {
		t.Errorf("newest revision author = %q, want ai", revs[0].Author)
	}

	// The AI's own edit must not trip the drift guard on the next write.
	if err := checkWriteGuard("works", rel, abs, false); err != nil {
		t.Errorf("checkWriteGuard after apply = %v, want nil", err)
	}
}

func TestApply_RepliesOnlyLeavesBodyUntouched(t *testing.T) {
	abs, rel := setupApplyDoc(t)
	in := writeApplyJSON(t, `{"replies": [{"id": "c-001", "body": "確認しました"}]}`)
	if err := cmdApply([]string{abs, in}); err != nil {
		t.Fatalf("cmdApply: %v", err)
	}
	if got := readBody(t, abs); got != applyBody {
		t.Errorf("body changed to %q on a replies-only apply", got)
	}
	c, _, _ := lookupComment(rel, "c-001")
	if len(c.Replies) != 1 {
		t.Errorf("replies = %+v, want 1", c.Replies)
	}
}

// Every failure below must leave both the body and the sidecar untouched.
func TestApply_RejectsWithoutWriting(t *testing.T) {
	cases := []struct {
		name, json, wantErr string
	}{
		{"edit not found", `{"edits":[{"old":"Charlie","new":"x"}],"replies":[{"id":"c-001","body":"r"}]}`, "見つかりません"},
		{"edit ambiguous", `{"edits":[{"old":" line","new":"x"}],"replies":[{"id":"c-001","body":"r"}]}`, "2 回現れます"},
		{"empty old", `{"edits":[{"old":"","new":"x"}]}`, "old が空"},
		{"unknown reply id", `{"edits":[{"old":"Alpha","new":"A"}],"replies":[{"id":"c-999","body":"r"}]}`, "c-999"},
		{"resolved reply", `{"edits":[{"old":"Alpha","new":"A"}],"replies":[{"id":"c-002","body":"r"}]}`, "resolved"},
		{"empty reply body", `{"edits":[{"old":"Alpha","new":"A"}],"replies":[{"id":"c-001","body":" "}]}`, "body が空"},
		{"unknown field", `{"reply":[{"id":"c-001","body":"r"}]}`, "JSON"},
		{"nothing to do", `{"edits":[],"replies":[]}`, "ありません"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			abs, rel := setupApplyDoc(t)
			err := cmdApply([]string{abs, writeApplyJSON(t, tc.json)})
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.wantErr)
			}
			if got := readBody(t, abs); got != applyBody {
				t.Errorf("body changed to %q", got)
			}
			c, _, _ := lookupComment(rel, "c-001")
			if len(c.Replies) != 0 {
				t.Errorf("replies written despite the error: %+v", c.Replies)
			}
		})
	}
}

func TestApply_DriftGuard(t *testing.T) {
	abs, rel := setupApplyDoc(t)
	drifted := applyBody + "\nHuman edit\n"
	if err := os.WriteFile(abs, []byte(drifted), 0o644); err != nil {
		t.Fatal(err)
	}
	in := writeApplyJSON(t, `{"edits":[{"old":"Alpha","new":"A"}],"replies":[{"id":"c-001","body":"r"}]}`)

	if err := cmdApply([]string{abs, in}); err == nil || !strings.Contains(err.Error(), "--force") {
		t.Fatalf("err = %v, want the drift guard to block", err)
	}
	if got := readBody(t, abs); got != drifted {
		t.Fatalf("body changed despite the guard: %q", got)
	}

	if err := cmdApply([]string{abs, in, "--force"}); err != nil {
		t.Fatalf("cmdApply --force: %v", err)
	}
	if got := readBody(t, abs); !strings.Contains(got, "A line") || !strings.Contains(got, "Human edit") {
		t.Errorf("body = %q, want the edit applied on top of the human edit", got)
	}
	c, _, _ := lookupComment(rel, "c-001")
	if len(c.Replies) != 1 {
		t.Errorf("replies = %+v, want 1", c.Replies)
	}
}

func TestApply_ReadsStdin(t *testing.T) {
	abs, _ := setupApplyDoc(t)
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdin
	os.Stdin = r
	t.Cleanup(func() { os.Stdin = old })
	if _, err := w.WriteString(`{"edits":[{"old":"Alpha","new":"A"}]}`); err != nil {
		t.Fatal(err)
	}
	_ = w.Close()

	if err := cmdApply([]string{abs}); err != nil {
		t.Fatalf("cmdApply from stdin: %v", err)
	}
	if got := readBody(t, abs); !strings.Contains(got, "A line") {
		t.Errorf("body = %q, want the edit applied", got)
	}
}

// An edit that rewrites the anchored line itself only stays attached if the
// comments are re-anchored on the write path; a plain snippet search would
// lose it.
func TestApply_ReanchorsEditedLine(t *testing.T) {
	abs, rel := setupApplyDoc(t)
	in := writeApplyJSON(t, `{"edits":[{"old":"Bravo line","new":"Bravo row"}]}`)
	if err := cmdApply([]string{abs, in}); err != nil {
		t.Fatalf("cmdApply: %v", err)
	}
	c, _, _ := lookupComment(rel, "c-001")
	if c.Anchor == nil || c.Anchor.Orphan {
		t.Fatalf("anchor = %+v, want it re-anchored, not orphaned", c.Anchor)
	}
	if _, ok := reviewstore.ResolveAnchor(readBody(t, abs), *c.Anchor); !ok {
		t.Errorf("anchor %+v does not resolve against the edited body", *c.Anchor)
	}
}
