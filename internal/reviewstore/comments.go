package reviewstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// reviewVersion is the schema version stamped into review.json.
const reviewVersion = 1

// Comment status values.
const (
	StatusOpen     = "open"
	StatusResolved = "resolved"
)

// ErrNotIngested is returned when a comment operation targets a file that has
// not been put under review yet (no review.json). Ingest is explicit (#52), so
// callers surface this as a 409 rather than silently creating the entry.
var ErrNotIngested = errors.New("reviewstore: file not ingested")

// ErrCommentNotFound is returned when an id does not match any comment.
var ErrCommentNotFound = errors.New("reviewstore: comment not found")

// ErrCommentResolved is returned when a mutation (reply / body edit) targets a
// resolved comment. Resolved comments are read-only except for reopening; the
// caller must set status back to open first.
var ErrCommentResolved = errors.New("reviewstore: comment is resolved")

// ErrReplyNotFound is returned when a reply index is out of range for its
// comment (replies are addressed by 0-based position, not by id).
var ErrReplyNotFound = errors.New("reviewstore: reply not found")

// Anchor locates a comment inside the clean canonical markdown by content,
// not by position — the canonical file carries no review markers (#50). On
// load the snippet is searched under heading_path; the occurrence index
// disambiguates identical snippets. A miss yields an orphan (honest failure)
// rather than a silent mis-anchor.
//
// LineFingerprint and Orphan (#287) exist because snippet+heading+occurrence
// alone cannot detect a *silent* mis-anchor: when a snippet repeats many times
// under the same heading (e.g. a table's "未対応" status column) and the
// matching lines are reordered, "the Occurrence-th match" still resolves —
// just to a different line than the one the comment was made about.
// LineFingerprint records the markup-stripped, trimmed text of the line the
// anchor resolved to at creation time, so reanchorOne can tell "resolves"
// apart from "resolves to the line it originally meant". Orphan is set when
// that check fails and no rebuilt anchor could be found either: the comment
// must not silently point at the wrong line, so it is flagged rather than
// left looking healthy.
type Anchor struct {
	Snippet         string   `json:"snippet"`
	LineFingerprint string   `json:"line_fingerprint,omitempty"`
	HeadingPath     []string `json:"heading_path"`
	Occurrence      int      `json:"occurrence"`
	Orphan          bool     `json:"orphan,omitempty"`
}

// Reply is one threaded response under a comment.
type Reply struct {
	Author string `json:"author,omitempty"`
	Date   string `json:"date,omitempty"`
	Body   string `json:"body"`
}

// Comment is one review note stored in review.json. Anchor is nil for global
// scope; Anchors carries one entry per section for cross_section.
type Comment struct {
	ID      string   `json:"id"`
	Scope   string   `json:"scope"`
	GroupID string   `json:"group_id,omitempty"`
	Author  string   `json:"author,omitempty"`
	Date    string   `json:"date,omitempty"`
	Body    string   `json:"body"`
	Status  string   `json:"status"`
	Replies []Reply  `json:"replies,omitempty"`
	Anchor  *Anchor  `json:"anchor,omitempty"`
	Anchors []Anchor `json:"anchors,omitempty"`
}

// Review is the review.json document.
type Review struct {
	Comments []Comment `json:"comments"`
	Version  int       `json:"version"`
}

// ReadReview loads review.json. A missing file (not ingested, or freshly
// ingested with no comments) yields an empty review, not an error, so callers
// can treat "no comments" uniformly.
func ReadReview(root, relPath string) (Review, error) {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return Review{}, err
	}
	data, err := os.ReadFile(filepath.Join(dir, reviewFile))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Review{Version: reviewVersion, Comments: []Comment{}}, nil
		}
		return Review{}, fmt.Errorf("reviewstore: read review.json: %w", err)
	}
	var r Review
	if err := json.Unmarshal(data, &r); err != nil {
		return Review{}, fmt.Errorf("reviewstore: parse review.json: %w", err)
	}
	if r.Comments == nil {
		r.Comments = []Comment{}
	}
	return r, nil
}

// writeReview marshals and atomically writes a Review to path.
func writeReview(path string, r Review) error {
	if r.Version == 0 {
		r.Version = reviewVersion
	}
	if r.Comments == nil {
		r.Comments = []Comment{}
	}
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Errorf("reviewstore: marshal review.json: %w", err)
	}
	return atomicWrite(path, append(data, '\n'))
}

