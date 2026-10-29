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
	"time"

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

type summaryAdapter struct {
	at time.Time
	recordingAdapter
}

func (a *summaryAdapter) Summary(_ context.Context, _ agent.Session, since time.Time) (string, time.Time, bool, error) {
	return "## done\n\nbody", a.at, a.at.After(since), nil
}

func TestStatusStoresSummaryAndSummariesAPI(t *testing.T) {
	t.Setenv("REVIEWER_CONFIG_DIR", t.TempDir())
	h, root := setupFilesHandler(t)
	require.NoError(t, os.WriteFile(filepath.Join(root, "a.md"), []byte("# A"), 0600))

	empty := serve(h, httptest.NewRequest(http.MethodGet, "/api/summaries/a.md", nil))
	require.Equal(t, http.StatusOK, empty.Code)
	require.JSONEq(t, `{"summaries":[]}`, empty.Body.String())

	adapter := &summaryAdapter{recordingAdapter: recordingAdapter{root: root}, at: time.Now().Add(time.Hour)}
	h.SetAgentSender(agent.New(adapter))
	require.Equal(t, http.StatusOK, serve(h, httptest.NewRequest(http.MethodPost, "/api/agents/send/a.md", nil)).Code)
	first := serve(h, httptest.NewRequest(http.MethodGet, "/api/agents/status/a.md", nil))
	require.Equal(t, http.StatusOK, first.Code)
	// The poll that stored it says so, so the editor refetches the list.
	require.Contains(t, first.Body.String(), `"summary_id":"s-`)
	// The second poll must not store it again, nor claim a new one.
	second := serve(h, httptest.NewRequest(http.MethodGet, "/api/agents/status/a.md", nil))
	require.Equal(t, http.StatusOK, second.Code)
	require.NotContains(t, second.Body.String(), "summary_id")

	rec := serve(h, httptest.NewRequest(http.MethodGet, "/api/summaries/a.md", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var body struct {
		Summaries []struct {
			ID      string `json:"id"`
			AgentID string `json:"agent_id"`
			Text    string `json:"text"`
			SentAt  string `json:"sent_at"`
			DoneAt  string `json:"done_at"`
		} `json:"summaries"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Len(t, body.Summaries, 1)
	require.Equal(t, "test-ai", body.Summaries[0].AgentID)
	require.Equal(t, "## done\n\nbody", body.Summaries[0].Text)
	require.NotEmpty(t, body.Summaries[0].SentAt)
	require.NotEmpty(t, body.Summaries[0].DoneAt)
}
