package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

// ownersFileVersion guards the on-disk shape so a future change can tell an
// old file from a new one instead of misreading it.
const ownersFileVersion = 1

// maxOwnersFileSize bounds what Persist reads; the file holds one small entry
// per opened file, so anything near this is not ours.
const maxOwnersFileSize = 4 << 20

type ownersFile struct {
	Owners  map[string]Identity `json:"owners"`
	Version int                 `json:"version"`
}

// Persist keeps `mr open` registrations in path so they survive a server
// restart (#362). It loads what an earlier run saved and saves on every later
// Register. A missing or unreadable file starts empty: the registrations are
// a convenience and must never stop the server from starting.
//
// Entries are dropped only when their session is confirmed gone: the adapter
// answered within the deadline and the session isn't among its live ones.
// An entry that could not be checked is kept; routing already ignores a
// registration whose session isn't live (choose), so keeping it is harmless,
// while dropping it on a slow or failed probe would lose it for good.
func (s *Service) Persist(ctx context.Context, path string) {
	loaded, err := readOwners(path)
	if err != nil {
		slog.Warn("agent: ignoring saved session registrations", "path", path, "error", err)
	}
	live, checked := s.liveSessions(ctx)
	s.mu.Lock()
	s.storePath = path
	for file, id := range loaded {
		if _, newer := s.owners[file]; newer {
			continue
		}
		if checked[id.AgentID] && !live.matches(id) {
			continue
		}
		s.owners[file] = id
	}
	s.mu.Unlock()
	s.save()
}

// liveSet holds every live session, by session and by session+PID: one
// session ID can be running in more than one process.
type liveSet map[string]bool

func sessionKey(agentID, sessionID string) string { return agentID + "\x00" + sessionID }

func processKey(agentID, sessionID string, pid int) string {
	return fmt.Sprintf("%s\x00%d", sessionKey(agentID, sessionID), pid)
}

func (l liveSet) matches(id Identity) bool {
	if id.PID == 0 {
		return l[sessionKey(id.AgentID, id.SessionID)]
	}
	return l[processKey(id.AgentID, id.SessionID, id.PID)]
}

// liveSessions returns the live sessions and which adapters answered. An
// adapter that errors, or a probe that ran into the deadline (a process
// check cut short reads as "not alive"), counts as unchecked.
func (s *Service) liveSessions(ctx context.Context) (liveSet, map[string]bool) {
	live := make(liveSet)
	checked := make(map[string]bool)
	for _, adapter := range s.adapters {
		sessions, err := adapter.Sessions(ctx)
		if err != nil || ctx.Err() != nil {
			continue
		}
		checked[adapter.ID()] = true
		for _, session := range sessions {
			live[sessionKey(adapter.ID(), session.ID)] = true
			live[processKey(adapter.ID(), session.ID, session.PID)] = true
		}
	}
	return live, checked
}

func readOwners(path string) (map[string]Identity, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	var file ownersFile
	if err := json.NewDecoder(io.LimitReader(f, maxOwnersFileSize)).Decode(&file); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if file.Version != ownersFileVersion {
		return nil, fmt.Errorf("unsupported version %d", file.Version)
	}
	owners := make(map[string]Identity, len(file.Owners))
	for path, id := range file.Owners {
		if !filepath.IsAbs(path) || id.AgentID == "" || id.SessionID == "" || id.PID < 0 {
			continue
		}
		owners[path] = id
	}
	return owners, nil
}

// save writes the current registrations atomically (temp file + rename) so a
// crash mid-write cannot leave a truncated file behind. Failures are logged,
// not returned: a registration that only lives in memory still works until
// the next restart.
func (s *Service) save() {
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	s.mu.Lock()
	path := s.storePath
	snapshot := make(map[string]Identity, len(s.owners))
	for file, id := range s.owners {
		snapshot[file] = id
	}
	s.mu.Unlock()
	if path == "" {
		return
	}
	if err := writeOwners(path, snapshot); err != nil {
		slog.Warn("agent: saving session registrations failed", "path", path, "error", err)
	}
}

func writeOwners(path string, owners map[string]Identity) error {
	raw, err := json.MarshalIndent(ownersFile{Version: ownersFileVersion, Owners: owners}, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".agent-owners-*.json")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