// saveReview writes the review for an ingested file.
func saveReview(root, relPath string, r Review) error {
	dir, err := EntryDir(root, relPath)
	if err != nil {
		return err
	}
	return writeReview(filepath.Join(dir, reviewFile), r)
}

// AddComment appends a comment to an ingested file's review.json. The id is
// assigned (c-NNN) when empty; status defaults to open. Returns the stored
// comment. Errors with ErrNotIngested if the file is not under review.
func AddComment(root, relPath string, c Comment) (Comment, error) {
	if !HasEntry(root, relPath) {
		return Comment{}, ErrNotIngested
	}
	r, err := ReadReview(root, relPath)
	if err != nil {
		return Comment{}, err
	}
	if c.ID == "" {
		c.ID = nextCommentID(r.Comments)
	}
	if c.Status == "" {
		c.Status = StatusOpen
	}
	r.Comments = append(r.Comments, c)
	if err := saveReview(root, relPath, r); err != nil {
		return Comment{}, err
	}
	return c, nil
}

// UpdateCommentStatus sets a comment's status (e.g. resolved). Returns the
// updated comment, or ErrCommentNotFound.
func UpdateCommentStatus(root, relPath, id, status string) (Comment, error) {
	return mutateComment(root, relPath, id, func(c *Comment) error {
		c.Status = status
		return nil
	})
}

// UpdateCommentBody replaces a comment's body text. A resolved comment is
// read-only: ErrCommentResolved is returned until it is reopened.
func UpdateCommentBody(root, relPath, id, body string) (Comment, error) {
	return mutateComment(root, relPath, id, func(c *Comment) error {
		if c.Status == StatusResolved {
			return ErrCommentResolved
		}
		c.Body = body
		return nil
	})
}

// AddReply appends a threaded reply to a comment. A resolved comment is
// read-only: ErrCommentResolved is returned until it is reopened.
func AddReply(root, relPath, id string, reply Reply) (Comment, error) {
	return mutateComment(root, relPath, id, func(c *Comment) error {
		if c.Status == StatusResolved {
			return ErrCommentResolved
		}
		c.Replies = append(c.Replies, reply)
		return nil
	})
}

// UpdateReplyBody edits a threaded reply's body, addressed by its 0-based
// index under the comment. A resolved comment is read-only (ErrCommentResolved);
// an out-of-range index yields ErrReplyNotFound.
func UpdateReplyBody(root, relPath, id string, index int, body string) (Comment, error) {
	return mutateComment(root, relPath, id, func(c *Comment) error {
		if c.Status == StatusResolved {
			return ErrCommentResolved
		}
		if index < 0 || index >= len(c.Replies) {
			return ErrReplyNotFound
		}
		c.Replies[index].Body = body
		return nil
	})
}

// DeleteReply removes a threaded reply by its 0-based index under the comment.
// A resolved comment is read-only (ErrCommentResolved); an out-of-range index
// yields ErrReplyNotFound.
func DeleteReply(root, relPath, id string, index int) (Comment, error) {
	return mutateComment(root, relPath, id, func(c *Comment) error {
		if c.Status == StatusResolved {
			return ErrCommentResolved
		}
		if index < 0 || index >= len(c.Replies) {
			return ErrReplyNotFound
		}
		c.Replies = append(c.Replies[:index], c.Replies[index+1:]...)
		return nil
	})
}

// HasOpenComments reports whether the ingested file has at least one comment
// with Status == StatusOpen. Returns false (not an error) when the file is not
// ingested or has no comments. An I/O error reading review.json is returned,
// but the caller is expected to treat errors as false so a stat response is
// never blocked by a transient failure.
func HasOpenComments(root, relPath string) (bool, error) {
	if !HasEntry(root, relPath) {
		return false, nil
	}
	r, err := ReadReview(root, relPath)
	if err != nil {
		return false, err
	}
	for _, c := range r.Comments {
		if c.Status == StatusOpen {
			return true, nil
		}
	}
	return false, nil
}

