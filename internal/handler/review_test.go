package handler_test

import (
	"bytes"
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

func TestRevisions_SaveAutoIngestsDraftWithoutSnapshot(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# hi\n"), 0o644))

	// A save still auto-ingests (a save is a stronger signal of intent than
	// merely opening the file) but no longer snapshots a revision (#280):
	// autosave writes every few seconds and would evict the diff baseline.
	require.Equal(t, http.StatusOK, putFile(t, h, "# changed\n").Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var read handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&read))
	assert.Equal(t, "review", read.State)

	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Empty(t, resp.Revisions, "saves must not accrue revision history")
}

func TestRevisions_SavesNeverSnapshot(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# v0\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	// Stand in for autosave: many writes in a row, none of which may create a
	// revision. Before #280 this produced one revision per save.
	for _, body := range []string{"# v1\n", "# v2\n", "# v3\n"} {
		require.Equal(t, http.StatusOK, putFile(t, h, body).Code)
	}

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var list handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	assert.Empty(t, list.Revisions)
}

func TestCreateRevision_SnapshotsCurrentContent(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# v0\n"), 0o644))

	// The handoff point: the client saves, then asks for a snapshot of what
	// the AI is about to read. The file on disk carries the AI hint by then,
	// so the snapshot must strip it.
	require.Equal(t, http.StatusOK, putFile(t, h, "# v1\n").Code)
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var created handler.CreateRevisionResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	require.True(t, created.Created)
	require.NotNil(t, created.Revision)
	assert.Equal(t, "r-001", created.Revision.ID)
	assert.Equal(t, "human", created.Revision.Author)

	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md?id=r-001", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var rev handler.RevisionResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&rev))
	assert.Equal(t, "# v1\n", rev.Content, "the snapshot is the content at handoff time, not the pre-save one")
	assert.NotContains(t, rev.Content, "markdown-reviewer", "hint must be stripped from snapshots")
}

func TestCreateRevision_IngestsDraft(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# hi\n"), 0o644))

	// Never saved, never commented: still gets a baseline on handoff.
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/revisions/doc.md?author=someone", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var created handler.CreateRevisionResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	require.True(t, created.Created)
	assert.Equal(t, "someone", created.Revision.Author)

	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/files/doc.md", nil))
	var read handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&read))
	assert.Equal(t, "review", read.State)
}

func TestCreateRevision_DedupesUnchangedHandoff(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# v0\n"), 0o644))

	// Copying the review command twice without editing in between must not
	// move the diff baseline.
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/revisions/doc.md", nil)).Code)
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var second handler.CreateRevisionResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&second))
	assert.False(t, second.Created)
	assert.Nil(t, second.Revision)

	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	var list handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	require.Len(t, list.Revisions, 1)
}

func TestCreateRevision_MissingFile_404(t *testing.T) {
	useTempReviewStore(t)
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/revisions/nope.md", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestRevisions_UnknownID_404(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# x\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md?id=r-999", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}
