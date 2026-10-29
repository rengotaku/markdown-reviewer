package reviewstore

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// MaxSummaries caps how many AI work summaries summaries.jsonl retains.
const MaxSummaries = 50

const summariesFile = "summaries.jsonl"

// Summary is one summaries.jsonl line: the AI's final reply after a send.
type Summary struct {
	ID          string `json:"id"`
	SentAt      string `json:"sent_at"`
	DoneAt      string `json:"done_at"`
	AgentID     string `json:"agent_id"`
	SessionName string `json:"session_name"`
	Text        string `json:"text"`
}

// ReadSummaries returns the stored summaries, oldest first. A missing file
// yields an empty list.
func ReadSummaries(root, relPath string) ([]Summary, error) {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(filepath.Join(dir, summariesFile))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("reviewstore: open summaries: %w", err)
	}
	defer func() { _ = f.Close() }()
	var out []Summary
	sc := bufio.NewScanner(f)
	// A summary is a whole reply and can exceed bufio's default 64 KiB cap.
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var s Summary
		if err := json.Unmarshal(line, &s); err != nil {
			return nil, fmt.Errorf("reviewstore: parse summaries line: %w", err)
		}
		out = append(out, s)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("reviewstore: read summaries: %w", err)
	}
	return out, nil
}

// AppendSummary adds s to summaries.jsonl, dropping the oldest entries beyond
// MaxSummaries. An entry with the same ID is not added twice.
func AppendSummary(root, relPath string, s Summary) error {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return err
	}
	existing, err := ReadSummaries(root, relPath)
	if err != nil {
		return err
	}
	for _, e := range existing {
		if e.ID == s.ID {
			return nil
		}
	}
	all := append(existing, s)
	if len(all) > MaxSummaries {
		all = all[len(all)-MaxSummaries:]
	}
	var buf bytes.Buffer
	for _, e := range all {
		line, err := json.Marshal(e)
		if err != nil {
			return fmt.Errorf("reviewstore: marshal summary: %w", err)
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}
	return atomicWrite(filepath.Join(dir, summariesFile), buf.Bytes())
}
