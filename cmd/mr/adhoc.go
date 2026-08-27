package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// adhocTimeout bounds the registration call. The server is on localhost and
// only stats one file, so anything slower than this is a hung process, not a
// slow one.
const adhocTimeout = 5 * time.Second

// registerAdhoc asks the running server to point its ad-hoc ("anonymous")
// root at path, and returns the (root, rel) pair to build the deeplink from.
//
// This has to go through the server rather than being computed locally the
// way resolvePath does: the ad-hoc root only exists in the server process's
// memory, so nothing in the environment or the launchd plist can tell the
// CLI about it.
func registerAdhoc(base, path string) (root, rel string, err error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", "", err
	}
	body, err := json.Marshal(map[string]string{"path": abs})
	if err != nil {
		return "", "", err
	}
	client := &http.Client{Timeout: adhocTimeout}
	resp, err := client.Post(strings.TrimSuffix(base, "/")+"/api/adhoc", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", "", fmt.Errorf("%s is outside every configured root, and registering it as a one-off review needs the running server at %s (start it, then retry): %w", abs, base, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return "", "", err
	}
	var payload struct {
		Root  string `json:"root"`
		Path  string `json:"path"`
		Error string `json:"error"`
	}
	if jsonErr := json.Unmarshal(raw, &payload); jsonErr != nil {
		return "", "", fmt.Errorf("registering %s as a one-off review failed (HTTP %d): %s", abs, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if resp.StatusCode != http.StatusOK {
		msg := payload.Error
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return "", "", fmt.Errorf("registering %s as a one-off review failed: %s", abs, msg)
	}
	if payload.Root == "" || payload.Path == "" {
		return "", "", fmt.Errorf("registering %s as a one-off review returned an empty root", abs)
	}
	return payload.Root, payload.Path, nil
}
