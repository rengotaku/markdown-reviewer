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

	// The revision baseline is now established at ingest time (#287
	// follow-up), not by this first read; the comment simply resolves.
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

// TestListComments_ExternalEditBeforeFirstRead_ReanchorsNonUniqueSnippet is
// the #287 follow-up regression: the exact steps that used to swallow a
// silent mis-anchor. Before the ingest handler snapshotted a baseline
// revision, an edit made between ingest and the very first GET had no "old"
// body for SyncExternalEdit's drift detection to diff against — the first
// read adopted the already-edited body as ground truth, so a comment on a
// non-unique snippet whose row had silently moved reported healthy at the
// wrong (new occupant's) line instead of following its own row.
func TestListComments_ExternalEditBeforeFirstRead_ReanchorsNonUniqueSnippet(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	doc := filepath.Join(root, "tasks.md")
	oldBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 1 | A | 未対応 |\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n"
	require.NoError(t, os.WriteFile(doc, []byte(oldBody), 0o644))

	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/tasks.md", nil)).Code)

	created := postInlineComment(t, h, "tasks.md", reviewstore.Anchor{
		HeadingPath: []string{"# Doc"}, Snippet: "未対応", Occurrence: 0,
	})
	require.NotNil(t, created.Anchor)
	assert.Equal(t, "| 1 | A | 未対応 |", created.Anchor.LineFingerprint)
	require.NotNil(t, created.Context)
	assert.Equal(t, [2]int{5, 5}, created.Context.LineRange)

	// Rewrite the file out-of-band — no GET in between — moving A's row (the
	// comment's target) to the end.
	newBody := "# Doc\n\n" +
		"| No | 担当 | 状態 |\n" +
		"|----|------|------|\n" +
		"| 2 | B | 未対応 |\n" +
		"| 3 | C | 未対応 |\n" +
		"| 1 | A | 未対応 |\n"
	require.NoError(t, os.WriteFile(doc, []byte(newBody), 0o644))

	resp := getComments(t, h, "tasks.md")
	require.Len(t, resp.Comments, 1)
	// The bug: this used to report orphan=false at [5,5] — B's row — instead
	// of following A's row to its new location.
	assert.False(t, resp.Comments[0].Orphan, "A's row still exists; must not be orphaned")
	require.NotNil(t, resp.Comments[0].Context)
	assert.Equal(t, [2]int{7, 7}, resp.Comments[0].Context.LineRange, "comment must follow A's row (line 7), not silently stay on B's row (line 5)")
}
