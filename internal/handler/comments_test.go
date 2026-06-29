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

// postJSON issues a request with a JSON body and returns the recorder.
func postJSON(t *testing.T, h *handler.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequest(method, target, &buf)
	req.Header.Set("Content-Type", "application/json")
	return serve(h, req)
}

func anchor(heading, snippet string, occ int) *reviewstore.Anchor {
	a := &reviewstore.Anchor{Snippet: snippet, Occurrence: occ}
	if heading != "" {
		a.HeadingPath = []string{heading}
	}
	return a
}

func TestComments_EmptyWhenNoReview(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# Title\n"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp handler.CommentsResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Empty(t, resp.Comments)
	assert.Equal(t, 0, resp.Summary.Total)
}

func TestComments_CreateRequiresIngest(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# Title\n"), 0o644))

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "global", Body: "draft への global コメント",
	})
	assert.Equal(t, http.StatusConflict, rec.Code) // not ingested
}

func TestComments_CRUDLifecycle(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	content := "# 認証\n\n## トークンの期限\n\n- アクセストークン: 24 時間\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(content), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	// Create an anchored comment.
	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "inline", Author: "kishira", Body: "36 時間では？",
		Anchor: anchor("## トークンの期限", "24 時間", 0),
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	assert.Equal(t, "c-001", created.ID)
	assert.Equal(t, "open", created.Status)
	require.NotNil(t, created.Context, "anchored comment should resolve to a location")
	assert.Equal(t, [2]int{5, 5}, created.Context.LineRange)
	assert.False(t, created.Orphan)

	// Reply + edit the body while still open.
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPost, "/api/replies/doc.md?id=c-001",
		handler.ReplyRequest{Author: "ai", Body: "直しました"}).Code)
	rec = postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-001",
		handler.UpdateRequest{Body: "やっぱり 48 時間では？"})
	require.Equal(t, http.StatusOK, rec.Code)
	var edited handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&edited))
	assert.Equal(t, "やっぱり 48 時間では？", edited.Body)

	// Resolve, then reply / edit must be rejected (409) until reopened.
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-001",
		handler.UpdateRequest{Status: "resolved"}).Code)
	assert.Equal(t, http.StatusConflict, postJSON(t, h, http.MethodPost, "/api/replies/doc.md?id=c-001",
		handler.ReplyRequest{Author: "ai", Body: "追記"}).Code)
	assert.Equal(t, http.StatusConflict, postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-001",
		handler.UpdateRequest{Body: "編集してみる"}).Code)

	// Reopen re-enables editing.
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-001",
		handler.UpdateRequest{Status: "open"}).Code)
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-001",
		handler.UpdateRequest{Body: "再編集 OK"}).Code)

	// List reflects status + reply.
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/doc.md", nil))
	var list handler.CommentsResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	require.Len(t, list.Comments, 1)
	require.Len(t, list.Comments[0].Replies, 1)

	// Delete.
	rec = serve(h, httptest.NewRequest(http.MethodDelete, "/api/comments/doc.md?id=c-001", nil))
	assert.Equal(t, http.StatusNoContent, rec.Code)
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/doc.md", nil))
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&list))
	assert.Empty(t, list.Comments)
}

func TestComments_OrphanWhenSnippetMissing(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# Title\n\nbody\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "inline", Body: "x", Anchor: anchor("", "存在しない", 0),
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	assert.True(t, created.Orphan)
	assert.Nil(t, created.Context)
}

func TestComments_NonMarkdownRejected(t *testing.T) {
	useTempReviewStore(t)
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/comments/notes.txt", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestReviewMarkdown_OpenOnly(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	content := "# 認証\n\n## トークンの期限\n\n- アクセストークン: 24 時間\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(content), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)
	require.Equal(t, http.StatusCreated, postJSON(t, h, http.MethodPost, "/api/comments/doc.md",
		handler.CreateCommentRequest{Scope: "global", Body: "open のまま"}).Code)
	require.Equal(t, http.StatusCreated, postJSON(t, h, http.MethodPost, "/api/comments/doc.md",
		handler.CreateCommentRequest{Scope: "global", Body: "解決済み"}).Code)
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-002",
		handler.UpdateRequest{Status: "resolved"}).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/review/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	md := rec.Body.String()
	assert.Contains(t, md, "open のまま")
	assert.NotContains(t, md, "解決済み")
}