// DeleteComment removes a comment by id. Returns ErrCommentNotFound if absent.
func DeleteComment(root, relPath, id string) error {
	if !HasEntry(root, relPath) {
		return ErrNotIngested
	}
	r, err := ReadReview(root, relPath)
	if err != nil {
		return err
	}
	out := r.Comments[:0]
	removed := false
	for _, c := range r.Comments {
		if c.ID == id {
			removed = true
			continue
		}
		out = append(out, c)
	}
	if !removed {
		return ErrCommentNotFound
	}
	r.Comments = out
	return saveReview(root, relPath, r)
}

// mutateComment applies fn to the comment with the given id and persists. If fn
// returns an error the change is not saved and the error is propagated (used to
// reject edits to resolved comments).
func mutateComment(root, relPath, id string, fn func(*Comment) error) (Comment, error) {
	if !HasEntry(root, relPath) {
		return Comment{}, ErrNotIngested
	}
	r, err := ReadReview(root, relPath)
	if err != nil {
		return Comment{}, err
	}
	for i := range r.Comments {
		if r.Comments[i].ID == id {
			if ferr := fn(&r.Comments[i]); ferr != nil {
				return Comment{}, ferr
			}
			if err := saveReview(root, relPath, r); err != nil {
				return Comment{}, err
			}
			return r.Comments[i], nil
		}
	}
	return Comment{}, ErrCommentNotFound
}

// nextCommentID returns c-NNN one past the highest numeric suffix present, so
// ids stay unique and stable even after deletions.
func nextCommentID(comments []Comment) string {
	max := 0
	for _, c := range comments {
		s := strings.TrimPrefix(c.ID, "c-")
		if s == c.ID {
			continue
		}
		if n, err := strconv.Atoi(s); err == nil && n > max {
			max = n
		}
	}
	return fmt.Sprintf("c-%03d", max+1)
}

// ResolveAnchor finds the 1-indexed line range of an anchor in the canonical
// content. It searches for the snippet under a matching heading path, picking
// the Occurrence-th match. ok=false means the anchor is orphaned (snippet not
// found / heading renamed) — the caller surfaces it as an orphan rather than
// guessing a location.
func ResolveAnchor(content string, a Anchor) (lineRange [2]int, ok bool) {
	if a.Orphan {
		// Explicitly flagged as pointing at the wrong line (#287): treat
		// exactly like "not found" rather than resolving to a plausible but
		// known-incorrect line.
		return [2]int{}, false
	}
	if a.Snippet == "" {
		return [2]int{}, false
	}
	return resolveInDoc(renderDoc(content), a)
}

// resolveInDoc is ResolveAnchor against an already rendered document.
//
// Exact matching owns Occurrence. When nothing matches exactly, a snippet
// that still carries leading block markers (`- `, `1. `, `> `, `# ` — AI
// clients copy them from the raw line) is retried without them, and accepted
// only when that finds exactly one line: Occurrence was counted on raw lines
// and does not index the stripped matches. This mirrors the frontend's #168
// fallback (stripBlockMarkers in pmAnchor.ts).
func resolveInDoc(doc renderedDoc, a Anchor) (lineRange [2]int, ok bool) {
	under := func(i int) bool {
		return len(a.HeadingPath) == 0 || headingSuffixMatch(doc.stacks[i], a.HeadingPath)
	}
	seen := 0
	for i, t := range doc.text {
		if !strings.Contains(t, a.Snippet) || !under(i) {
			continue
		}
		if seen == a.Occurrence {
			return [2]int{i + 1, i + 1}, true
		}
		seen++
	}
	if seen > 0 {
		return [2]int{}, false
	}
	bare := stripBlockMarkers(a.Snippet)
	if bare == a.Snippet || bare == "" {
		return [2]int{}, false
	}
	match := -1
	for i, t := range doc.text {
		if !strings.Contains(t, bare) || !under(i) {
			continue
		}
		if match >= 0 {
			return [2]int{}, false
		}
		match = i
	}
	if match < 0 {
		return [2]int{}, false
	}
	return [2]int{match + 1, match + 1}, true
}

// blockMarkerRe matches one leading block marker; see stripBlockMarkers.
var blockMarkerRe = regexp.MustCompile(`^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)`)

// stripBlockMarkers removes leading block-level Markdown markers from a
// snippet, repeatedly so nested forms like "> - " go too. Same rule as the
// frontend's stripBlockMarkers (pmAnchor.ts).
func stripBlockMarkers(s string) string {
	for {
		next := blockMarkerRe.ReplaceAllString(s, "")
		if next == s {
			return s
		}
		s = next
	}
}

