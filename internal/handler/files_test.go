package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/handler"
	"markdown-reviewer/internal/repository"
	"markdown-reviewer/internal/service"
	"markdown-reviewer/internal/testutil"
)

// setupMultiRootHandler returns a Handler configured with two named roots,
// returning the resolved tmpdir paths so tests can write fixture files to
// each one. Roots are declared "works" then "rooms" so "works" is the
// default (returned when ?root= is omitted).
func setupMultiRootHandler(t *testing.T) (h *handler.Handler, works, rooms string) {
	t.Helper()
	a := t.TempDir()
	worksResolved, err := filepath.EvalSymlinks(a)
	require.NoError(t, err)
	b := t.TempDir()
	roomsResolved, err := filepath.EvalSymlinks(b)
	require.NoError(t, err)

	roots, err := files.NewRoots([]files.RootSpec{
		{Name: "works", Path: worksResolved},
		{Name: "rooms", Path: roomsResolved},
	})
	require.NoError(t, err)

	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	return handler.NewHandler(svc, roots, nil), worksResolved, roomsResolved
}

// setupFilesHandler returns a Handler with a single configured root at a
// fresh tmpdir. The tmpdir path is symlink-resolved (e.g. /var → /private/var
// on macOS) so equality assertions against the resolver's output line up.
func setupFilesHandler(t *testing.T) (*handler.Handler, string) {
	t.Helper()
	root := t.TempDir()
	resolved, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)

	roots, err := files.NewRoots([]files.RootSpec{{Name: "default", Path: resolved}})
	require.NoError(t, err)

	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	return handler.NewHandler(svc, roots, nil), resolved
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
	h := handler.NewHandler(svc, nil, nil)

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
	// Server force-injects an AI hint comment; assert the user content
	// survives intact at the tail.
	assert.Contains(t, string(data), "<!-- markdown-reviewer")
	assert.True(t, strings.HasSuffix(string(data), "# new file"))
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
	assert.True(t, strings.HasSuffix(string(data), "new content"))

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

// --- ListDir tests --------------------------------------------------------

// listDir is a small helper that hits GET /api/dirs?path=<rel> and decodes
// the response. It keeps the table-driven tests below tidy.
//
// Modified is cleared on each entry so positional assertions can use literal
// DirEntry{...} without having to invent or freeze mtime values. Tests that
// care about the timestamp value (or the mtime-desc ordering) check it
// explicitly.
func listDir(t *testing.T, h *handler.Handler, rel string) (*httptest.ResponseRecorder, handler.DirListResponse) {
	t.Helper()
	url := "/api/dirs"
	if rel != "" {
		url += "?path=" + rel
	}
	rec := serve(h, httptest.NewRequest(http.MethodGet, url, nil))
	var resp handler.DirListResponse
	if rec.Code == http.StatusOK {
		require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
		for i := range resp.Entries {
			resp.Entries[i].Modified = ""
		}
	}
	return rec, resp
}

func TestListDir_NotConfigured(t *testing.T) {
	t.Parallel()
	repo := repository.NewUserRepository(testutil.NewTestDB(t))
	svc := service.NewUserService(repo)
	h := handler.NewHandler(svc, nil, nil)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/dirs", nil))
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestListDir_RootEmpty(t *testing.T) {
	t.Parallel()
	h, _ := setupFilesHandler(t)

	rec, resp := listDir(t, h, "")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, resp.Entries)
}

func TestListDir_RootListsDirsAndMarkdownOnly(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	require.NoError(t, os.MkdirAll(filepath.Join(root, "alpha"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "beta"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "readme.md"), []byte("r"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "zeta.md"), []byte("z"), 0o644))
	// Non-markdown file: must be filtered out.
	require.NoError(t, os.WriteFile(filepath.Join(root, "notes.txt"), []byte("n"), 0o644))

	rec, resp := listDir(t, h, "")
	require.Equal(t, http.StatusOK, rec.Code)

	// dirs come before files; within each group with identical (second-
	// precision) mtimes the name tie-breaker (ascending) is what determines
	// the order. Distinct-mtime ordering is verified separately in
	// TestListDir_SortedByModifiedTimeDesc.
	require.Len(t, resp.Entries, 4)
	assert.Equal(t, handler.DirEntry{Name: "alpha", Path: "alpha", Type: "dir"}, resp.Entries[0])
	assert.Equal(t, handler.DirEntry{Name: "beta", Path: "beta", Type: "dir"}, resp.Entries[1])
	assert.Equal(t, handler.DirEntry{Name: "readme.md", Path: "readme.md", Type: "file"}, resp.Entries[2])
	assert.Equal(t, handler.DirEntry{Name: "zeta.md", Path: "zeta.md", Type: "file"}, resp.Entries[3])
}

