package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"markdown-reviewer/internal/agentsetup"
)

// Best effort: opening a review keeps working with an offline/older server
// and outside Claude Code. Never forward either environment value elsewhere.
func registerAgent(base, root, rel string) {
	id, ok := agentsetup.OpenerIdentity()
	if !ok {
		return
	}
	body, err := json.Marshal(id)
	if err != nil {
		return
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Post(strings.TrimSuffix(base, "/")+"/api/agents/register/"+pathEscape(rel)+"?root="+url.QueryEscape(root), "application/json", bytes.NewReader(body))
	if err == nil {
		_ = resp.Body.Close()
	}
}
