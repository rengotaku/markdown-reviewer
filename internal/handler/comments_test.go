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

// anchor builds a first-occurrence Anchor; every test in this file needs at
// most one match per heading+snippet pair, so Occurrence is always 0
// (an explicit occ param here would be unparam-flagged dead weight).
func anchor(heading, snippet string) *reviewstore.Anchor {
	a := &reviewstore.Anchor{Snippet: snippet, Occurrence: 0}
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
		Scope: "inline", Author: "reviewer", Body: "36 時間では？",
		Anchor: anchor("## トークンの期限", "24 時間"),
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

func TestReplies_EditAndDeleteByIndex(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# 見出し\n\n本文\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	require.Equal(t, http.StatusCreated, postJSON(t, h, http.MethodPost, "/api/comments/doc.md",
		handler.CreateCommentRequest{Scope: "global", Body: "全体"}).Code)
	for _, b := range []string{"r0", "r1", "r2"} {
		require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPost, "/api/replies/doc.md?id=c-001",
			handler.ReplyRequest{Author: "ai", Body: b}).Code)
	}

	// Edit reply at index 1.
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPatch, "/api/replies/doc.md?id=c-001&index=1",
		handler.EditReplyRequest{Body: "r1-edited"}).Code)
	// Delete reply at index 0; the rest shift down.
	rec := serve(h, httptest.NewRequest(http.MethodDelete, "/api/replies/doc.md?id=c-001&index=0", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var updated handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&updated))
	require.Len(t, updated.Replies, 2)
	assert.Equal(t, "r1-edited", updated.Replies[0].Body)
	assert.Equal(t, "r2", updated.Replies[1].Body)

	// Missing / bad index → 400; out-of-range → 404.
	assert.Equal(t, http.StatusBadRequest, postJSON(t, h, http.MethodPatch, "/api/replies/doc.md?id=c-001",
		handler.EditReplyRequest{Body: "x"}).Code)
	assert.Equal(t, http.StatusNotFound, serve(h,
		httptest.NewRequest(http.MethodDelete, "/api/replies/doc.md?id=c-001&index=9", nil)).Code)

	// Resolved comment → reply mutations 409.
	require.Equal(t, http.StatusOK, postJSON(t, h, http.MethodPatch, "/api/comments/doc.md?id=c-001",
		handler.UpdateRequest{Status: "resolved"}).Code)
	assert.Equal(t, http.StatusConflict, postJSON(t, h, http.MethodPatch, "/api/replies/doc.md?id=c-001&index=0",
		handler.EditReplyRequest{Body: "y"}).Code)
	assert.Equal(t, http.StatusConflict, serve(h,
		httptest.NewRequest(http.MethodDelete, "/api/replies/doc.md?id=c-001&index=0", nil)).Code)
}

func TestComments_OrphanWhenSnippetMissing(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte("# Title\n\nbody\n"), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "inline", Body: "x", Anchor: anchor("", "存在しない"),
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	assert.True(t, created.Orphan)
	assert.Nil(t, created.Context)
}

// multiAnchorContent backs the C1-C5 buildCommentJSON cases (#162): headings
// with resolvable lines at 5, 9, and 11 so multi-anchor comments span a real
// line_range.
//
//	1  # 認証
//	2
//	3  ## トークンの期限
//	4
//	5  - アクセストークン: 24 時間
//	6
//	7  ## エラー
//	8
//	9  - 詳細1: 42
//	10
//	11 - 詳細2: 99
const multiAnchorContent = "# 認証\n\n## トークンの期限\n\n- アクセストークン: 24 時間\n\n" +
	"## エラー\n\n- 詳細1: 42\n\n- 詳細2: 99\n"

// C1: Anchor only — line_range stays "[n,n]" and orphan=false, matching the
// pre-#162 single-anchor shape exactly (also covered end-to-end by
// TestComments_CRUDLifecycle).
func TestBuildCommentJSON_C1_SingleAnchorUnchanged(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "inline", Body: "x", Anchor: anchor("## トークンの期限", "24 時間"),
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	require.NotNil(t, created.Context)
	assert.Equal(t, [2]int{5, 5}, created.Context.LineRange)
	assert.False(t, created.Orphan)
}

// C2: Anchor(L5) + Anchors(L9, L11) — line_range becomes [min,max] across all
// resolved anchors.
func TestBuildCommentJSON_C2_MultiAnchorLineRangeSpansAll(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "inline", Body: "x",
		Anchor: anchor("## トークンの期限", "24 時間"),
		Anchors: []reviewstore.Anchor{
			*anchor("## エラー", "詳細1: 42"),
			*anchor("## エラー", "詳細2: 99"),
		},
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	require.NotNil(t, created.Context)
	assert.Equal(t, [2]int{5, 11}, created.Context.LineRange)
	assert.False(t, created.Orphan)
}

