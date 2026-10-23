// Package agent selects a review recipient independently of the AI or transport.
package agent

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Session is a live session normalized by an adapter. Instance identifies the
// process incarnation and is opaque to the selector. PID may be zero for an
// adapter whose sessions are not identified by local processes.
type Session struct {
	ID       string
	Cwd      string
	Name     string
	Instance string
	PID      int
	Ready    bool
}

type Identity struct {
	AgentID   string `json:"agent_id"`
	SessionID string `json:"session_id"`
	PID       int    `json:"pid,omitempty"`
}

type Result struct {
	Command     string `json:"command"`
	Reason      string `json:"reason,omitempty"`
	SessionName string `json:"session_name,omitempty"`
	AgentID     string `json:"agent_id,omitempty"`
	Sent        bool   `json:"sent"`
}

var (
	ErrBusy       = errors.New("session is not ready for input")
	ErrNoSession  = errors.New("session no longer exists")
	ErrNoTerminal = errors.New("session has no supported terminal")
)

// Adapter owns discovery, native status interpretation and actual delivery.
// Send must revalidate the session's incarnation and readiness immediately
// before delivery. The shared selector never interprets native metadata.
type Adapter interface {
	ID() string
	Sessions(context.Context) ([]Session, error)
	Send(context.Context, Session, string) error
}

// Sender is the interface consumed by HTTP handlers.
type Sender interface {
	Register(context.Context, string, Identity) bool
	Send(context.Context, string) Result
}

type Service struct {
	owners   map[string]Identity
	adapters []Adapter
	mu       sync.Mutex
	sending  sync.Mutex
}

func New(adapters ...Adapter) *Service {
	seen := make(map[string]bool)
	for _, adapter := range adapters {
		if adapter == nil || adapter.ID() == "" || seen[adapter.ID()] {
			panic("agent: adapters must have unique, non-empty IDs")
		}
		seen[adapter.ID()] = true
	}
	return &Service{adapters: append([]Adapter(nil), adapters...), owners: make(map[string]Identity)}
}

func canonical(path string) string {
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return filepath.Clean(path)
}

func contains(dir, path string) bool {
	rel, err := filepath.Rel(canonical(dir), canonical(path))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func ReviewCommand(path string) string {
	return "mr comments '" + strings.ReplaceAll(path, "'", "'\"'\"'") + "'"
}

func (s *Service) Register(ctx context.Context, path string, id Identity) bool {
	if id.AgentID == "" || id.SessionID == "" || id.PID < 0 {
		return false
	}
	for _, adapter := range s.adapters {
		if adapter.ID() != id.AgentID {
			continue
		}
		sessions, err := adapter.Sessions(ctx)
		if err != nil {
			return false
		}
		for _, session := range sessions {
			if session.ID != id.SessionID || (id.PID != 0 && session.PID != id.PID) {
				continue
			}
			s.mu.Lock()
			s.owners[canonical(path)] = id
			s.mu.Unlock()
			return true
		}
	}
	return false
}

type candidate struct {
	adapter Adapter
	session Session
}

func (s *Service) Send(ctx context.Context, path string) Result {
	result := Result{Command: ReviewCommand(path), Reason: "no_session"}
	if !s.sending.TryLock() {
		result.Reason = "busy"
		return result
	}
	defer s.sending.Unlock()
	s.mu.Lock()
	owner, registered := s.owners[canonical(path)]
	s.mu.Unlock()
	var candidates []candidate
	var chosen *candidate
	for _, adapter := range s.adapters {
		sessions, err := adapter.Sessions(ctx)
		if err != nil {
			if registered && adapter.ID() == owner.AgentID {
				return result
			}
			// An unavailable non-owner must not disable other adapters.
			continue
		}
		for _, session := range sessions {
			if session.ID == "" || !filepath.IsAbs(session.Cwd) {
				continue
			}
			item := candidate{adapter: adapter, session: session}
			candidates = append(candidates, item)
			if registered && adapter.ID() == owner.AgentID && session.ID == owner.SessionID && (owner.PID == 0 || session.PID == owner.PID) {
				selected := item
				chosen = &selected
			}
		}
	}
	if chosen == nil {
		sort.Slice(candidates, func(i, j int) bool {
			a, b := candidates[i], candidates[j]
			ac, bc := canonical(a.session.Cwd), canonical(b.session.Cwd)
			if len(ac) != len(bc) {
				return len(ac) > len(bc)
			}
			if a.adapter.ID() != b.adapter.ID() {
				return a.adapter.ID() < b.adapter.ID()
			}
			return a.session.ID < b.session.ID
		})
		for i := range candidates {
			if contains(candidates[i].session.Cwd, path) {
				chosen = &candidates[i]
				break
			}
		}
	}
	if chosen == nil {
		return result
	}
	result.AgentID, result.SessionName = chosen.adapter.ID(), chosen.session.Name
	if !chosen.session.Ready {
		result.Reason = "busy"
		return result
	}
	err := chosen.adapter.Send(ctx, chosen.session, result.Command)
	switch {
	case err == nil:
		result.Sent, result.Reason = true, ""
	case errors.Is(err, ErrBusy):
		result.Reason = "busy"
	case errors.Is(err, ErrNoSession):
		result.Reason = "no_session"
	case errors.Is(err, ErrNoTerminal):
		result.Reason = "no_terminal"
	default:
		result.Reason = "send_failed"
	}
	return result
}
