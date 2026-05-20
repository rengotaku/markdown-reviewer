// Package config loads runtime configuration from environment variables.
//
// Separating env loading into its own package lets handlers and the safe-path
// resolver depend on a plain string rather than on os.Getenv directly, which
// keeps them trivially unit-testable.
package config

import (
	"context"
	"fmt"

	"github.com/sethvargo/go-envconfig"
)

// Config holds runtime configuration for the markdown reviewer.
type Config struct {
	// ReviewRoot is the directory under which the files API browses, reads,
	// and writes .md files. Required.
	ReviewRoot string `env:"REVIEW_ROOT, required"`
}

// Load reads Config from the process environment.
func Load(ctx context.Context) (*Config, error) {
	var c Config
	if err := envconfig.Process(ctx, &c); err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}
	return &c, nil
}