// FingerprintAt returns the fingerprint (markup-stripped, trimmed line text)
// of the line an anchor resolves to in content, for stamping onto
// Anchor.LineFingerprint. ok=false means the anchor did not resolve, or the
// line it resolved to has no stable text to fingerprint (blank / markup
// only) — callers should leave LineFingerprint empty in that case rather
// than record a fingerprint that can never match again.
func FingerprintAt(content string, a Anchor) (fingerprint string, ok bool) {
	lr, found := ResolveAnchor(content, a)
	if !found {
		return "", false
	}
	lines := strings.Split(content, "\n")
	idx := lr[0] - 1
	if idx < 0 || idx >= len(lines) {
		return "", false
	}
	fp := strings.TrimSpace(stripInlineMarkup(lines[idx]))
	if fp == "" {
		return "", false
	}
	return fp, true
}

// StampFingerprint sets a's LineFingerprint from the line it resolves to in
// content, always overwriting any caller-supplied value (Orphan is likewise
// reset to false: a freshly created anchor is never orphan). a may be nil, or
// fail to resolve — both leave LineFingerprint empty. Shared by the HTTP
// handler and `mr comment add` so both create anchors the same way (#287).
func StampFingerprint(content string, a *Anchor) {
	if a == nil {
		return
	}
	a.Orphan = false
	if fp, ok := FingerprintAt(content, *a); ok {
		a.LineFingerprint = fp
	} else {
		a.LineFingerprint = ""
	}
}

// ResolveAnchorForDisplay resolves like ResolveAnchor but falls back to the
// snippet alone when the heading gate rejects every line and the snippet still
// occurs exactly once: that line is then the only thing the anchor can mean, so
// showing it beats reporting an orphan. The returned anchor is the stored one
// when strict resolution succeeded and a repaired copy (heading_path recomputed
// at the matched line) when the fallback fired, so callers can hand the client
// an anchor the frontend's own strict resolution agrees with — otherwise the
// comment would report a line number while its highlight and "対象" jump stayed
// dead.
//
// A stored heading_path goes stale when an ancestor heading is renamed, and
// anchors that ReanchorReview rewrote before #205 carry a path recorded from a
// mis-parsed stack — one that names a line which is really fenced code and so
// stops matching once the parser is fixed.
//
// Only the read paths use this. ReanchorReview deliberately keeps the strict
// ResolveAnchor so a stale heading_path still counts as "needs repair" and gets
// rewritten to disk on the next edit instead of being papered over forever.
func ResolveAnchorForDisplay(content string, a Anchor) (anchor Anchor, lineRange [2]int, ok bool) {
	if a.Orphan {
		// #287: an anchor reanchorOne has explicitly flagged Orphan is known
		// to point at the wrong line (its recorded target moved/vanished and
		// no rebuild recovered it) — that determination must stick. Without
		// this early return, the single-remaining-match fallback below would
		// "recover" a plausible-looking line whenever the snippet happens to
		// still be unique in the new body, silently undoing the Orphan flag
		// and reviving the exact silent mis-anchor #287 fixed.
		return a, [2]int{}, false
	}
	if lr, found := ResolveAnchor(content, a); found {
		return a, lr, true
	}
	if a.Snippet == "" || a.Occurrence != 0 {
		return a, [2]int{}, false
	}
	doc := renderDoc(content)
	match := -1
	for i, t := range doc.text {
		if !strings.Contains(t, a.Snippet) {
			continue
		}
		if match >= 0 {
			return a, [2]int{}, false // ambiguous — leave it orphaned
		}
		match = i
	}
	if match < 0 {
		return a, [2]int{}, false
	}
	repaired := Anchor{
		Snippet:     a.Snippet,
		HeadingPath: append([]string(nil), doc.stacks[match]...),
		Occurrence:  0,
	}
	// The repaired anchor must resolve strictly to the same line; if it does
	// not, hand back the stored one rather than a plausible-looking wrong path.
	if lr, found := ResolveAnchor(content, repaired); found && lr[0] == match+1 {
		return repaired, lr, true
	}
	return a, [2]int{match + 1, match + 1}, true
}

