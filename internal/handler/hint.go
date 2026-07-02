package handler

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"markdown-reviewer/internal/reviewstore"
)

// hintEnv is the env var that overrides the auto-derived base URL. Useful
// when the server is behind a reverse proxy, port-forwarded, or otherwise
// reachable via a hostname different from what the Host header says.
const hintEnv = "MARKDOWN_REVIEWER_BASE_URL"

// buildAIHint formats the HTML comment that AI clients see when they open
// a freshly-saved file. The two URLs are the only piece of dynamic state;
// everything else is deterministic so identical content produces an
// identical hint and the surrounding `<!-- ... -->` shape stays parseable
// by reviewstore.StripAIHint's block matcher on the next save.
func buildAIHint(baseURL, relPath, rootName string) string {
	base := strings.TrimSuffix(baseURL, "/")
	rootQuery := ""
	if rootName != "" {
		rootQuery = "?root=" + url.QueryEscape(rootName)
	}
	commentsURL := base + "/api/comments/" + escapePath(relPath) + rootQuery
	reviewURL := base + "/api/review/" + escapePath(relPath) + rootQuery
	helpURL := base + "/api/help"

	var b strings.Builder
	b.WriteString("<!-- markdown-reviewer\n")
	// The canonical file is clean: review comments live in a sidecar, not in
	// the body. This hint just points an AI at the review API.
	b.WriteString("本文はクリーンです。レビューコメントは別管理(sidecar)で、以下から取得します。\n")
	b.WriteString("CLI(推奨):  mr review <このファイルのパス>   # 返信: mr reply <path> <id> '...' / 解決: mr resolve <path> <id>\n")
	b.WriteString("レビュー(open, 整形済): GET ")
	b.WriteString(reviewURL)
	b.WriteString("\n")
	b.WriteString("コメント(JSON):         GET ")
	b.WriteString(commentsURL)
	b.WriteString("\n")
	b.WriteString("API 全仕様:             GET ")
	b.WriteString(helpURL)
	b.WriteString("\n")
	b.WriteString("-->\n\n")
	return b.String()
}

// injectAIHint replaces (or prepends) the AI hint block at the top of
// content. Forcing it on every PUT means existing files migrate on first
// save, which is the trade-off the project accepts for self-describing
// access.
func injectAIHint(content, hint string) string {
	// StripAIHint also trims leading blank lines, avoiding an unwanted blank
	// line when the rest of the file already starts with one. The stripper
	// lives in reviewstore because hint-free snapshots are a store invariant.
	return hint + reviewstore.StripAIHint(content)
}

// deriveBaseURL picks the base URL to embed in the hint. Precedence:
//  1. explicit MARKDOWN_REVIEWER_BASE_URL — covers reverse-proxy and
//     hostname-rewrite cases where the Host header is wrong.
//  2. request scheme + Host — works for the default localhost setup
//     without any extra configuration.
func deriveBaseURL(r *http.Request) string {
	if v := strings.TrimSpace(os.Getenv(hintEnv)); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// escapePath URL-escapes each path segment while keeping `/` as a real
// separator. `url.PathEscape` alone would turn `/` into `%2F`, which gin's
// route matcher won't accept.
func escapePath(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