func TestListDir_SortedByModifiedTimeDesc(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	require.NoError(t, os.MkdirAll(filepath.Join(root, "alpha"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "beta"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "readme.md"), []byte("r"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "zeta.md"), []byte("z"), 0o644))

	// Stamp explicit mtimes so the sort behavior is deterministic regardless
	// of the underlying filesystem's mtime resolution. The "newest" entry in
	// each group (mtime-desc) should win, with name asc as the tie-breaker.
	now := time.Now()
	// alpha older than beta → beta should come first.
	require.NoError(t, os.Chtimes(filepath.Join(root, "alpha"), now, now.Add(-2*time.Hour)))
	require.NoError(t, os.Chtimes(filepath.Join(root, "beta"), now, now.Add(-1*time.Hour)))
	// zeta.md newer than readme.md → zeta.md should come first within files.
	require.NoError(t, os.Chtimes(filepath.Join(root, "readme.md"), now, now.Add(-2*time.Hour)))
	require.NoError(t, os.Chtimes(filepath.Join(root, "zeta.md"), now, now.Add(-1*time.Hour)))

	rec, resp := listDir(t, h, "")
	require.Equal(t, http.StatusOK, rec.Code)

	require.Len(t, resp.Entries, 4)
	// dirs first (beta newer than alpha), then files (zeta.md newer than readme.md).
	assert.Equal(t, "beta", resp.Entries[0].Name)
	assert.Equal(t, "alpha", resp.Entries[1].Name)
	assert.Equal(t, "zeta.md", resp.Entries[2].Name)
	assert.Equal(t, "readme.md", resp.Entries[3].Name)
}

func TestListDir_SkipsDotfilesAndNoiseDirs(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	// dotfiles + dotdirs — must be filtered.
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".git"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, ".env"), []byte("x"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, ".hidden.md"), []byte("x"), 0o644))

	// every name in noiseDirs — must be filtered.
	for _, name := range []string{"node_modules", "vendor", "tmp", "bin", "dist", "build", "target"} {
		require.NoError(t, os.MkdirAll(filepath.Join(root, name), 0o755))
	}

	// One legitimate entry per kind to confirm the survivor set.
	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "intro.md"), []byte("i"), 0o644))

	rec, resp := listDir(t, h, "")
	require.Equal(t, http.StatusOK, rec.Code)

	require.Len(t, resp.Entries, 2)
	assert.Equal(t, handler.DirEntry{Name: "docs", Path: "docs", Type: "dir"}, resp.Entries[0])
	assert.Equal(t, handler.DirEntry{Name: "intro.md", Path: "intro.md", Type: "file"}, resp.Entries[1])
}

func TestListDir_SubdirectoryPath(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs", "nested"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "a.md"), []byte("a"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "b.md"), []byte("b"), 0o644))
	// Sibling outside the queried subtree must not leak in.
	require.NoError(t, os.WriteFile(filepath.Join(root, "outside.md"), []byte("o"), 0o644))

	rec, resp := listDir(t, h, "docs")
	require.Equal(t, http.StatusOK, rec.Code)

	require.Len(t, resp.Entries, 3)
	assert.Equal(t, handler.DirEntry{Name: "nested", Path: "docs/nested", Type: "dir"}, resp.Entries[0])
	assert.Equal(t, handler.DirEntry{Name: "a.md", Path: "docs/a.md", Type: "file"}, resp.Entries[1])
	assert.Equal(t, handler.DirEntry{Name: "b.md", Path: "docs/b.md", Type: "file"}, resp.Entries[2])
}

