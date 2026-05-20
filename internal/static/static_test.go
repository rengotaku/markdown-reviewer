package static

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func makeTestFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html": {
			Data: []byte(`<!DOCTYPE html><html><body>SPA Root</body></html>`),
		},
		"assets/test.js": {
			Data: []byte(`console.log("test");`),
		},
	}
}

func TestHandler_ServesIndexHtml(t *testing.T) {
	fsys := makeTestFS()
	h := handlerForFS(fsys)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET / status = %d, want %d", rec.Code, http.StatusOK)
	}

	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "SPA Root") {
		t.Errorf("GET / body = %q, want to contain 'SPA Root'", string(body))
	}
}

func TestHandler_ServesStaticAsset(t *testing.T) {
	fsys := makeTestFS()
	h := handlerForFS(fsys)

	req := httptest.NewRequest(http.MethodGet, "/assets/test.js", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /assets/test.js status = %d, want %d", rec.Code, http.StatusOK)
	}

	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), `console.log("test");`) {
		t.Errorf("GET /assets/test.js body = %q, want to contain js content", string(body))
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "javascript") {
		t.Errorf("GET /assets/test.js Content-Type = %q, want to contain 'javascript'", ct)
	}
}

func TestHandler_FallsBackToIndexForUnknownPath(t *testing.T) {
	fsys := makeTestFS()
	h := handlerForFS(fsys)

	req := httptest.NewRequest(http.MethodGet, "/some/unknown/spa/route", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /some/unknown/spa/route status = %d, want %d", rec.Code, http.StatusOK)
	}

	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "SPA Root") {
		t.Errorf("GET /some/unknown/spa/route body = %q, want to contain 'SPA Root' (fallback)", string(body))
	}
}

func TestHandler_FallsBackToIndexForDeepNestedPath(t *testing.T) {
	fsys := makeTestFS()
	h := handlerForFS(fsys)

	req := httptest.NewRequest(http.MethodGet, "/a/b/c/d", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /a/b/c/d status = %d, want %d", rec.Code, http.StatusOK)
	}

	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "SPA Root") {
		t.Errorf("GET /a/b/c/d body = %q, want to contain 'SPA Root' (fallback)", string(body))
	}
}
