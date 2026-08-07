package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/handler"
)

func postStatBatch(t *testing.T, h *handler.Handler, targets []handler.StatBatchTarget) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(handler.StatBatchRequest{Files: targets})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/stat/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return serve(h, req)
}

func decodeStatBatch(t *testing.T, rec *httptest.ResponseRecorder) handler.StatBatchResponse {
	t.Helper()
	var resp handler.StatBatchResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	return resp
}

func TestStatBatch_ReturnsOneResultPerRequestedFile(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("a"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "b.md"), []byte("b"), 0o644))

	rec := postStatBatch(t, h, []handler.StatBatchTarget{
		{Path: "a.md"},
		{Path: "b.md"},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 2)
	assert.Equal(t, "a.md", resp.Results[0].Path)
	assert.Equal(t, "b.md", resp.Results[1].Path)
	for _, r := range resp.Results {
		assert.Empty(t, r.Error)
		// Not ingested, so draft with no open comments.
		assert.Equal(t, "draft", r.State)
		assert.False(t, r.HasOpenComments)
	}
}

// The whole point of the endpoint: one stale tab must not cost the caller the
// rest of the sweep, so failures are per item and the status stays 200.
func TestStatBatch_MissingFileFailsOnlyItsOwnEntry(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "present.md"), []byte("x"), 0o644))

	rec := postStatBatch(t, h, []handler.StatBatchTarget{
		{Path: "gone.md"},
		{Path: "present.md"},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 2)
	assert.Equal(t, handler.StatBatchErrNotFound, resp.Results[0].Error)
	assert.Empty(t, resp.Results[1].Error)
	assert.Equal(t, "present.md", resp.Results[1].Path)
}

func TestStatBatch_RejectsNonMarkdownAndEmptyPathPerItem(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "ok.md"), []byte("x"), 0o644))

	rec := postStatBatch(t, h, []handler.StatBatchTarget{
		{Path: "foo.txt"},
		{Path: ""},
		{Path: "ok.md"},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 3)
	assert.Equal(t, handler.StatBatchErrBadRequest, resp.Results[0].Error)
	assert.Equal(t, handler.StatBatchErrBadRequest, resp.Results[1].Error)
	assert.Empty(t, resp.Results[2].Error)
}

func TestStatBatch_UnknownRootFailsOnlyItsOwnEntry(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "ok.md"), []byte("x"), 0o644))

	rec := postStatBatch(t, h, []handler.StatBatchTarget{
		{Root: "nope", Path: "ok.md"},
		{Path: "ok.md"},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 2)
	assert.Equal(t, handler.StatBatchErrBadRequest, resp.Results[0].Error)
	assert.Empty(t, resp.Results[1].Error)
}

func TestStatBatch_PathTraversalIsRejectedPerItem(t *testing.T) {
	useTempReviewStore(t)
	h, _ := setupFilesHandler(t)

	rec := postStatBatch(t, h, []handler.StatBatchTarget{
		{Path: "../outside.md"},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 1)
	assert.Contains(t,
		[]string{handler.StatBatchErrBadRequest, handler.StatBatchErrNotFound},
		resp.Results[0].Error)
}

// Results echo the requested root so a multi-root caller can key on
// (root, path) without depending on ordering.
func TestStatBatch_EchoesRootAcrossRoots(t *testing.T) {
	useTempReviewStore(t)
	h, works, rooms := setupMultiRootHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(works, "w.md"), []byte("w"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(rooms, "r.md"), []byte("r"), 0o644))

	rec := postStatBatch(t, h, []handler.StatBatchTarget{
		{Root: "rooms", Path: "r.md"},
		{Root: "works", Path: "w.md"},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 2)
	assert.Equal(t, "rooms", resp.Results[0].Root)
	assert.Equal(t, "r.md", resp.Results[0].Path)
	assert.Empty(t, resp.Results[0].Error)
	assert.Equal(t, "works", resp.Results[1].Root)
	assert.Equal(t, "w.md", resp.Results[1].Path)
	assert.Empty(t, resp.Results[1].Error)
}

func TestStatBatch_ReportsOpenCommentsForIngestedFile(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# doc\n\nbody\n"), 0o644))
	require.Equal(t, http.StatusOK,
		serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)
	require.Equal(t, http.StatusCreated,
		postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
			Scope: "global", Body: "please fix",
		}).Code)

	rec := postStatBatch(t, h, []handler.StatBatchTarget{{Path: "doc.md"}})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeStatBatch(t, rec)
	require.Len(t, resp.Results, 1)
	assert.Equal(t, "review", resp.Results[0].State)
	assert.True(t, resp.Results[0].HasOpenComments)
}

// The tab count is user-controlled, so the server bounds the work per request
// instead of trusting the client to split.
func TestStatBatch_RejectsOversizedBatch(t *testing.T) {
	h, _ := setupFilesHandler(t)

	targets := make([]handler.StatBatchTarget, handler.MaxStatBatchSize+1)
	for i := range targets {
		targets[i] = handler.StatBatchTarget{Path: fmt.Sprintf("f%d.md", i)}
	}

	rec := postStatBatch(t, h, targets)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestStatBatch_AcceptsBatchAtTheLimit(t *testing.T) {
	useTempReviewStore(t)
	h, _ := setupFilesHandler(t)

	targets := make([]handler.StatBatchTarget, handler.MaxStatBatchSize)
	for i := range targets {
		targets[i] = handler.StatBatchTarget{Path: fmt.Sprintf("f%d.md", i)}
	}

	rec := postStatBatch(t, h, targets)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Len(t, decodeStatBatch(t, rec).Results, handler.MaxStatBatchSize)
}

func TestStatBatch_EmptyRequestReturnsEmptyResults(t *testing.T) {
	h, _ := setupFilesHandler(t)

	rec := postStatBatch(t, h, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, decodeStatBatch(t, rec).Results)
}

func TestStatBatch_RejectsMalformedBody(t *testing.T) {
	h, _ := setupFilesHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/stat/batch", bytes.NewReader([]byte("{")))
	req.Header.Set("Content-Type", "application/json")
	assert.Equal(t, http.StatusBadRequest, serve(h, req).Code)
}

// The single-file GET must keep working — it is the only endpoint that
// returns sha, which the external-edit detection depends on.
func TestStatBatch_DoesNotShadowSingleFileStat(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "batch.md"), []byte("x"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/batch.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "batch.md", resp.Path)
	assert.NotEmpty(t, resp.Sha)
}
