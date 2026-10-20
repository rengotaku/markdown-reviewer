package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRegisterAgent(t *testing.T) {
	t.Setenv("CLAUDE_PID", "123")
	t.Setenv("CLAUDE_CODE_SESSION_ID", "session-a")
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		require.Equal(t, "/api/agents/register/日本語/a b.md", r.URL.Path)
		require.Equal(t, "root & name", r.URL.Query().Get("root"))
		var body struct {
			ID      string `json:"session_id"`
			AgentID string `json:"agent_id"`
			PID     int    `json:"pid"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, 123, body.PID)
		require.Equal(t, "session-a", body.ID)
		require.Equal(t, "claude", body.AgentID)
		w.WriteHeader(http.StatusNotFound) // Older server must not break mr open.
	}))
	defer server.Close()
	registerAgent(server.URL, "root & name", "日本語/a b.md")
	require.Equal(t, 1, calls)
	t.Setenv("CLAUDE_PID", "")
	registerAgent(server.URL, "root & name", "日本語/a b.md")
	require.Equal(t, 1, calls)
	server.Close()
	t.Setenv("CLAUDE_PID", "123")
	registerAgent(server.URL, "root", "file.md") // Offline server is best effort too.
}
