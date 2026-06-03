package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHelp_ReturnsMarkdown(t *testing.T) {
	h, _ := setupFilesHandler(t)
	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/help", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	// markdown content-type so editors and AI tools render it sensibly
	// without forcing the JSON-shaped fallback path.
	assert.True(t, strings.HasPrefix(rec.Header().Get("Content-Type"), "text/markdown"))
	body := rec.Body.String()
	assert.Contains(t, body, "# markdown-reviewer API")
	assert.Contains(t, body, "GET /api/comments/*path")
}