func TestListDir_PathStripsSlashesAndDotEqualsRoot(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("a"), 0o644))

	// Each of these should be treated as "root" by ListDir:
	//   - "."     → the rel == "." short-circuit
	//   - "/"     → leading & trailing slash both stripped → empty
	for _, p := range []string{".", "/"} {
		rec, resp := listDir(t, h, p)
		require.Equalf(t, http.StatusOK, rec.Code, "path=%q expected 200, got %d (%s)", p, rec.Code, rec.Body.String())
		require.Lenf(t, resp.Entries, 1, "path=%q", p)
		assert.Equal(t, handler.DirEntry{Name: "a.md", Path: "a.md", Type: "file"}, resp.Entries[0])
	}
}

func TestListDir_SubdirectoryPathWithSlashes(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	require.NoError(t, os.MkdirAll(filepath.Join(root, "docs"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "docs", "a.md"), []byte("a"), 0o644))

	// Leading + trailing slashes are stripped before resolving.
	rec, resp := listDir(t, h, "/docs/")
	require.Equal(t, http.StatusOK, rec.Code)
	require.Len(t, resp.Entries, 1)
	assert.Equal(t, handler.DirEntry{Name: "a.md", Path: "docs/a.md", Type: "file"}, resp.Entries[0])
}

func TestListDir_NotFound(t *testing.T) {
	t.Parallel()
	h, _ := setupFilesHandler(t)

	rec, _ := listDir(t, h, "nope")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestListDir_PathTraversal(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	parent := filepath.Dir(root)
	sentinel := filepath.Join(parent, "secrets")
	require.NoError(t, os.MkdirAll(sentinel, 0o755))
	t.Cleanup(func() { _ = os.RemoveAll(sentinel) })

	for _, p := range []string{"../secrets", "sub/../../secrets"} {
		rec, _ := listDir(t, h, p)
		require.Equalf(t, http.StatusBadRequest, rec.Code, "input %q expected 400, got %d (%s)", p, rec.Code, rec.Body.String())
	}
}

func TestListDir_NotADirectory(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "file.md"), []byte("f"), 0o644))

	rec, _ := listDir(t, h, "file.md")
	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "path is not a directory")
}

// Resolve() returns os.ErrNotExist when a non-existing target's parent is
// also missing — covers the ErrNotExist branch of the Resolve-err switch.
func TestListDir_ResolveNotExistParent(t *testing.T) {
	t.Parallel()
	h, _ := setupFilesHandler(t)

	rec, _ := listDir(t, h, "does/not/exist")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// Resolve() returns a wrapped non-traversal/non-NotExist error when
// EvalSymlinks fails for an unexpected reason — here, walking *through*
// a regular file ("foo.md/bar.md") yields ENOTDIR which hits the default
// 500 branch.
func TestListDir_ResolveInternalError(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "foo.md"), []byte("f"), 0o644))

	rec, _ := listDir(t, h, "foo.md/bar")
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

// Covers the os.ReadDir failure branch: Stat() reports the path as a dir
// (which it is) but ReadDir fails because we lack read permission.
//
// Skipped on Windows (POSIX perms don't apply) and for root (uid 0 bypasses
// the read check entirely on most Unixes).
func TestListDir_ReadDirError(t *testing.T) {
	t.Parallel()
	if os.Geteuid() == 0 {
		t.Skip("root bypasses permission checks; cannot induce EACCES")
	}
	h, root := setupFilesHandler(t)

	unreadable := filepath.Join(root, "noread")
	require.NoError(t, os.MkdirAll(unreadable, 0o755))
	// Strip read permission but keep execute so Stat() still succeeds.
	require.NoError(t, os.Chmod(unreadable, 0o111))
	t.Cleanup(func() { _ = os.Chmod(unreadable, 0o755) })

	rec, _ := listDir(t, h, "noread")
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

// --- StatFile tests -------------------------------------------------------

func TestStatFile_ReturnsModifiedTimestamp(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	require.NoError(t, os.WriteFile(filepath.Join(root, "x.md"), []byte("x"), 0o644))
	// Stamp a known mtime so we can assert the exact RFC3339 value.
	mtime := time.Date(2026, 4, 1, 12, 30, 0, 0, time.UTC)
	require.NoError(t, os.Chtimes(filepath.Join(root, "x.md"), mtime, mtime))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/x.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "x.md", resp.Path)
	assert.Equal(t, mtime.Format(time.RFC3339), resp.Modified)
	assert.Equal(t, files.Sha256Hex([]byte("x")), resp.Sha)
}

