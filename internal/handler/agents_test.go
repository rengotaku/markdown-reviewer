package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"markdown-reviewer/internal/agent"
)

type recordingAdapter struct {
	root string
	text string
}

func (*recordingAdapter) ID() string { return "test-ai" }
func (a *recordingAdapter) Sessions(context.Context) ([]agent.Session, error) {
	return []agent.Session{{ID: "session", Cwd: a.root, Ready: true}}, nil
}
func (a *recordingAdapter) Send(_ context.Context, _ agent.Session, text string) error {
	a.text = text
	return nil
}

func TestAgentHandlerAcceptsInjectedAdapterWithoutLocalPID(t *testing.T) {
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("# A"), 0600))
	adapter := &recordingAdapter{root: root}
	h.SetAgentSender(agent.New(adapter))
	registration := serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/register/a.md", strings.NewReader(`{"agent_id":"test-ai","session_id":"session"}`)))
	require.Equal(t, http.StatusOK, registration.Code)
	require.JSONEq(t, `{"registered":true}`, registration.Body.String())
	response := serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/send/a.md", nil))
	require.Equal(t, http.StatusOK, response.Code)
	var result agent.Result
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Sent)
	require.Equal(t, "test-ai", result.AgentID)
	require.Equal(t, agent.ReviewCommand(filepath.Join(root, "a.md")), adapter.text)
}

func TestAgentFallbackAndPathValidation(t *testing.T) {
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("# A"), 0600))
	response := serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/send/a.md", nil))
	require.Equal(t, http.StatusOK, response.Code)
	var result agent.Result
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.False(t, result.Sent)
	require.Equal(t, "no_session", result.Reason)
	require.Equal(t, agent.ReviewCommand(filepath.Join(root, "a.md")), result.Command)

	for _, path := range []string{"../a.md", "a.txt", "a.md?root=unknown"} {
		response = serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/send/"+path, nil))
		require.Equal(t, http.StatusBadRequest, response.Code)
	}
	response = serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/send/missing.md", nil))
	require.Equal(t, http.StatusNotFound, response.Code)
	for _, action := range []string{"register", "send"} {
		request := httptest.NewRequest(http.MethodPost, "/api/agents/"+action+"/a.md", nil)
		request.Header.Set("Origin", "https://unrelated.example")
		require.Equal(t, http.StatusForbidden, serve(h, request).Code)
	}
	request := httptest.NewRequest(http.MethodPost, "http://localhost:8080/api/agents/send/a.md", nil)
	request.Header.Set("Origin", "http://localhost:5174")
	require.Equal(t, http.StatusOK, serve(h, request).Code)
	for _, body := range []string{`{}`, `invalid`, `{"agent_id":"missing","pid":123,"session_id":"missing"}`} {
		response = serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/register/a.md", strings.NewReader(body)))
		if strings.Contains(body, "session_id") {
			require.Equal(t, http.StatusOK, response.Code)
			require.JSONEq(t, `{"registered":false}`, response.Body.String())
		} else {
			require.Equal(t, http.StatusBadRequest, response.Code)
		}
	}
}

func TestAgentStatusHandler(t *testing.T) {
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("# A"), 0600))
	adapter := &recordingAdapter{root: root}
	h.SetAgentSender(agent.New(adapter))
	response := serve(h, httptest.NewRequest(http.MethodGet, "/api/agents/status/a.md", nil))
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"state":"idle","agent_id":"test-ai"}`, response.Body.String())
	require.Empty(t, adapter.text, "status must not send")

	for _, path := range []string{"../a.md", "a.txt", "a.md?root=unknown"} {
		response = serve(h, httptest.NewRequest(http.MethodGet, "/api/agents/status/"+path, nil))
		require.Equal(t, http.StatusBadRequest, response.Code)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/agents/status/a.md", nil)
	request.Header.Set("Origin", "https://unrelated.example")
	require.Equal(t, http.StatusForbidden, serve(h, request).Code)
}
