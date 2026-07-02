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
	"markdown-reviewer/internal/reviewstore"
)

// postInlineComment creates an inline comment through the API, mirroring what
// the frontend sends.
func postInlineComment(t *testing.T, h *handler.Handler, path string, a reviewstore.Anchor) handler.CommentJSON {
	t.Helper()
	body, err := json.Marshal(handler.CreateCommentRequest{
		Scope: "inline", Author: "reviewer", Body: "fix this", Anchor: &a,
	})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/comments/"+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	return created
}

func getComments(t *testing.T, h *handler.Handler, path string) handler.CommentsResponse {
	t.Helper()
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/"+path, nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp handler.CommentsResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	return resp
}

// TestListComments_OutOfBandEdit_Reanchors reproduces the #61 workflow: the AI
// edits the canonical .md directly on disk (no PUT), then reads comments. The
// comment must follow its rewritten line instead of orphaning.
func TestListComments_OutOfBandEdit_Reanchors(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	doc := filepath.Join(root, "doc.md")
	oldBody := "# Title\n\nThe quick brown fox jumps.\n\nAnother paragraph.\n"
	require.NoError(t, os.WriteFile(doc, []byte(oldBody), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	postInlineComment(t, h, "doc.md", reviewstore.Anchor{
		HeadingPath: []string{"# Title"},
		Snippet:     "quick brown fox jumps",
		Occurrence:  0,
	})

	// First read establishes the revision baseline; the comment resolves.
	resp := getComments(t, h, "doc.md")
	require.Len(t, resp.Comments, 1)
	require.False(t, resp.Comments[0].Orphan)
	require.NotNil(t, resp.Comments[0].Context)
	assert.Equal(t, [2]int{3, 3}, resp.Comments[0].Context.LineRange)

	// Out-of-band edit: rewrite the commented line directly on disk, the way
	// an AI file tool does (no PUT /api/files involved).
	newBody := "# Title\n\nThe quick RED fox leaps high.\n\nAnother paragraph.\n"
	require.NoError(t, os.WriteFile(doc, []byte(newBody), 0o644))

	resp = getComments(t, h, "doc.md")
	require.Len(t, resp.Comments, 1)
	assert.False(t, resp.Comments[0].Orphan, "comment must be re-anchored, not orphaned")
	require.NotNil(t, resp.Comments[0].Context)
	assert.Equal(t, [2]int{3, 3}, resp.Comments[0].Context.LineRange)

	// The external content was snapshotted as a revision.
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/revisions/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var revs handler.RevisionListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&revs))
	require.Len(t, revs.Revisions, 2)
	assert.Equal(t, "external", revs.Revisions[0].Author)
}
