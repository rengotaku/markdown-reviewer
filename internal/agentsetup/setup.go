// Package agentsetup is the composition root for supported review recipients.
// Adding an AI requires its adapter and one entry here, not changes to routing.
package agentsetup

import (
	"context"
	"log/slog"
	"path/filepath"
	"time"

	"markdown-reviewer/internal/agent"
	"markdown-reviewer/internal/claudeterm"
	"markdown-reviewer/internal/reviewstore"
	"markdown-reviewer/internal/terminal/iterm"
)

type registration struct {
	adapter func() agent.Adapter
	opener  func() (agent.Identity, bool)
}

var registrations = []registration{
	{adapter: func() agent.Adapter { return claudeterm.New(iterm.Writer{}) }, opener: claudeterm.OpenerIdentity},
}

func NewService() *agent.Service {
	adapters := make([]agent.Adapter, 0, len(registrations))
	for _, registered := range registrations {
		adapters = append(adapters, registered.adapter())
	}
	return agent.New(adapters...)
}

// ownersFileName sits at the top of the reviewer storage root, beside the
// per-root sidecar directories.
const ownersFileName = "agent-owners.json"

// NewPersistentService is NewService with `mr open` registrations kept on
// disk, so a server restart doesn't forget which session opened a file
// (#362). Without a storage root it falls back to memory only.
func NewPersistentService() *agent.Service {
	service := NewService()
	base, err := reviewstore.BaseDir()
	if err != nil {
		slog.Warn("agent: session registrations will not survive a restart", "error", err)
		return service
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	service.Persist(ctx, filepath.Join(base, ownersFileName))
	return service
}

func OpenerIdentity() (agent.Identity, bool) {
	for _, registered := range registrations {
		if id, ok := registered.opener(); ok {
			return id, true
		}
	}
	return agent.Identity{}, false
}
