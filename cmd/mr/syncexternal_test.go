package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"markdown-reviewer/internal/reviewstore"
)

// TestReadForReview_OutOfBandEdit_Reanchors covers the CLI half of #61: the AI
// edits the .md on disk, then runs `mr review` — the comment must follow its
// rewritten line instead of orphaning.
func TestReadForReview_OutOfBandEdit_Reanchors(t *testing.T) {
	rootDir := t.TempDir()
	rootsJSON, err := json.Marshal([]map[string]string{{"name": "rooms", "path": rootDir}})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("REVIEW_ROOTS", string(rootsJSON))
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())

	doc := filepath.Join(rootDir, "doc.md")
	oldBody := "# Title\n\nThe quick brown fox jumps.\n"
	if werr := os.WriteFile(doc, []byte(oldBody), 0o644); werr != nil {
		t.Fatal(werr)
	}
	if ierr := reviewstore.Ingest("rooms", "doc.md"); ierr != nil {
		t.Fatal(ierr)
	}
	if _, _, aerr := reviewstore.AppendRevision("rooms", "doc.md", "human", oldBody); aerr != nil {
		t.Fatal(aerr)
	}
	cm, err := reviewstore.AddComment("rooms", "doc.md", reviewstore.Comment{
		Scope: "inline", Body: "fix this",
		Anchor: &reviewstore.Anchor{
			HeadingPath: []string{"# Title"},
			Snippet:     "quick brown fox jumps",
			Occurrence:  0,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Out-of-band edit, no PUT involved.
	newBody := "# Title\n\nThe quick RED fox leaps high.\n"
	if werr := os.WriteFile(doc, []byte(newBody), 0o644); werr != nil {
		t.Fatal(werr)
	}

	_, content, comments, err := readForReview(doc)
	if err != nil {
		t.Fatalf("readForReview: %v", err)
	}
	if len(comments) != 1 || comments[0].ID != cm.ID {
		t.Fatalf("comments = %+v", comments)
	}
	lr, ok := reviewstore.ResolveAnchor(content, *comments[0].Anchor)
	if !ok {
		t.Fatalf("comment orphaned after out-of-band edit (anchor=%+v)", *comments[0].Anchor)
	}
	if lr[0] != 3 {
		t.Errorf("re-anchored line = %d, want 3", lr[0])
	}
}
