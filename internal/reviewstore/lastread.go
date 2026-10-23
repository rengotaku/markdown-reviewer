package reviewstore

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// lastReadFile records the state of the canonical body the last time an
// AI-facing read command (`mr comments` / `mr review`) successfully loaded
// it (#322). Kept in its own file rather than folded into review.json or
// history.jsonl because it is bookkeeping about a *read*, not review state
// or content history, and both `mr comments`/`mr review` (which write it) and
// `mr reply`/`resolve`/`reopen`/`diff` (which only read it) need to do so
// without touching either of those files.
const lastReadFile = "last_read.json"

// LastRead is last_read.json's shape: the hint-stripped short sha of the
// canonical body as last seen by a tracked read, the id of the newest
// revision in history.jsonl at that moment (empty if none existed yet), and
// when. RevID is deliberately just an id, not a content copy — GetRevision
// already looks up a revision's Content by id, so last_read.json stays tiny
// instead of growing an unbounded second copy of every snapshot it ever
// pointed at.
type LastRead struct {
	Sha   string `json:"sha"`
	RevID string `json:"rev_id,omitempty"`
	Ts    string `json:"ts"`
}

// ReadLastRead loads the entry's last_read.json. ok=false (nil error) means
// either the file has never been read via a tracked command, or the file is
// not ingested at all — callers must treat both the same way: there is no
// baseline to diff or guard against yet.
func ReadLastRead(root, relPath string) (LastRead, bool, error) {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return LastRead{}, false, err
	}
	data, err := os.ReadFile(filepath.Join(dir, lastReadFile))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return LastRead{}, false, nil
		}
		return LastRead{}, false, err
	}
	var lr LastRead
	if err := json.Unmarshal(data, &lr); err != nil {
		return LastRead{}, false, err
	}
	return lr, true, nil
}

// RecordLastRead stamps last_read.json with the hint-stripped short sha of
// what an AI-facing read command just loaded (strippedSha) and the newest
// revision id known at that moment (revID, empty when the file has no
// history yet). No-op for a draft (un-ingested) file, mirroring
// AppendRevision — there is no review state to guard once ingested review
// state does not exist.
func RecordLastRead(root, relPath, strippedSha, revID string) error {
	if !HasEntry(root, relPath) {
		return nil
	}
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return err
	}
	lr := LastRead{Sha: strippedSha, RevID: revID, Ts: time.Now().Format(time.RFC3339)}
	data, err := json.MarshalIndent(lr, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(dir, lastReadFile), append(data, '\n'))
}
