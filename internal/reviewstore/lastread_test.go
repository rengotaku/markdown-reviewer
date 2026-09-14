package reviewstore

import "testing"

func TestLastRead_RoundTrip(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}

	if _, ok, err := ReadLastRead(root, rel); err != nil || ok {
		t.Fatalf("ReadLastRead before any record: ok=%v err=%v, want ok=false", ok, err)
	}

	if err := RecordLastRead(root, rel, "abc123", "r-002"); err != nil {
		t.Fatalf("RecordLastRead: %v", err)
	}

	got, ok, err := ReadLastRead(root, rel)
	if err != nil {
		t.Fatalf("ReadLastRead: %v", err)
	}
	if !ok {
		t.Fatal("ReadLastRead: ok = false after RecordLastRead")
	}
	if got.Sha != "abc123" || got.RevID != "r-002" || got.Ts == "" {
		t.Fatalf("LastRead = %+v", got)
	}
}

func TestRecordLastRead_NoopForDraftFile(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "draft.md"
	// Never ingested.
	if err := RecordLastRead(root, rel, "abc123", ""); err != nil {
		t.Fatalf("RecordLastRead on a draft file returned an error: %v", err)
	}
	if _, ok, err := ReadLastRead(root, rel); err != nil || ok {
		t.Fatalf("ReadLastRead after a no-op RecordLastRead: ok=%v err=%v, want ok=false", ok, err)
	}
}

func TestNewestRevisionID(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if _, ok, err := NewestRevisionID(root, rel); err != nil || ok {
		t.Fatalf("NewestRevisionID before any revision: ok=%v err=%v, want ok=false", ok, err)
	}

	if _, _, err := AppendRevision(root, rel, "human", "v1"); err != nil {
		t.Fatalf("AppendRevision v1: %v", err)
	}
	if _, _, err := AppendRevision(root, rel, "ai", "v2"); err != nil {
		t.Fatalf("AppendRevision v2: %v", err)
	}

	id, ok, err := NewestRevisionID(root, rel)
	if err != nil {
		t.Fatalf("NewestRevisionID: %v", err)
	}
	if !ok || id != "r-002" {
		t.Fatalf("NewestRevisionID = (%q, %v), want (\"r-002\", true)", id, ok)
	}
}

func TestShortSha_MatchesAppendRevision(t *testing.T) {
	withTempStore(t)
	const root, rel = "rooms", "doc.md"
	if err := Ingest(root, rel); err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	rev, created, err := AppendRevision(root, rel, "human", "hello")
	if err != nil || !created {
		t.Fatalf("AppendRevision: created=%v err=%v", created, err)
	}
	if got := ShortSha("hello"); got != rev.Sha {
		t.Fatalf("ShortSha(%q) = %q, want %q (must match what AppendRevision stored)", "hello", got, rev.Sha)
	}
}
