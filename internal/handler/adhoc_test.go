package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/handler"
	"markdown-reviewer/internal/reviewstore"
)

// postAdhoc registers path through POST /api/adhoc and returns the response.
func postAdhoc(t *testing.T, h *handler.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	body := strings.NewReader(`{"path":` + quoteJSON(path) + `}`)
	req := httptest.NewRequest(http.MethodPost, "/api/adhoc", body)
	req.Header.Set("Content-Type", "application/json")
	return serve(h, req)
}

func quoteJSON(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// outsideFile writes a .md file in a fresh tmpdir that is deliberately not
// any configured root, and returns its symlink-resolved absolute path.
func outsideFile(t *testing.T, name, content string) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	p := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(p, []byte(content), 0o644))
	return p
}

func TestAdhoc_RegistersOutOfRootFile(t *testing.T) {
	h, _ := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	outside := outsideFile(t, "draft.md", "# draft")

	rec := postAdhoc(t, h, outside)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Root      string `json:"root"`
		Path      string `json:"path"`
		Ephemeral bool   `json:"ephemeral"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, files.AdhocRootName, resp.Root)
	assert.Equal(t, "draft.md", resp.Path)
	assert.True(t, resp.Ephemeral)

	// The file is now readable through the slot.
	read := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/draft.md?root="+files.AdhocRootName, nil))
	require.Equal(t, http.StatusOK, read.Code)
	assert.Contains(t, read.Body.String(), "# draft")
}

func TestAdhoc_SlotExposesOnlyTheRegisteredFile(t *testing.T) {
	h, _ := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	outside := outsideFile(t, "draft.md", "# draft")
	sibling := filepath.Join(filepath.Dir(outside), "secret.md")
	require.NoError(t, os.WriteFile(sibling, []byte("nope"), 0o644))

	require.Equal(t, http.StatusOK, postAdhoc(t, h, outside).Code)

	// The narrowed resolver reports a sibling as a path escape, which the
	// files handler surfaces as 400 like any other rejected path.
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/secret.md?root="+files.AdhocRootName, nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code, "a sibling of the registered file must stay unreachable")
}

func TestAdhoc_ReplacingTheSlotPurgesPreviousComments(t *testing.T) {
	h, _ := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())

	first := outsideFile(t, "first.md", "# first")
	require.Equal(t, http.StatusOK, postAdhoc(t, h, first).Code)
	require.NoError(t, reviewstore.Ingest(files.AdhocRootName, "first.md"))
	require.True(t, reviewstore.HasEntry(files.AdhocRootName, "first.md"))

	second := outsideFile(t, "second.md", "# second")
	require.Equal(t, http.StatusOK, postAdhoc(t, h, second).Code)

	assert.False(t, reviewstore.HasEntry(files.AdhocRootName, "first.md"),
		"taking the slot over for another file must not leave the old sidecar behind")

	// And the previous occupant is no longer reachable.
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/first.md?root="+files.AdhocRootName, nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestAdhoc_ReRegisteringTheSameFileKeepsComments(t *testing.T) {
	h, _ := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())

	outside := outsideFile(t, "draft.md", "# draft")
	require.Equal(t, http.StatusOK, postAdhoc(t, h, outside).Code)
	require.NoError(t, reviewstore.Ingest(files.AdhocRootName, "draft.md"))

	require.Equal(t, http.StatusOK, postAdhoc(t, h, outside).Code)
	assert.True(t, reviewstore.HasEntry(files.AdhocRootName, "draft.md"),
		"reopening the file already in the slot is the same review continuing")
}

func TestAdhoc_PathInsideConfiguredRootAnswersWithThatRoot(t *testing.T) {
	h, root := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	require.NoError(t, os.MkdirAll(filepath.Join(root, "sub"), 0o755))
	inside := filepath.Join(root, "sub", "in.md")
	require.NoError(t, os.WriteFile(inside, []byte("x"), 0o644))

	rec := postAdhoc(t, h, inside)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Root      string `json:"root"`
		Path      string `json:"path"`
		Ephemeral bool   `json:"ephemeral"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "default", resp.Root)
	assert.Equal(t, "sub/in.md", resp.Path)
	assert.False(t, resp.Ephemeral)
}

func TestAdhoc_Rejects(t *testing.T) {
	h, _ := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	dir, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	txt := filepath.Join(dir, "notes.txt")
	require.NoError(t, os.WriteFile(txt, []byte("x"), 0o644))

	cases := map[string]string{
		"empty":     "",
		"relative":  "relative/path.md",
		"missing":   filepath.Join(dir, "nope.md"),
		"directory": dir,
		"not md":    txt,
	}
	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			rec := postAdhoc(t, h, path)
			assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
		})
	}
}

func TestAdhoc_NotConfigured(t *testing.T) {
	h := handler.NewHandler(nil, nil, nil)
	rec := postAdhoc(t, h, "/tmp/x.md")
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestAdhoc_ConfigMarksSlotEphemeral(t *testing.T) {
	h, _ := setupFilesHandler(t)
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	require.Equal(t, http.StatusOK, postAdhoc(t, h, outsideFile(t, "draft.md", "x")).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		ReviewRootName string `json:"review_root_name"`
		ReviewRoots    []struct {
			Name      string `json:"name"`
			Ephemeral bool   `json:"ephemeral"`
		} `json:"review_roots"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Len(t, resp.ReviewRoots, 2)
	assert.Equal(t, "default", resp.ReviewRoots[0].Name)
	assert.False(t, resp.ReviewRoots[0].Ephemeral)
	assert.Equal(t, files.AdhocRootName, resp.ReviewRoots[1].Name)
	assert.True(t, resp.ReviewRoots[1].Ephemeral)
	assert.Equal(t, "default", resp.ReviewRootName, "the slot must never become the default root")
}