func TestStatFile_NotFound(t *testing.T) {
	t.Parallel()
	h, _ := setupFilesHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/missing.md", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestStatFile_RejectsNonMarkdown(t *testing.T) {
	t.Parallel()
	h, _ := setupFilesHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/foo.txt", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestStatFile_HasOpenComments_NotIngested(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "draft.md"), []byte("# draft\n"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/draft.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "draft", resp.State)
	assert.False(t, resp.HasOpenComments)
}

func TestStatFile_HasOpenComments_AllResolved(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "done.md"), []byte("# done\n"), 0o644))

	// Ingest the file.
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/done.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	// Add a comment via the comments API and resolve it via the patch endpoint.
	body := `{"scope":"global","body":"check this"}`
	req := httptest.NewRequest(http.MethodPost, "/api/comments/done.md", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec = serve(h, req)
	require.Equal(t, http.StatusCreated, rec.Code)
	var cc struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&cc))

	// Resolve.
	patchBody := `{"status":"resolved"}`
	patchReq := httptest.NewRequest(http.MethodPatch, "/api/comments/done.md?id="+cc.ID, strings.NewReader(patchBody))
	patchReq.Header.Set("Content-Type", "application/json")
	rec = serve(h, patchReq)
	require.Equal(t, http.StatusOK, rec.Code)

	// HasOpenComments must be false now.
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/done.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "review", resp.State)
	assert.False(t, resp.HasOpenComments)
}

