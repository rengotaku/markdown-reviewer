// Package reviewstore is the managed-review-session storage layer. It keeps
// review state (comments + revision history) OUT of the canonical .md folder
// and OUT of the database, mirroring the review tree under the user config
// directory instead:
//
//	<config>/reviewer/<root>/<relative-path>/
//	  ├─ review.json     review comments (schema owned by a later issue)
//	  └─ history.jsonl   revision snapshots (one JSON object per line)
//
// Rationale (issue #49): the canonical file in the room folder stays byte-for-
// byte clean and git-trackable, while review state lives at a stable on-disk
// location that survives `make darwin` / launchd restarts (the production DB
// runs with an in-memory DSN and would lose anything written to it).
package reviewstore

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// MaxRevisions caps how many snapshots history.jsonl retains. Review loops run
// a handful of rounds, so 20 is plenty; older entries are dropped on append.
const MaxRevisions = 20

const (
	reviewFile  = "review.json"
	historyFile = "history.jsonl"

	// configDirEnv lets tests (and unusual deployments) point the store at an
	// arbitrary directory instead of the real user config dir.
	configDirEnv = "REVIEWER_CONFIG_DIR"
)

// ErrInvalidPath is returned when a root name or relative path would escape
// the store root (empty, absolute, or containing a `..` segment).
var ErrInvalidPath = errors.New("reviewstore: invalid path")

// Revision is one history.jsonl entry: a full content snapshot of a prior
// save. Content is stored verbatim (already AI-hint-stripped by the caller)
// so diffs stay free of the per-save hint churn.
type Revision struct {
	ID      string `json:"id"`
	Ts      string `json:"ts"`
	Author  string `json:"author"`
	Sha     string `json:"sha"`
	Content string `json:"content"`
}

// RevisionMeta is the lightweight projection returned by ListRevisions: the
// content is omitted so a listing stays cheap.
type RevisionMeta struct {
	ID     string `json:"id"`
	Ts     string `json:"ts"`
	Author string `json:"author"`
}

// baseDir returns the reviewer storage root, honoring REVIEWER_CONFIG_DIR
// first, then XDG_CONFIG_HOME, then os.UserConfigDir (~/.config on Linux,
// ~/Library/Application Support on darwin — both acceptable as a stable
// per-user location).
func baseDir() (string, error) {
	if v := strings.TrimSpace(os.Getenv(configDirEnv)); v != "" {
		return v, nil
	}
	if v := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); v != "" {
		return filepath.Join(v, "reviewer"), nil
	}
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("reviewstore: locate config dir: %w", err)
	}
	return filepath.Join(cfg, "reviewer"), nil
}

// BaseDir exposes the reviewer storage root (see baseDir) so out-of-package
// callers — e.g. the mr CLI's inbox scan — locate sidecars the same way the
// server does, instead of re-deriving the path and risking drift.
func BaseDir() (string, error) { return baseDir() }

// ReviewFileName is the per-entry comments file name (review.json), exported so
// a scanner can recognize sidecar entries on disk.
const ReviewFileName = reviewFile

// EntryDir is the directory holding review state for one canonical file. The
// relative path (including the .md filename) becomes a directory so review.json
// and history.jsonl sit beside each other, mirroring the source tree.
func EntryDir(root, relPath string) (string, error) {
	if err := validateSegment(root); err != nil {
		return "", err
	}
	clean, err := cleanRel(relPath)
	if err != nil {
		return "", err
	}
	base, err := baseDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, root, filepath.FromSlash(clean)), nil
}

// validateSegment rejects a root name that is empty or carries a path
// separator / traversal — it must be a single safe directory component.
func validateSegment(name string) error {
	if name == "" || name == "." || name == ".." {
		return fmt.Errorf("%w: root %q", ErrInvalidPath, name)
	}
	if strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) {
		return fmt.Errorf("%w: root %q contains separator", ErrInvalidPath, name)
	}
	return nil
}

// cleanRel normalizes a forward-slash relative path and rejects anything that
// would escape the entry root (absolute, empty, or with a `..` segment).
func cleanRel(relPath string) (string, error) {
	rel := strings.TrimPrefix(relPath, "/")
	if rel == "" {
		return "", fmt.Errorf("%w: empty relative path", ErrInvalidPath)
	}
	clean := filepath.ToSlash(filepath.Clean(rel))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || filepath.IsAbs(clean) {
		return "", fmt.Errorf("%w: %q escapes store root", ErrInvalidPath, relPath)
	}
	return clean, nil
}

// HasEntry reports whether the file has been ingested (its review.json exists).
// This is the single source of truth for the draft → review state boundary.
func HasEntry(root, relPath string) bool {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return false
	}
	_, statErr := os.Stat(filepath.Join(dir, reviewFile))
	return statErr == nil
}

// Ingest transitions a file from draft to review by creating its entry
// directory and an empty review.json. Idempotent: a second call leaves an
// existing review.json untouched so already-collected comments survive.
func Ingest(root, relPath string) error {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("reviewstore: create entry dir: %w", err)
	}
	reviewPath := filepath.Join(dir, reviewFile)
	if _, statErr := os.Stat(reviewPath); statErr == nil {
		return nil // already ingested; keep existing comments
	}
	if err := writeReview(reviewPath, Review{Version: reviewVersion, Comments: []Comment{}}); err != nil {
		return err
	}
	return nil
}

