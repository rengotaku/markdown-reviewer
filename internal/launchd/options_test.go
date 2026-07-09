package launchd_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/launchd"
)

func TestResolveOptions_Defaults(t *testing.T) {
	t.Setenv("REVIEW_ROOTS", "")
	t.Setenv("REVIEW_ROOT", "/tmp/notes")

	opts, err := launchd.ResolveOptions(launchd.Options{}, true)
	require.NoError(t, err)
	assert.Equal(t, launchd.DefaultLabel, opts.Label)
	assert.Equal(t, launchd.DefaultPort, opts.Port)
	assert.Equal(t, "/tmp/notes", opts.ReviewRoot)
}

func TestResolveOptions_ExplicitValuesWin(t *testing.T) {
	t.Setenv("REVIEW_ROOT", "/tmp/env-root")

	opts, err := launchd.ResolveOptions(launchd.Options{
		Label:      "com.example.custom",
		Port:       "9999",
		ReviewRoot: "/tmp/flag-root",
	}, true)
	require.NoError(t, err)
	assert.Equal(t, "com.example.custom", opts.Label)
	assert.Equal(t, "9999", opts.Port)
	assert.Equal(t, "/tmp/flag-root", opts.ReviewRoot)
}

func TestResolveOptions_ReviewRootsFallsBackToEnv(t *testing.T) {
	t.Setenv("REVIEW_ROOTS", `[{"name":"notes","path":"/tmp/notes"}]`)
	t.Setenv("REVIEW_ROOT", "")

	opts, err := launchd.ResolveOptions(launchd.Options{}, true)
	require.NoError(t, err)
	assert.Equal(t, `[{"name":"notes","path":"/tmp/notes"}]`, opts.ReviewRoots)
}

func TestResolveOptions_MissingRootsErrorsWithUsage(t *testing.T) {
	t.Setenv("REVIEW_ROOTS", "")
	t.Setenv("REVIEW_ROOT", "")

	_, err := launchd.ResolveOptions(launchd.Options{}, true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "REVIEW_ROOTS or REVIEW_ROOT")
	assert.Contains(t, err.Error(), "service install")
}

func TestResolveOptions_RootsNotRequiredForStatus(t *testing.T) {
	t.Setenv("REVIEW_ROOTS", "")
	t.Setenv("REVIEW_ROOT", "")

	opts, err := launchd.ResolveOptions(launchd.Options{}, false)
	require.NoError(t, err)
	assert.Equal(t, launchd.DefaultLabel, opts.Label)
}

func TestResolveOptions_InvalidLabelRejected(t *testing.T) {
	_, err := launchd.ResolveOptions(launchd.Options{Label: "has/slash"}, false)
	require.Error(t, err)

	_, err = launchd.ResolveOptions(launchd.Options{Label: "has space"}, false)
	require.Error(t, err)
}