// headingSuffixMatch reports whether want is a suffix of stack, so a partial
// heading path (e.g. just the immediate section) still anchors correctly.
func headingSuffixMatch(stack, want []string) bool {
	if len(want) > len(stack) {
		return false
	}
	off := len(stack) - len(want)
	for i := range want {
		if stack[off+i] != want[i] {
			return false
		}
	}
	return true
}

var (
	mdImageRe       = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	mdLinkRe        = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	mdStrikeRe      = regexp.MustCompile(`~~(.+?)~~`)
	mdStrongStarRe  = regexp.MustCompile(`\*\*(.+?)\*\*`)
	mdStrongUnderRe = regexp.MustCompile(`__(.+?)__`)
	mdEmStarRe      = regexp.MustCompile(`\*([^*\n]+?)\*`)
	mdEmUnderRe     = regexp.MustCompile(`(^|[^\p{L}\p{N}])_([^_\n]+?)_($|[^\p{L}\p{N}])`)
)

// StripInlineMarkup exposes the anchor package's inline-markup stripper to
// out-of-package callers that compare line text across revisions (the mr
// CLI's drift-banner classification, #322), so that comparison normalizes
// text identically to ResolveAnchor/FingerprintAt — otherwise a line whose
// only "change" is e.g. added `**bold**` markup would look like new text.
func StripInlineMarkup(s string) string { return stripInlineMarkup(s) }

// stripInlineMarkup removes inline Markdown formatting so backend anchor text
// matches the frontend's ProseMirror textContent, which renders these marks
// away (the editor uses tiptap-markdown / markdown-it). Without this, a code
// span or emphasis anywhere in a heading desyncs the heading_path the frontend
// stored (marks stripped) from the one the backend re-parses (marks intact),
// orphaning the comment even though nothing was edited.
//
// Code spans are unwrapped first and their contents kept literal, mirroring
// CommonMark precedence — so emphasis characters inside them (e.g. the
// underscores in `_watchlist.md`) survive. Only text outside code spans has
// links/images unwrapped to their text and emphasis/strikethrough delimiters
// dropped.
func stripInlineMarkup(s string) string { return stripInline(s) }

func stripInline(s string) string {
	runes := []rune(s)
	n := len(runes)
	var out strings.Builder
	var seg strings.Builder
	flush := func() {
		if seg.Len() > 0 {
			out.WriteString(stripEmphasis(seg.String()))
			seg.Reset()
		}
	}
	i := 0
	for i < n {
		if runes[i] != '`' {
			seg.WriteRune(runes[i])
			i++
			continue
		}
		// Count the opening backtick run, then find a closing run of equal length.
		k := 0
		for i+k < n && runes[i+k] == '`' {
			k++
		}
		j := i + k
		for j < n {
			if runes[j] != '`' {
				j++
				continue
			}
			m := 0
			for j+m < n && runes[j+m] == '`' {
				m++
			}
			if m == k {
				break
			}
			j += m
		}
		if j >= n {
			// No matching closing run: the backticks are literal text.
			seg.WriteString(string(runes[i : i+k]))
			i += k
			continue
		}
		flush()
		out.WriteString(trimCodeSpan(string(runes[i+k : j])))
		i = j + k
	}
	flush()
	return out.String()
}

// trimCodeSpan strips one leading and trailing space from a code span when both
// are present and the content is not all spaces, per CommonMark.
func trimCodeSpan(content string) string {
	if len(content) >= 2 && strings.HasPrefix(content, " ") && strings.HasSuffix(content, " ") && strings.TrimSpace(content) != "" {
		return content[1 : len(content)-1]
	}
	return content
}

// stripEmphasis unwraps links/images and removes emphasis/strikethrough
// delimiters from text that lies outside code spans. Strong is removed before
// emphasis so paired `**`/`__` are not mistaken for nested single delimiters.
func stripEmphasis(s string) string {
	s = mdImageRe.ReplaceAllString(s, "$1")
	s = mdLinkRe.ReplaceAllString(s, "$1")
	s = mdStrikeRe.ReplaceAllString(s, "$1")
	s = mdStrongStarRe.ReplaceAllString(s, "$1")
	s = mdStrongUnderRe.ReplaceAllString(s, "$1")
	s = mdEmStarRe.ReplaceAllString(s, "$1")
	s = mdEmUnderRe.ReplaceAllString(s, "${1}${2}${3}")
	return s
}