func TestStatFile_HasOpenComments_WithOpenComment(t *testing.T) {
	useTempReviewStore(t)
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "open.md"), []byte("# open\n"), 0o644))

	// Ingest.
	rec := serve(h, httptest.NewRequest(http.MethodPost, "/api/ingest/open.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	// Add an open comment.
	body := `{"scope":"global","body":"still open"}`
	req := httptest.NewRequest(http.MethodPost, "/api/comments/open.md", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec = serve(h, req)
	require.Equal(t, http.StatusCreated, rec.Code)

	// HasOpenComments must be true.
	rec = serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/open.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var resp handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "review", resp.State)
	assert.True(t, resp.HasOpenComments)
}

// --- multi-root selection -------------------------------------------------

func TestMultiRoot_DefaultsToFirstRoot(t *testing.T) {
	t.Parallel()
	h, works, rooms := setupMultiRootHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(works, "in-works.md"), []byte("w"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(rooms, "in-rooms.md"), []byte("r"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/dirs", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.DirListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "works", resp.Root)
	require.Len(t, resp.Entries, 1)
	assert.Equal(t, "in-works.md", resp.Entries[0].Name)
}

func TestMultiRoot_SelectorRoutesToNamedRoot(t *testing.T) {
	t.Parallel()
	h, works, rooms := setupMultiRootHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(works, "in-works.md"), []byte("w"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(rooms, "in-rooms.md"), []byte("r"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/dirs?root=rooms", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.DirListResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "rooms", resp.Root)
	require.Len(t, resp.Entries, 1)
	assert.Equal(t, "in-rooms.md", resp.Entries[0].Name)
}

func TestMultiRoot_UnknownRootIs400(t *testing.T) {
	t.Parallel()
	h, _, _ := setupMultiRootHandler(t)

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/dirs?root=missing", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestMultiRoot_ReadFromSecondRoot(t *testing.T) {
	t.Parallel()
	h, _, rooms := setupMultiRootHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(rooms, "report.md"), []byte("# report"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/report.md?root=rooms", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, "rooms", resp.Root)
	assert.Equal(t, "report.md", resp.Path)
	assert.Equal(t, "# report", resp.Content)
}

func TestMultiRoot_WriteToSecondRoot(t *testing.T) {
	t.Parallel()
	h, _, rooms := setupMultiRootHandler(t)

	body := `{"content": "# new"}`
	req := httptest.NewRequest(http.MethodPut, "/api/files/new.md?root=rooms", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := serve(h, req)
	require.Equal(t, http.StatusOK, rec.Code)

	data, err := os.ReadFile(filepath.Join(rooms, "new.md"))
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(string(data), "# new"))
}

// A path containing ".." into the *sibling* root must still be rejected:
// safety is enforced per-root, so the resolver for "works" has no way to
// reach files configured under "rooms".
func TestMultiRoot_CannotEscapeIntoSiblingRoot(t *testing.T) {
	t.Parallel()
	h, _, rooms := setupMultiRootHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(rooms, "secret.md"), []byte("SECRET"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/../"+filepath.Base(rooms)+"/secret.md?root=works", nil))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.NotContains(t, rec.Body.String(), "SECRET")
}

// --- sha (issue #119) ------------------------------------------------------

// putFileWithIfMatch issues PUT /api/files/<rel> with the given content and
// (optional) If-Match header, returning the recorder for callers to inspect
// status + body. Named distinctly from review_test.go's putFile (fixed path
// "doc.md", no If-Match) to avoid a redeclaration in this test package.
func putFileWithIfMatch(h *handler.Handler, rel, content, ifMatch string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(handler.FileWriteRequest{Content: content})
	req := httptest.NewRequest(http.MethodPut, "/api/files/"+rel, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	return serve(h, req)
}

func TestFiles_Read_ShaMatchesDiskContent(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "hello.md"), []byte("# hello"), 0o644))

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/files/hello.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	assert.Equal(t, files.Sha256Hex([]byte("# hello")), resp.Sha)
	assert.Len(t, resp.Sha, 64)
}

func TestFiles_Write_ShaMatchesWrittenBytes(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	rec := putFileWithIfMatch(h, "new.md", "# new file", "")
	require.Equal(t, http.StatusOK, rec.Code)

	var resp handler.FileReadResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))

	onDisk, err := os.ReadFile(filepath.Join(root, "new.md"))
	require.NoError(t, err)
	// The server force-injects an AI hint, so the sha must be computed over
	// the final on-disk bytes (hint included), not the raw request content.
	assert.Equal(t, files.Sha256Hex(onDisk), resp.Sha)
	assert.NotEqual(t, files.Sha256Hex([]byte("# new file")), resp.Sha)
}

func TestFiles_Write_IfMatch_Matching_Succeeds(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o644))

	currentSha := files.Sha256Hex([]byte("old"))
	rec := putFileWithIfMatch(h, "doc.md", "new content", currentSha)
	require.Equal(t, http.StatusOK, rec.Code)

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(string(data), "new content"))
}

