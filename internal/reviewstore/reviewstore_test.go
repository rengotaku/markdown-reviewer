package reviewstore

import (
	"path/filepath"
	"testing"
)

// withTempStore points the store at a fresh temp dir for the duration of one
// test via the REVIEWER_CONFIG_DIR override.
func withTempStore(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv(configDirEnv, dir)
	return dir
}

func TestHasEntryAndIngest(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "2026-06-29/doc.md"

	if HasEntry(root, rel) {
		t.Fatal("expected no entry before ingest")
	}
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if !HasEntry(root, rel) {
		t.Fatal("expected entry after ingest")
	}

	// Ingest is idempotent and must not clobber an existing entry.
	if _, _, err := AppendRevision(root, rel, "ai", "first body"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("second Ingest: %v", err)
	}
	metas, err := ListRevisions(root, rel)
	if err != nil {
		t.Fatalf("ListRevisions: %v", err)
	}
	if len(metas) != 1 {
		t.Fatalf("idempotent ingest dropped history: got %d revisions", len(metas))
	}
}

func TestAppendRevisionRequiresIngest(t *testing.T) {
	withTempStore(t)
	rev, ok, err := AppendRevision("rooms", "draft.md", "ai", "content")
	if err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}
	if ok {
		t.Fatalf("draft file must accrue no history, got %+v", rev)
	}
}

func TestAppendRevisionDedupe(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}

	if _, ok, _ := AppendRevision(root, rel, "ai", "same"); !ok {
		t.Fatal("first append should write")
	}
	if _, ok, _ := AppendRevision(root, rel, "human", "same"); ok {
		t.Fatal("identical content should dedupe")
	}
	if _, ok, _ := AppendRevision(root, rel, "human", "different"); !ok {
		t.Fatal("changed content should write")
	}

	metas, err := ListRevisions(root, rel)
	if err != nil {
		t.Fatalf("ListRevisions: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("want 2 revisions after dedupe, got %d", len(metas))
	}
	// Newest first.
	if metas[0].ID != "r-002" || metas[1].ID != "r-001" {
		t.Fatalf("unexpected ordering / ids: %+v", metas)
	}
}

func TestRevisionCap(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	for i := 0; i < MaxRevisions+5; i++ {
		content := "body-" + string(rune('a'+i))
		if _, ok, err := AppendRevision(root, rel, "ai", content); err != nil || !ok {
			t.Fatalf("append %d: ok=%v err=%v", i, ok, err)
		}
	}
	metas, err := ListRevisions(root, rel)
	if err != nil {
		t.Fatalf("ListRevisions: %v", err)
	}
	if len(metas) != MaxRevisions {
		t.Fatalf("cap not enforced: got %d want %d", len(metas), MaxRevisions)
	}
	// IDs keep incrementing past the cap; newest is r-025 (1-indexed count).
	if metas[0].ID != "r-025" {
		t.Fatalf("ids should keep climbing past cap, newest=%s", metas[0].ID)
	}
}

func TestGetRevision(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, _, err := AppendRevision(root, rel, "ai", "hello world"); err != nil {
		t.Fatalf("AppendRevision: %v", err)
	}

	rev, ok, err := GetRevision(root, rel, "r-001")
	if err != nil {
		t.Fatalf("GetRevision: %v", err)
	}
	if !ok {
		t.Fatal("expected r-001 to exist")
	}
	if rev.Content != "hello world" {
		t.Fatalf("content mismatch: %q", rev.Content)
	}
	if rev.Sha == "" || rev.Ts == "" {
		t.Fatalf("revision missing sha/ts: %+v", rev)
	}

	if _, ok, _ := GetRevision(root, rel, "r-999"); ok {
		t.Fatal("nonexistent revision should not be found")
	}
}

func TestEntryDirRejectsTraversal(t *testing.T) {
	withTempStore(t)
	cases := []struct {
		root, rel string
	}{
		{"rooms", "../escape.md"},
		{"rooms", "a/../../escape.md"},
		{"..", "doc.md"},
		{"ro/ots", "doc.md"},
		{"rooms", ""},
	}
	for _, c := range cases {
		if _, err := EntryDir(c.root, c.rel); err == nil {
			t.Fatalf("expected rejection for root=%q rel=%q", c.root, c.rel)
		}
	}
}

func TestEntryDirMirrorsTree(t *testing.T) {
	base := withTempStore(t)
	dir, err := EntryDir("rooms", "2026-06-29/doc.md")
	if err != nil {
		t.Fatalf("EntryDir: %v", err)
	}
	want := filepath.Join(base, "rooms", "2026-06-29", "doc.md")
	if dir != want {
		t.Fatalf("entry dir mismatch:\n got %q\nwant %q", dir, want)
	}
}
