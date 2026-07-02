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

// Anchor locates a comment inside the clean canonical markdown by content,
// not by position — the canonical file carries no review markers (#50). On
// load the snippet is searched under heading_path; the occurrence index
// disambiguates identical snippets. A miss yields an orphan (honest failure)
// rather than a silent mis-anchor.
type Anchor struct {
	Snippet     string   `json:"snippet"`
	HeadingPath []string `json:"heading_path"`
	Occurrence  int      `json:"occurrence"`
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

var anchorHeadingRe = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)

// ResolveAnchor finds the 1-indexed line range of an anchor in the canonical
// content. It searches for the snippet under a matching heading path, picking
// the Occurrence-th match. ok=false means the anchor is orphaned (snippet not
// found / heading renamed) — the caller surfaces it as an orphan rather than
// guessing a location.
func ResolveAnchor(content string, a Anchor) (lineRange [2]int, ok bool) {
	if a.Snippet == "" {
		return [2]int{}, false
	}
	stacks := headingStacks(content)
	lines := strings.Split(content, "\n")
	seen := 0
	for i, line := range lines {
		// Snippet/heading_path are authored from the frontend's ProseMirror
		// textContent, which renders inline marks away. Strip the same marks
		// here so a code span / emphasis in the canonical line still matches.
		if !strings.Contains(stripInlineMarkup(line), a.Snippet) {
			continue
		}
		if len(a.HeadingPath) > 0 && !headingSuffixMatch(stacks[i], a.HeadingPath) {
			continue
		}
		if seen == a.Occurrence {
			return [2]int{i + 1, i + 1}, true
		}
		seen++
	}
	return [2]int{}, false
}

// headingStacks returns, for each 0-indexed line, the heading stack in effect
// on that line (each element keeps its `#` prefix so the level is explicit).
func headingStacks(content string) [][]string {
	lines := strings.Split(content, "\n")
	out := make([][]string, len(lines))
	type entry struct {
		text  string
		level int
	}
	var stack []entry
	for i, line := range lines {
		if m := anchorHeadingRe.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			level := len(m[1])
			for len(stack) > 0 && stack[len(stack)-1].level >= level {
				stack = stack[:len(stack)-1]
			}
			stack = append(stack, entry{text: m[1] + " " + stripInlineMarkup(strings.TrimSpace(m[2])), level: level})
		}
		snap := make([]string, len(stack))
		for j, e := range stack {
			snap[j] = e.text
		}
		out[i] = snap
	}
	return out
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
func stripInlineMarkup(s string) string {
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
