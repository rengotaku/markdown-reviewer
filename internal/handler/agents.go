package handler

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/agent"
)

func (h *Handler) RegisterAgent(c *gin.Context) {
	if !allowTerminalOrigin(c) {
		return
	}
	full, _, _, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	var id agent.Identity
	if err := c.ShouldBindJSON(&id); err != nil || id.AgentID == "" || id.SessionID == "" || id.PID < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "agent_id and session_id are required; pid must be non-negative"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	c.JSON(http.StatusOK, gin.H{"registered": h.agents.Register(ctx, full, id)})
}

func (h *Handler) SendAgent(c *gin.Context) {
	if !allowTerminalOrigin(c) {
		return
	}
	full, _, _, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	if info, err := os.Stat(full); err != nil || info.IsDir() {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 7*time.Second)
	defer cancel()
	c.JSON(http.StatusOK, h.agents.Send(ctx, full))
}

// The general API allows CORS, but a terminal handoff must not be triggered
// from an unrelated website. CLI requests have no Origin; Vite may use a
// different port on the same host.
func allowTerminalOrigin(c *gin.Context) bool {
	origin := c.GetHeader("Origin")
	if origin == "" {
		return true
	}
	from, err := url.Parse(origin)
	target, targetErr := url.Parse("http://" + c.Request.Host)
	if err == nil && targetErr == nil && (from.Scheme == "http" || from.Scheme == "https") &&
		from.Hostname() != "" && strings.EqualFold(from.Hostname(), target.Hostname()) {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "terminal handoff requires the same host"})
	return false
}