func TestFiles_Write_IfMatch_Stale_Returns412AndDoesNotWrite(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o644))

	rec := putFileWithIfMatch(h, "doc.md", "new content", "0000000000000000000000000000000000000000000000000000000000000000")
	assert.Equal(t, http.StatusPreconditionFailed, rec.Code)

	var body struct {
		Error    string `json:"error"`
		Sha      string `json:"sha"`
		Modified string `json:"modified"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, files.Sha256Hex([]byte("old")), body.Sha)
	assert.NotEmpty(t, body.Modified)
	assert.NotEmpty(t, body.Error)

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "old", string(data), "file must NOT have been modified by a rejected write")
}

func TestFiles_Write_IfMatch_OnMissingFile_Returns412(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)

	rec := putFileWithIfMatch(h, "missing.md", "content", files.Sha256Hex([]byte("anything")))
	assert.Equal(t, http.StatusPreconditionFailed, rec.Code)

	var body struct {
		Sha string `json:"sha"`
	}
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Empty(t, body.Sha)

	_, err := os.Stat(filepath.Join(root, "missing.md"))
	assert.True(t, os.IsNotExist(err), "file must not have been created by a rejected write")
}

func TestFiles_Write_NoIfMatch_LegacyBehaviorUnchanged(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o644))

	// No If-Match header at all → last-write-wins, exactly as before this
	// feature existed.
	rec := putFileWithIfMatch(h, "doc.md", "clobbered by someone else's edit", "")
	require.Equal(t, http.StatusOK, rec.Code)

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(string(data), "clobbered by someone else's edit"))
}

func TestFiles_Write_IfMatch_QuotedValueAccepted(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o644))

	quoted := `"` + files.Sha256Hex([]byte("old")) + `"`
	rec := putFileWithIfMatch(h, "doc.md", "new content", quoted)
	require.Equal(t, http.StatusOK, rec.Code)

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(string(data), "new content"))
}

// TestFiles_Write_IfMatch_ConcurrentPUT_ExactlyOneSucceeds is a regression
// test for the TOCTOU race in the If-Match conflict check: two PUTs racing
// for the same file, both carrying the *same* If-Match value (the original
// content's sha), must never both succeed. Because both requests present an
// identical precondition, exactly one outcome is possible regardless of
// scheduling — whichever request's read-check-then-write section runs
// second will read the *other* request's already-written content, which no
// longer matches the shared If-Match value. This makes the assertion
// (exactly one 200, exactly one 412) true by construction rather than by
// timing, so the test can't flake even though the two PUTs are deliberately
// released through a barrier to maximize actual overlap.
func TestFiles_Write_IfMatch_ConcurrentPUT_ExactlyOneSucceeds(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "doc.md")
	require.NoError(t, os.WriteFile(target, []byte("old"), 0o644))
	oldSha := files.Sha256Hex([]byte("old"))

	contents := []string{"content-from-A", "content-from-B"}
	start := make(chan struct{})
	codes := make(chan int, len(contents))
	var wg sync.WaitGroup
	for _, content := range contents {
		wg.Add(1)
		go func(content string) {
			defer wg.Done()
			<-start // release both goroutines together to force real overlap
			rec := putFileWithIfMatch(h, "doc.md", content, oldSha)
			codes <- rec.Code
		}(content)
	}
	close(start)
	wg.Wait()
	close(codes)

	var statuses []int
	for code := range codes {
		statuses = append(statuses, code)
	}
	sort.Ints(statuses)
	assert.Equal(t, []int{http.StatusOK, http.StatusPreconditionFailed}, statuses,
		"exactly one concurrent PUT sharing the same If-Match must succeed; the other must be rejected, never both")

	data, err := os.ReadFile(target)
	require.NoError(t, err)
	wonA := strings.HasSuffix(string(data), "content-from-A")
	wonB := strings.HasSuffix(string(data), "content-from-B")
	assert.True(t, wonA != wonB, "final on-disk content must be exactly one of the two concurrent writes, got: %s", data)
}

// TestStatFile_SameSecondDoubleSave_DetectedViaSha is the whole point of
// adding a content hash: two different writes that land within the same
// wall-clock second produce identical (second-precision) mtimes but the sha
// must still differ, so a poller relying on mtime alone would miss the
// second change while a poller comparing sha would not.
func TestStatFile_SameSecondDoubleSave_DetectedViaSha(t *testing.T) {
	t.Parallel()
	h, root := setupFilesHandler(t)
	target := filepath.Join(root, "race.md")

	require.NoError(t, os.WriteFile(target, []byte("first"), 0o644))
	sameSecond := time.Now()
	require.NoError(t, os.Chtimes(target, sameSecond, sameSecond))

	rec1 := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/race.md", nil))
	require.Equal(t, http.StatusOK, rec1.Code)
	var resp1 handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec1.Body).Decode(&resp1))

	require.NoError(t, os.WriteFile(target, []byte("second"), 0o644))
	// Force the exact same (second-precision) mtime a real same-second
	// double-save would have, so the assertion isn't accidentally passing
	// only because the two writes happened to straddle a second boundary.
	require.NoError(t, os.Chtimes(target, sameSecond, sameSecond))

	rec2 := serve(h, httptest.NewRequest(http.MethodGet, "/api/stat/race.md", nil))
	require.Equal(t, http.StatusOK, rec2.Code)
	var resp2 handler.FileStatResponse
	require.NoError(t, json.NewDecoder(rec2.Body).Decode(&resp2))

	require.Equal(t, resp1.Modified, resp2.Modified, "test setup: mtimes must be identical to exercise the same-second case")
	assert.NotEqual(t, resp1.Sha, resp2.Sha, "sha must differ even though mtime did not")
}
