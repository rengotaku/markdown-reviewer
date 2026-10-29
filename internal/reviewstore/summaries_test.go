package reviewstore

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSummariesAppendAndCap(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	got, err := ReadSummaries("r", "a.md")
	require.NoError(t, err)
	require.Empty(t, got)

	for i := 0; i < MaxSummaries+3; i++ {
		require.NoError(t, AppendSummary("r", "a.md", Summary{ID: fmt.Sprintf("s-%d", i), Text: "t"}))
	}
	// A repeated id is not stored twice.
	require.NoError(t, AppendSummary("r", "a.md", Summary{ID: fmt.Sprintf("s-%d", MaxSummaries+2)}))
	got, err = ReadSummaries("r", "a.md")
	require.NoError(t, err)
	require.Len(t, got, MaxSummaries)
	require.Equal(t, "s-3", got[0].ID)
	require.Equal(t, fmt.Sprintf("s-%d", MaxSummaries+2), got[len(got)-1].ID)

	dir, err := EntryDir("r", "a.md")
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(dir, summariesFile))
	require.NoError(t, err)
}

func TestSummariesRejectsBadPath(t *testing.T) {
	t.Setenv(configDirEnv, t.TempDir())
	require.Error(t, AppendSummary("r", "../x.md", Summary{ID: "s"}))
}
