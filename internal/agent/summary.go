package agent

import (
	"context"
	"fmt"
	"time"
)

// Summarizer is an optional Adapter capability: it returns the text of the
// session's first final reply that finished after since. ok=false (nil error)
// means there is no such reply yet, or the transcript cannot be found.
type Summarizer interface {
	Summary(ctx context.Context, session Session, since time.Time) (text string, at time.Time, ok bool, err error)
}

// Summary is one finished piece of work: what was sent, when, and the AI's
// final reply text taken verbatim from the session transcript.
type Summary struct {
	ID          string    `json:"id"`
	SentAt      time.Time `json:"sent_at"`
	DoneAt      time.Time `json:"done_at"`
	AgentID     string    `json:"agent_id"`
	SessionName string    `json:"session_name"`
	Text        string    `json:"text"`
}

// pending remembers a successful send until its summary has been collected.
type pending struct {
	sentAt      time.Time
	agentID     string
	sessionID   string
	sessionName string
}

func (s *Service) remember(path string, chosen *candidate, sentAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pending == nil {
		s.pending = make(map[string]pending)
	}
	s.pending[canonical(path)] = pending{
		agentID: chosen.adapter.ID(), sessionID: chosen.session.ID,
		sessionName: chosen.session.Name, sentAt: sentAt,
	}
}

// TakeSummary returns the summary of the last send for path once the target
// session is ready again and its transcript has a final reply newer than the
// send. The pending entry is dropped only when a summary is returned.
func (s *Service) TakeSummary(ctx context.Context, path string) (Summary, bool) {
	key := canonical(path)
	s.mu.Lock()
	p, ok := s.pending[key]
	s.mu.Unlock()
	if !ok {
		return Summary{}, false
	}
	for _, adapter := range s.adapters {
		summarizer, can := adapter.(Summarizer)
		if adapter.ID() != p.agentID || !can {
			continue
		}
		sessions, err := adapter.Sessions(ctx)
		if err != nil {
			return Summary{}, false
		}
		for _, session := range sessions {
			if session.ID != p.sessionID || !session.Ready {
				continue
			}
			text, at, found, err := summarizer.Summary(ctx, session, p.sentAt)
			if err != nil || !found {
				return Summary{}, false
			}
			s.mu.Lock()
			// A newer send may have replaced the entry meanwhile.
			if cur, still := s.pending[key]; still && cur == p {
				delete(s.pending, key)
			}
			s.mu.Unlock()
			return Summary{
				ID:     fmt.Sprintf("s-%d", at.UnixMilli()),
				SentAt: p.sentAt, DoneAt: at, AgentID: p.agentID,
				SessionName: p.sessionName, Text: text,
			}, true
		}
	}
	return Summary{}, false
}
