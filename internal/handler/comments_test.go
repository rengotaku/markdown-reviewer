package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/handler"
)

func TestComments_OK(t *testing.T) {
	h, root := setupFilesHandler(t)

	const src = `# Intro

Hello <!-- @comment id="c1" author="k" date="2026-05-20" body="fix this" -->word<!-- /@comment --> tail.

<!-- @comment id="g1" author="k" date="2026-05-20" body="file note" scope="global" -->
`
	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte(src), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/a.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.CommentsResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	assert.Equal(t, "a.md", resp.File)
	assert.Equal(t, "default", resp.Root)
	assert.Equal(t, 2, resp.Summary.Total)
	assert.Equal(t, 1, resp.Summary.ByScope["inline"])
	assert.Equal(t, 1, resp.Summary.ByScope["global"])

	require.Len(t, resp.Comments, 2)
	assert.Equal(t, "c1", resp.Comments[0].ID)
	assert.Equal(t, "word", resp.Comments[0].WrappedText)
	require.NotNil(t, resp.Comments[0].Context)
	assert.Equal(t, []string{"# Intro"}, resp.Comments[0].Context.HeadingPath)

	assert.Equal(t, "g1", resp.Comments[1].ID)
	assert.Equal(t, "global", resp.Comments[1].Scope)
	assert.Nil(t, resp.Comments[1].Context)
}

func TestComments_EmptyFile_ReturnsEmptyArray(t *testing.T) {
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "empty.md"), []byte("just text"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/empty.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	// Verify the JSON serializes `[]`, not `null`, so callers can iterate
	// without a nil check.
	assert.Contains(t, rec.Body.String(), `"comments":[]`)
}

func TestComments_NotFound(t *testing.T) {
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/missing.md", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestComments_NonMarkdown_Rejected(t *testing.T) {
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/script.sh", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestComments_PathTraversal_Rejected(t *testing.T) {
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/../etc/passwd.md", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestComments_MultiRoot(t *testing.T) {
	h, works, rooms := setupMultiRootHandler(t)
	const src = `Hello <!-- @comment id="r1" author="k" date="2026-05-20" body="x" -->w<!-- /@comment -->.`
	require.NoError(t, os.WriteFile(filepath.Join(works, "w.md"), []byte(src), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(rooms, "r.md"), []byte(src), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/r.md?root=rooms", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.CommentsResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "rooms", resp.Root)
	assert.Equal(t, "r.md", resp.File)
}

func TestComments_UnknownRoot_Rejected(t *testing.T) {
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/a.md?root=bogus", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}
