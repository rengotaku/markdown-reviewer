package handler

import (
	_ "embed"
	"net/http"

	"github.com/gin-gonic/gin"
)

// helpMarkdown is the canonical, AI-facing API spec. It ships embedded so
// the binary stays a single artifact and the help endpoint can never drift
// out of sync with what's committed in the repo.
//
//go:embed helpdoc/api.md
var helpMarkdown string

// Help returns the API spec as text/markdown so AI clients can discover
// every endpoint and its contract by following the URL embedded in each
// file's AI hint comment.
func (h *Handler) Help(c *gin.Context) {
	c.Data(http.StatusOK, "text/markdown; charset=utf-8", []byte(helpMarkdown))
}
