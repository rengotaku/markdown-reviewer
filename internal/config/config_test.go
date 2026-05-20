package config_test

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/config"
)

func TestLoad_Success(t *testing.T) {
	t.Setenv("REVIEW_ROOT", "/tmp/review")

	cfg, err := config.Load(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "/tmp/review", cfg.ReviewRoot)
}

func TestLoad_MissingReviewRoot(t *testing.T) {
	// Anchor the env to a known value first so t.Setenv records the
	// pre-test state; then Unsetenv removes it for the call under test.
	// Setting "" is not enough — envconfig treats an empty-but-present var
	// as "set" and skips the required check.
	t.Setenv("REVIEW_ROOT", "placeholder")
	require.NoError(t, os.Unsetenv("REVIEW_ROOT"))

	_, err := config.Load(context.Background())
	require.Error(t, err)
}
