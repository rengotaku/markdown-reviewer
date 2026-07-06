package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/handler"
)

// useTempReviewStore points reviewstore at a fresh temp dir for the test so
// real ~/.config is never touched. Mirrors reviewstore's REVIEWER_CONFIG_DIR
// override (the env name is part of its public contract).
func useTempReviewStore(t *testing.T) {
	t.Helper()
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
}

func putFile(t *testing.T, h *handler.Handler, content string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(handler.FileWriteRequest{Content: content})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPut, "/api/files/doc.md", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return serve(h, req)
}

func TestIngest_TransitionsToReview(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# hello\n"), 0o644))

	// Before ingest: draft.
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var stat handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&stat))
	assert.Equal(t, "draft", stat.State)

	// Ingest.
	rec = serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var ing handler.IngestResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&ing))
	assert.Equal(t, "review", ing.State)

	// After ingest: review (idempotent on a second call).
	rec = serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/files/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var read handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&read))
	assert.Equal(t, "review", read.State)
}

func TestIngest_MissingFile_404(t *testing.T) {
	useTempReviewStore(t)
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/nope.md", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestRevisions_SaveAutoIngestsDraft(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# hi\n"), 0o644))

	// Saving a draft file now auto-ingests it (a save is a stronger signal of
	// intent than merely opening), so the pre-overwrite content is snapshotted
	// as the first revision.
	require.Equal(t, http.StatusOK, putFile(t, h, "# changed\n").Code)

	// The file transitioned draft -> review.
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var read handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&read))
	assert.Equal(t, "review", read.State)

	// History holds the pre-overwrite content.
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.Len(t, resp.Revisions, 1)
}

func TestRevisions_SnapshotsOnWrite(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# v0\n"), 0o644))

	// Ingest so subsequent writes are snapshotted.
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	// First write snapshots the on-disk "# v0" (pre-overwrite).
	require.Equal(t, http.StatusOK, putFile(t, h, "# v1\n").Code)
	// Second write snapshots "# v1" (which now carries an AI hint on disk —
	// the snapshot must strip it).
	require.Equal(t, http.StatusOK, putFile(t, h, "# v2\n").Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var list handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	require.Len(t, list.Revisions, 2)
	// Newest first.
	assert.Equal(t, "r-002", list.Revisions[0].ID)
	assert.Equal(t, "r-001", list.Revisions[1].ID)

	// Fetch the newest revision's content — it must be the hint-stripped "# v1".
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md?id=r-002", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var rev handler.RevisionResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&rev))
	assert.Equal(t, "# v1\n", rev.Content)
	assert.NotContains(t, rev.Content, "markdown-reviewer", "hint must be stripped from snapshots")
}

func TestRevisions_UnknownID_404(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# x\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md?id=r-999", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestRevisions_DedupeUnchangedSaves(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# v0\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	// Two identical saves of the same new content: the second save's
	// pre-overwrite snapshot equals the first's, so it dedupes.
	require.Equal(t, http.StatusOK, putFile(t, h, "# same\n").Code)
	require.Equal(t, http.StatusOK, putFile(t, h, "# same\n").Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	var list handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	// r-001 = "# v0" snapshot; the "# same" snapshot only lands once.
	require.Len(t, list.Revisions, 2)
	require.False(t, strings.HasPrefix(list.Revisions[0].ID, "r-003"))
}
