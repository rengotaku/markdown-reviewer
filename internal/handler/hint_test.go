package handler

// Package-internal tests for the hint helpers so we can call buildAIHint
// and injectAIHint directly without going through the HTTP layer.

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildAIHint_ShapeAndURLs(t *testing.T) {
	got := buildAIHint("http://localhost:15174", "phases/phase7/diff.v2.md", "works")
	if !strings.HasPrefix(got, "<!-- markdown-reviewer\n") {
		t.Errorf("missing opening marker: %q", got)
	}
	if !strings.HasSuffix(got, "-->\n\n") {
		t.Errorf("missing trailing blank line after marker: %q", got)
	}
	// Hint must NOT quote a literal `<!-- @comment ... -->` example, or
	// the comment parser would see it as a real (id-less) marker and
	// emit a phantom entry.
	if strings.Contains(got, "<!-- @comment") {
		t.Errorf("hint must not contain a literal <!-- @comment example: %q", got)
	}
	wantURL := "http://localhost:15174/api/comments/phases/phase7/diff.v2.md?root=works"
	if !strings.Contains(got, wantURL) {
		t.Errorf("comments URL missing: got %q", got)
	}
	if !strings.Contains(got, "http://localhost:15174/api/help") {
		t.Errorf("help URL missing: got %q", got)
	}
}

func TestBuildAIHint_OmitsRootQueryWhenEmpty(t *testing.T) {
	got := buildAIHint("http://localhost:15174", "a.md", "")
	if strings.Contains(got, "?root=") {
		t.Errorf("empty root must not produce ?root=: %q", got)
	}
}

func TestBuildAIHint_TrimsTrailingSlash(t *testing.T) {
	got := buildAIHint("http://localhost:15174/", "a.md", "works")
	if !strings.Contains(got, "http://localhost:15174/api/comments/a.md") {
		t.Errorf("trailing slash not stripped: %q", got)
	}
}

func TestBuildAIHint_URLEscapesPathSegments(t *testing.T) {
	got := buildAIHint("http://localhost:15174", "日本語/note v2.md", "rooms")
	// `/` must remain literal (gin routes need it) while spaces / multibyte
	// characters get percent-encoded.
	if !strings.Contains(got, "%E6%97%A5%E6%9C%AC%E8%AA%9E/note%20v2.md") {
		t.Errorf("path segments not escaped correctly: %q", got)
	}
}

func TestInjectAIHint_PrependsWhenAbsent(t *testing.T) {
	hint := "<!-- markdown-reviewer\nx\n-->\n\n"
	got := injectAIHint("# title\n\nbody\n", hint)
	if !strings.HasPrefix(got, hint) {
		t.Errorf("hint must be prepended: %q", got)
	}
	if !strings.HasSuffix(got, "# title\n\nbody\n") {
		t.Errorf("original content must be preserved: %q", got)
	}
}

func TestInjectAIHint_ReplacesExisting(t *testing.T) {
	old := "<!-- markdown-reviewer\nold-version\n-->\n\n# title\n"
	hint := "<!-- markdown-reviewer\nnew-version\n-->\n\n"
	got := injectAIHint(old, hint)
	if strings.Contains(got, "old-version") {
		t.Errorf("old hint must be replaced: %q", got)
	}
	if !strings.Contains(got, "new-version") {
		t.Errorf("new hint must be present: %q", got)
	}
	// Ensure we didn't end up with two markers.
	if c := strings.Count(got, "<!-- markdown-reviewer"); c != 1 {
		t.Errorf("hint must appear exactly once, got %d", c)
	}
}

func TestInjectAIHint_DoesNotTouchMidFileMarkers(t *testing.T) {
	// A `<!-- markdown-reviewer` that isn't at the top is left alone — the
	// regex is anchored to `\A` so it only sweeps the head.
	src := "# title\n\nsome body\n\n<!-- markdown-reviewer fake -->\n"
	hint := "<!-- markdown-reviewer\nfresh\n-->\n\n"
	got := injectAIHint(src, hint)
	if !strings.Contains(got, "fake") {
		t.Errorf("mid-file marker should survive: %q", got)
	}
}

func TestDeriveBaseURL_FromHostHeader(t *testing.T) {
	t.Setenv(hintEnv, "") // ensure no env override leaks in
	req := httptest.NewRequest("GET", "http://example.test/whatever", nil)
	if got := deriveBaseURL(req); got != "http://example.test" {
		t.Errorf("got %q", got)
	}
}

func TestDeriveBaseURL_EnvOverride(t *testing.T) {
	t.Setenv(hintEnv, "https://my-proxy.example.com/")
	req := httptest.NewRequest("GET", "http://internal-host/x", nil)
	// Env wins over the (misleading) Host header, and the trailing slash
	// is trimmed so callers don't have to special-case it.
	if got := deriveBaseURL(req); got != "https://my-proxy.example.com" {
		t.Errorf("got %q", got)
	}
}
