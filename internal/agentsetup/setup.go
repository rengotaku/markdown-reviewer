// Package agentsetup is the composition root for supported review recipients.
// Adding an AI requires its adapter and one entry here, not changes to routing.
package agentsetup

import (
	"markdown-reviewer/internal/agent"
	"markdown-reviewer/internal/claudeterm"
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

func OpenerIdentity() (agent.Identity, bool) {
	for _, registered := range registrations {
		if id, ok := registered.opener(); ok {
			return id, true
		}
	}
	return agent.Identity{}, false
}