// C3: Anchor unresolvable, one of Anchors resolvable — orphan=false, and
// line_range is computed only from the anchor(s) that actually resolved.
func TestBuildCommentJSON_C3_PartiallyResolvedIsNotOrphan(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope:  "inline",
		Body:   "x",
		Anchor: anchor("", "存在しない"),
		Anchors: []reviewstore.Anchor{
			*anchor("## エラー", "詳細1: 42"),
		},
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	require.NotNil(t, created.Context)
	assert.Equal(t, [2]int{9, 9}, created.Context.LineRange)
	assert.False(t, created.Orphan)
}

// C4: every anchor fails to resolve — orphan=true, context nil.
func TestBuildCommentJSON_C4_AllUnresolvedIsOrphan(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope:  "inline",
		Body:   "x",
		Anchor: anchor("", "存在しない1"),
		Anchors: []reviewstore.Anchor{
			*anchor("", "存在しない2"),
		},
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	assert.Nil(t, created.Context)
	assert.True(t, created.Orphan)
}

// C5: global comment (no anchor(s)) — context nil, orphan=false; existing
// behavior must be unaffected by the multi-anchor resolution added for #162.
func TestBuildCommentJSON_C5_GlobalUnaffected(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)

	rec := postJSON(t, h, http.MethodPost, "/api/comments/doc.md", handler.CreateCommentRequest{
		Scope: "global", Body: "全体コメント",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created handler.CommentJSON
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&created))
	assert.Nil(t, created.Context)
	assert.False(t, created.Orphan)
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

// D2: a single-anchor comment's rendered Markdown must not change at all from
// before #162 — same "見出し(L行)" / snippet block as always (backward compat
// with `mr review`/`mr comments`, cmd/mr/format.go).
func TestReviewMarkdown_D2_SingleAnchorUnchanged(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	content := "# 認証\n\n## トークンの期限\n\n- アクセストークン: 24 時間\n"
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(content), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)
	require.Equal(t, http.StatusCreated, postJSON(t, h, http.MethodPost, "/api/comments/doc.md",
		handler.CreateCommentRequest{
			Scope: "inline", Body: "36 時間では？",
			Anchor: anchor("## トークンの期限", "24 時間"),
		}).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/review/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	md := rec.Body.String()
	assert.Contains(t, md, "## c-001 [inline] ## トークンの期限 (L5)\n\n")
	assert.Contains(t, md, "> 対象: 24 時間\n\n")
}

// D1: a multi-anchor comment lists every anchor's "見出し(L行)" label, joined
// the same way as `mr review`/`mr comments` (cmd/mr/format.go).
func TestReviewMarkdown_D1_MultiAnchorListsEveryLocation(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)
	require.Equal(t, http.StatusCreated, postJSON(t, h, http.MethodPost, "/api/comments/doc.md",
		handler.CreateCommentRequest{
			Scope: "inline", Body: "複数行コメント",
			Anchor: anchor("## トークンの期限", "24 時間"),
			Anchors: []reviewstore.Anchor{
				*anchor("## エラー", "詳細1: 42"),
			},
		}).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/review/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	md := rec.Body.String()
	assert.Contains(t, md, "## c-001 [inline] ## トークンの期限 (L5), ## エラー (L9)\n\n")
	assert.Contains(t, md, "> 対象: 24 時間\n\n")
	assert.Contains(t, md, "> 対象: 詳細1: 42\n\n")
}

// D3: when one anchor is orphaned, resolved anchors still show their line
// number and the orphan is called out inline alongside them.
func TestReviewMarkdown_D3_PartialOrphanIsCalledOutInline(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "doc.md"), []byte(multiAnchorContent), 0o644))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/doc.md", nil)).Code)
	require.Equal(t, http.StatusCreated, postJSON(t, h, http.MethodPost, "/api/comments/doc.md",
		handler.CreateCommentRequest{
			Scope: "inline", Body: "一部 orphan",
			Anchor: anchor("## トークンの期限", "24 時間"),
			Anchors: []reviewstore.Anchor{
				*anchor("", "存在しないテキスト"),
			},
		}).Code)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/review/doc.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	md := rec.Body.String()
	assert.Contains(t, md, "## c-001 [inline] ## トークンの期限 (L5), ⚠ orphan（対象テキストが見つかりません）\n\n")
}
