package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/handler"
	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/service"
	"markdown-reviewer/internal/testutil"
)

// setupFilesHandler returns a Handler whose REVIEW_ROOT is a fresh tmpdir.
// The tmpdir path is symlink-resolved (e.g. /var → /private/var on macOS)
// so equality assertions against the resolver's output line up.
func setupFilesHandler(t *testing.T) (*handler.Handler, string) {
	t.Helper()
	root := t.TempDir()
	resolved, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)

	resolver, err := files.NewResolver(resolved)
	require.NoError(t, err)

	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	return handler.NewHandler(svc, resolver), resolved
}

func TestFiles_List_Empty(t *testing.T) {
	h, _ := setupFilesHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Empty(t, resp.Files)
}

func TestFiles_List_RecursesAndFiltersMarkdown(t *testing.T) {
	h, root := setupFilesHandler(t)

	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("a"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "sub"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "sub", "b.md"), []byte("bb"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "skip.txt"), []byte("nope"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	paths := make([]string, 0, len(resp.Files))
	for _, f := range resp.Files {
		paths = append(paths, f.Path)
	}
	sort.Strings(paths)
	assert.Equal(t, []string{"a.md", "sub/b.md"}, paths)
}

func TestFiles_List_NotConfigured(t *testing.T) {
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	h := handler.NewHandler(svc, nil)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files", nil))
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestFiles_Read_Success(t *testing.T) {
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "hello.md"), []byte("# hello"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/hello.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "hello.md", resp.Path)
	assert.Equal(t, "# hello", resp.Content)
}

func TestFiles_Read_Nested(t *testing.T) {
	h, root := setupFilesHandler(t)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "a", "b"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "a", "b", "deep.md"), []byte("d"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/a/b/deep.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "a/b/deep.md", resp.Path)
	assert.Equal(t, "d", resp.Content)
}

func TestFiles_Read_NotFound(t *testing.T) {
	h, _ := setupFilesHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/missing.md", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestFiles_Read_NonMarkdown(t *testing.T) {
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "x.txt"), []byte("nope"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/x.txt", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestFiles_Read_PathTraversal(t *testing.T) {
	h, root := setupFilesHandler(t)
	// drop a sentinel above root so a traversal that "succeeded" would read it
	parent := filepath.Dir(root)
	sentinel := filepath.Join(parent, "secret.md")
	require.NoError(t, os.WriteFile(sentinel, []byte("SECRET"), 0o644))
	t.Cleanup(func() { _ = os.Remove(sentinel) })

	// gin /*path catches everything after /api/files/, so even raw ".."
	// segments survive into the handler.
	for _, p := range []string{
		"/api/files/../secret.md",
		"/api/files/sub/../../secret.md",
	} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		rec := serve(h, req)
		require.Equalf(t, http.StatusBadRequest, rec.Code, "input %q expected 400, got %d (%s)", p, rec.Code, rec.Body.String())
	}
}

func TestFiles_Read_SymlinkOutsideRoot(t *testing.T) {
	h, root := setupFilesHandler(t)
	outside := t.TempDir()
	resolvedOutside, err := filepath.EvalSymlinks(outside)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(resolvedOutside, "secret.md"), []byte("SECRET"), 0o644))
	require.NoError(t, os.Symlink(filepath.Join(resolvedOutside, "secret.md"), filepath.Join(root, "link.md")))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/link.md", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, rec.Body.String(), "SECRET")
}

func TestFiles_Write_CreatesNewFile(t *testing.T) {
	h, root := setupFilesHandler(t)

	body := `{"content": "# new file"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/new.md", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusOK, rec.Code)

	data, err := os.ReadFile(filepath.Join(root, "new.md"))
	require.NoError(t, err)
	assert.Equal(t, "# new file", string(data))
}

func TestFiles_Write_OverwritesAtomically(t *testing.T) {
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o644))

	body := `{"content": "new content"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/doc.md", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusOK, rec.Code)

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "new content", string(data))

	// Atomic-write residue check: no leftover temp file next to the target.
	entries, err := os.ReadDir(root)
	require.NoError(t, err)
	for _, e := range entries {
		assert.NotContains(t, e.Name(), ".tmp-mr-", "tmp file leaked: %s", e.Name())
	}
}

func TestFiles_Write_PathTraversal(t *testing.T) {
	h, root := setupFilesHandler(t)
	parent := filepath.Dir(root)
	sentinel := filepath.Join(parent, "escape.md")
	t.Cleanup(func() { _ = os.Remove(sentinel) })

	body := `{"content": "pwned"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/../escape.md", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)

	_, err := os.Stat(sentinel)
	assert.True(t, os.IsNotExist(err), "escape.md must NOT have been written: %v", err)
}

func TestFiles_Write_SymlinkedParentOutsideRoot(t *testing.T) {
	h, root := setupFilesHandler(t)
	outside := t.TempDir()
	resolvedOutside, err := filepath.EvalSymlinks(outside)
	require.NoError(t, err)
	require.NoError(t, os.Symlink(resolvedOutside, filepath.Join(root, "linkdir")))

	body := `{"content": "pwned"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/linkdir/new.md", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)

	_, err = os.Stat(filepath.Join(resolvedOutside, "new.md"))
	assert.True(t, os.IsNotExist(err), "file must NOT have been written outside root: %v", err)
}

func TestFiles_Write_NonMarkdown(t *testing.T) {
	h, _ := setupFilesHandler(t)

	body := `{"content": "x"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/script.sh", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestFiles_Write_InvalidJSON(t *testing.T) {
	h, _ := setupFilesHandler(t)

	req := httptest.NewRequest(http.MethodPut, "/api/files/x.md", bytes.NewBufferString(`{invalid`))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestFiles_Write_ParentDoesNotExist(t *testing.T) {
	h, _ := setupFilesHandler(t)

	body := `{"content": "x"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/no/such/dir/file.md", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}
