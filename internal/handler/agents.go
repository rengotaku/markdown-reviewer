package handler

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"markdown-reviewer/internal/agent"
	"markdown-reviewer/internal/reviewstore"
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

// StatusAgent reports the state of the session a send would go to, so the
// editor can show whether the AI is still replying. It never sends anything.
func (h *Handler) StatusAgent(c *gin.Context) {
	if !allowTerminalOrigin(c) {
		return
	}
	full, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	// A finished reply is collected here, where the editor already polls. It
	// must never break the status response. summary_id tells the editor a new
	// summary was stored by this poll, so it refetches even when the
	// transcript was written a poll after the session went idle.
	resp := statusResponse{}
	if sum, ok := h.agents.TakeSummary(ctx, full); ok {
		if err := reviewstore.AppendSummary(name, rel, reviewstore.Summary{
			ID: sum.ID, SentAt: sum.SentAt.UTC().Format(time.RFC3339), DoneAt: sum.DoneAt.UTC().Format(time.RFC3339),
			AgentID: sum.AgentID, SessionName: sum.SessionName, Text: sum.Text,
		}); err != nil {
			slog.Warn("agent: failed to store summary", "root", name, "path", rel, "err", err)
		} else {
			resp.SummaryID = sum.ID
		}
	}
	resp.Status = h.agents.Status(ctx, full)
	c.JSON(http.StatusOK, resp)
}

// statusResponse is agent.Status plus the id of a summary stored by this poll.
type statusResponse struct {
	SummaryID string `json:"summary_id,omitempty"`
	agent.Status
}

// SummariesResponse is the body of GET /api/summaries/*path.
type SummariesResponse struct {
	Summaries []reviewstore.Summary `json:"summaries"`
}

// Summaries lists the stored AI work summaries for a file, newest first.
func (h *Handler) Summaries(c *gin.Context) {
	_, rel, name, ok := h.resolveRequest(c)
	if !ok {
		return
	}
	stored, err := reviewstore.ReadSummaries(name, rel)
	if err != nil {
		slog.Warn("agent: failed to read summaries", "root", name, "path", rel, "err", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read summaries"})
		return
	}
	out := make([]reviewstore.Summary, 0, len(stored))
	for i := len(stored) - 1; i >= 0; i-- {
		out = append(out, stored[i])
	}
	c.JSON(http.StatusOK, SummariesResponse{Summaries: out})
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