// AppendRevision records content as a new snapshot for an ingested file.
//
// Behavior:
//   - no-op (returns ok=false) when the file is not ingested — draft files
//     accrue no history.
//   - dedupe: if content is identical to the most recent snapshot, nothing is
//     written and ok=false is returned.
//   - cap: only the newest MaxRevisions snapshots are retained.
//
// author labels who produced the saved content ("ai" / "human" / "unknown").
func AppendRevision(root, relPath, author, content string) (Revision, bool, error) {
	if !HasEntry(root, relPath) {
		return Revision{}, false, nil
	}
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return Revision{}, false, err
	}
	existing, err := readRevisions(filepath.Join(dir, historyFile))
	if err != nil {
		return Revision{}, false, err
	}

	sha := shortSha(content)
	if n := len(existing); n > 0 && existing[n-1].Sha == sha {
		return Revision{}, false, nil // unchanged since last save
	}

	if author == "" {
		author = "unknown"
	}
	rev := Revision{
		ID:      nextID(existing),
		Ts:      time.Now().Format(time.RFC3339),
		Author:  author,
		Sha:     sha,
		Content: content,
	}

	all := append(existing, rev)
	if len(all) > MaxRevisions {
		all = all[len(all)-MaxRevisions:]
	}
	if err := writeRevisions(filepath.Join(dir, historyFile), all); err != nil {
		return Revision{}, false, err
	}
	return rev, true, nil
}

// ListRevisions returns the snapshots newest-first, without their content.
// An un-ingested or history-less file yields an empty slice (not an error).
func ListRevisions(root, relPath string) ([]RevisionMeta, error) {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return nil, err
	}
	revs, err := readRevisions(filepath.Join(dir, historyFile))
	if err != nil {
		return nil, err
	}
	out := make([]RevisionMeta, 0, len(revs))
	for i := len(revs) - 1; i >= 0; i-- {
		out = append(out, RevisionMeta{ID: revs[i].ID, Ts: revs[i].Ts, Author: revs[i].Author})
	}
	return out, nil
}

// GetRevision returns one snapshot by id. ok=false means no such revision.
func GetRevision(root, relPath, id string) (Revision, bool, error) {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return Revision{}, false, err
	}
	revs, err := readRevisions(filepath.Join(dir, historyFile))
	if err != nil {
		return Revision{}, false, err
	}
	for _, r := range revs {
		if r.ID == id {
			return r, true, nil
		}
	}
	return Revision{}, false, nil
}

// readRevisions parses history.jsonl oldest-first. A missing file is an empty
// history, not an error. Blank lines are tolerated; a malformed line aborts.
func readRevisions(path string) ([]Revision, error) {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("reviewstore: open history: %w", err)
	}
	defer func() { _ = f.Close() }()

	var out []Revision
	sc := bufio.NewScanner(f)
	// Snapshots hold whole-document content, which can exceed bufio's default
	// 64 KiB token cap; grow the buffer so large markdown files still parse.
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var r Revision
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			return nil, fmt.Errorf("reviewstore: parse history line: %w", err)
		}
		out = append(out, r)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("reviewstore: read history: %w", err)
	}
	return out, nil
}

// writeRevisions rewrites history.jsonl from the given (oldest-first) slice.
// Rewriting the whole file keeps the MaxRevisions trim trivial and correct;
// the file is tiny (≤20 markdown snapshots) so the cost is irrelevant.
func writeRevisions(path string, revs []Revision) error {
	var b strings.Builder
	for _, r := range revs {
		line, err := json.Marshal(r)
		if err != nil {
			return fmt.Errorf("reviewstore: marshal revision: %w", err)
		}
		b.Write(line)
		b.WriteByte('\n')
	}
	return atomicWrite(path, []byte(b.String()))
}

// nextID assigns r-NNN one past the highest numeric suffix currently present.
// Deriving from the max (not the count) keeps IDs unique even after the
// MaxRevisions trim drops older entries.
func nextID(existing []Revision) string {
	max := 0
	for _, r := range existing {
		if n, ok := parseID(r.ID); ok && n > max {
			max = n
		}
	}
	return fmt.Sprintf("r-%03d", max+1)
}

func parseID(id string) (int, bool) {
	s := strings.TrimPrefix(id, "r-")
	if s == id {
		return 0, false
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

func shortSha(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])[:12]
}

// atomicWrite writes via a temp file + rename in the same directory so a
// crash never leaves a half-written review.json / history.jsonl. The parent
// directory is created if missing.
func atomicWrite(target string, data []byte) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("reviewstore: mkdir: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".tmp-rs-*")
	if err != nil {
		return fmt.Errorf("reviewstore: create temp: %w", err)
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
		return fmt.Errorf("reviewstore: write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("reviewstore: sync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("reviewstore: close temp: %w", err)
	}
	if err := os.Rename(tmpPath, target); err != nil {
		return fmt.Errorf("reviewstore: rename: %w", err)
	}
	committed = true
	return nil
}
