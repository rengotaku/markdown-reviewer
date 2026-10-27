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
// restart (#362). It loads what an earlier run saved, dropping entries whose
// session is no longer alive, and saves on every later Register. A missing or
// unreadable file starts empty: the registrations are a convenience and must
// never stop the server from starting.
func (s *Service) Persist(ctx context.Context, path string) {
	loaded, err := readOwners(path)
	if err != nil {
		slog.Warn("agent: ignoring saved session registrations", "path", path, "error", err)
	}
	alive := s.liveSessions(ctx)
	s.mu.Lock()
	s.storePath = path
	for file, id := range loaded {
		if _, newer := s.owners[file]; !newer && matchesLive(alive, id) {
			s.owners[file] = id
		}
	}
	s.mu.Unlock()
	s.save()
}

func liveKey(agentID, sessionID string) string { return agentID + "\x00" + sessionID }

// liveSessions maps each live session to its PID (0 when the adapter does not
// identify sessions by process). An adapter that cannot be queried
// contributes nothing, so its saved entries are dropped rather than trusted.
func (s *Service) liveSessions(ctx context.Context) map[string]int {
	alive := make(map[string]int)
	for _, adapter := range s.adapters {
		sessions, err := adapter.Sessions(ctx)
		if err != nil {
			continue
		}
		for _, session := range sessions {
			alive[liveKey(adapter.ID(), session.ID)] = session.PID
		}
	}
	return alive
}

func matchesLive(alive map[string]int, id Identity) bool {
	pid, ok := alive[liveKey(id.AgentID, id.SessionID)]
	return ok && (id.PID == 0 || pid == id.PID)
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
