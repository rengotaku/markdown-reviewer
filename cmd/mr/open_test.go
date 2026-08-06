package main

import (
	"errors"
	"strings"
	"testing"

	"markdown-reviewer/internal/launchd"
)

// noPlist stands in for a machine without an installed launchd agent.
func noPlist() (string, error) { return "", errors.New("no plist") }

func TestDeeplink(t *testing.T) {
	got := deeplink("http://localhost:15174", "works", "2608041155/phases/phase0/draft.md")
	want := "http://localhost:15174/?root=works&select_file=2608041155%2Fphases%2Fphase0%2Fdraft.md"
	if got != want {
		t.Errorf("deeplink() = %q, want %q", got, want)
	}
}

func TestDeeplink_EscapesMultibyteAndSpaces(t *testing.T) {
	got := deeplink("http://localhost:15174", "レビュー", "日本語/note v2.md")
	// A raw space or '/' in select_file would break the query the UI parses.
	for _, bad := range []string{" ", "日本語/note"} {
		if strings.Contains(got, bad) {
			t.Errorf("deeplink() = %q, left %q unescaped", got, bad)
		}
	}
	if !strings.Contains(got, "select_file=%E6%97%A5%E6%9C%AC%E8%AA%9E%2Fnote+v2.md") {
		t.Errorf("deeplink() = %q, missing escaped select_file", got)
	}
	if !strings.Contains(got, "root=%E3%83%AC%E3%83%93%E3%83%A5%E3%83%BC") {
		t.Errorf("deeplink() = %q, missing escaped root", got)
	}
}

func TestDeeplink_TrimsTrailingSlashOnBase(t *testing.T) {
	got := deeplink("http://localhost:15174/", "works", "a.md")
	if strings.Contains(got, "15174//") {
		t.Errorf("deeplink() = %q, doubled the slash", got)
	}
}

func TestBaseURL_Precedence(t *testing.T) {
	cases := []struct {
		name      string
		baseEnv   string
		portEnv   string
		plistPort func() (string, error)
		want      string
	}{
		{
			name:      "base URL env wins over everything",
			baseEnv:   "https://review.example.test/",
			portEnv:   "9999",
			plistPort: func() (string, error) { return "15174", nil },
			want:      "https://review.example.test",
		},
		{
			name:      "PORT env wins over the plist",
			portEnv:   "9999",
			plistPort: func() (string, error) { return "15174", nil },
			want:      "http://localhost:9999",
		},
		{
			name:      "plist PORT is used when the env is unset",
			plistPort: func() (string, error) { return "15174\n", nil },
			want:      "http://localhost:15174",
		},
		{
			name:      "falls back to the packaged default when the plist is unreadable",
			plistPort: noPlist,
			want:      "http://localhost:" + launchd.DefaultPort,
		},
		{
			name:      "falls back when the plist holds an empty PORT",
			plistPort: func() (string, error) { return "  ", nil },
			want:      "http://localhost:" + launchd.DefaultPort,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv(baseURLEnv, c.baseEnv)
			t.Setenv("PORT", c.portEnv)
			if got := baseURL(c.plistPort); got != c.want {
				t.Errorf("baseURL() = %q, want %q", got, c.want)
			}
		})
	}
}

func TestCmdOpen_UsageOnWrongArgCount(t *testing.T) {
	for _, args := range [][]string{nil, {"a.md", "b.md"}} {
		err := cmdOpen(args)
		if err == nil || !strings.Contains(err.Error(), "usage: mr open") {
			t.Errorf("cmdOpen(%v) error = %v, want a usage error", args, err)
		}
	}
}

func TestCmdOpen_RejectsPathOutsideRoots(t *testing.T) {
	// An explicit REVIEW_ROOTS keeps this off the machine's real plist.
	t.Setenv("REVIEW_ROOTS", `[{"name":"works","path":"`+t.TempDir()+`"}]`)
	err := cmdOpen([]string{"/definitely/not/under/a/root.md", "--print"})
	if err == nil || !strings.Contains(err.Error(), "not under any configured root") {
		t.Errorf("cmdOpen() error = %v, want a containment error", err)
	}
}
