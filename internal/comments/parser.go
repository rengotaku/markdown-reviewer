// Package comments parses `@comment` markers out of a raw markdown source
// and returns them as AI-facing structured entries.
//
// The on-disk comment format (mirrored from frontend/src/utils/commentAttrs.ts):
//
//	wrapped (inline / block):
//	  <!-- @comment id="..." author="..." date="..." body="..." [scope="block"]
//	       [group_id="..."] -->wrap text<!-- /@comment -->
//	standalone (global / legacy cross-section):
//	  <!-- @comment id="..." ... scope="global" -->
//	  <!-- @comment id="..." ... target="..." scope="cross-section" -->
//
// Grouping: multiple `scope="block"` markers sharing the same `group_id`
// represent a single cross-section review note replicated across several
// sections — they collapse into one Comment with `scope="cross_section"`
// and a Members slice. This collapse is the main reason a raw grep is not
// enough for AI consumers.
package comments

import (
	"regexp"
	"sort"
	"strings"
)

// Comment is one logical review note in the file.
//
// For grouped cross-section entries Context is nil (the group has no single
// position) and Members carries one entry per section. For inline / block /
// global entries Members is empty.
type Comment struct {
	ID          string   `json:"id"`
	Author      string   `json:"author,omitempty"`
	Date        string   `json:"date,omitempty"`
	Scope       string   `json:"scope"`
	GroupID     string   `json:"group_id,omitempty"`
	Body        string   `json:"body"`
	WrappedText string   `json:"wrapped_text,omitempty"`
	Context     *Context `json:"context"`
	Members     []Member `json:"members,omitempty"`
}

// Context locates a comment inside the file. HeadingPath is the stack of
// headings the comment appears under (each element keeps its `##` prefix so
// the level is obvious). LineRange is 1-indexed and inclusive at both ends.
type Context struct {
	HeadingPath []string `json:"heading_path"`
	LineRange   [2]int   `json:"line_range"`
}

// Member is one section covered by a grouped cross-section comment.
type Member struct {
	WrappedText string  `json:"wrapped_text"`
	Context     Context `json:"context"`
}

// Summary is the count breakdown returned alongside the comment list.
//
// Field order: map (pointer) before int to keep govet's fieldalignment happy.
type Summary struct {
	ByScope map[string]int `json:"by_scope"`
	Total   int            `json:"total"`
}

var (
	// openMarkerRe matches `<!-- @comment ATTRS -->`. The `(?s)` flag lets
	// `.` cross newlines so a marker whose body attr contains an escaped
	// `\n` (which is fine — body never holds a raw newline) still parses;
	// `--` never appears unescaped in an attribute value so the lazy
	// `.+?` cannot overshoot the intended closing `-->`.
	openMarkerRe  = regexp.MustCompile(`(?s)<!--\s*@comment\s+(.+?)\s*-->`)
	closeMarkerRe = regexp.MustCompile(`<!--\s*/@comment\s*-->`)
	attrRe        = regexp.MustCompile(`(\w+)\s*=\s*"((?:\\.|[^"\\])*)"`)
	headingRe     = regexp.MustCompile(`^(#{1,6})\s+(.+?)\s*$`)
)

type marker struct {
	attrs    map[string]string
	startPos int // byte offset of `<`
	endPos   int // byte offset just past `>`
	line     int // 1-indexed
	isOpen   bool
}

type rawComment struct {
	id          string
	author      string
	date        string
	scope       string // raw scope from disk (empty == inline)
	groupID     string
	target      string
	body        string
	wrappedText string
	openLine    int
	closeLine   int
}

// Parse extracts all `@comment` markers from content and returns the
// structured comments together with a summary.
func Parse(content string) ([]Comment, Summary) {
	markers := collectMarkers(content)
	raws := pairMarkers(content, markers)
	stacks := computeHeadingStacks(content)

	indexed := assemble(raws, stacks)
	sort.SliceStable(indexed, func(i, j int) bool {
		return indexed[i].sortLine < indexed[j].sortLine
	})

	out := make([]Comment, len(indexed))
	sum := Summary{Total: len(indexed), ByScope: map[string]int{}}
	for i, idx := range indexed {
		out[i] = idx.c
		sum.ByScope[idx.c.Scope]++
	}
	return out, sum
}

// indexedComment carries the source-order line used for stable sorting.
// We can't lean on Comment.Context for that — global entries have nil
// context by design, so their original line would be lost.
type indexedComment struct {
	c        Comment
	sortLine int
}

func collectMarkers(content string) []marker {
	var ms []marker
	for _, idx := range openMarkerRe.FindAllStringSubmatchIndex(content, -1) {
		raw := content[idx[2]:idx[3]]
		ms = append(ms, marker{
			isOpen:   true,
			attrs:    parseAttrs(raw),
			startPos: idx[0],
			endPos:   idx[1],
		})
	}
	for _, idx := range closeMarkerRe.FindAllStringIndex(content, -1) {
		ms = append(ms, marker{
			isOpen:   false,
			startPos: idx[0],
			endPos:   idx[1],
		})
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].startPos < ms[j].startPos })
	// Stamp line numbers in one linear pass over content.
	line := 1
	pos := 0
	for i := range ms {
		for pos < ms[i].startPos {
			if content[pos] == '\n' {
				line++
			}
			pos++
		}
		ms[i].line = line
	}
	return ms
}

func pairMarkers(content string, markers []marker) []rawComment {
	var out []rawComment
	for i := 0; i < len(markers); i++ {
		m := markers[i]
		if !m.isOpen {
			// Orphan close — skip silently. Realistic only when the file
			// is mid-edit; surfacing it would be more noise than help.
			continue
		}
		scope := m.attrs["scope"]
		raw := rawComment{
			id:        m.attrs["id"],
			author:    m.attrs["author"],
			date:      m.attrs["date"],
			scope:     scope,
			groupID:   m.attrs["group_id"],
			target:    m.attrs["target"],
			body:      m.attrs["body"],
			openLine:  m.line,
			closeLine: m.line,
		}
		if isStandaloneScope(scope) {
			out = append(out, raw)
			continue
		}
		// Wrapped (inline / block / grouped block): consume the next close marker.
		closeIdx := -1
		for j := i + 1; j < len(markers); j++ {
			if !markers[j].isOpen {
				closeIdx = j
				break
			}
		}
		if closeIdx < 0 {
			// No close in file — keep what we have as standalone-ish; the
			// wrap text is unknown so leave it empty.
			out = append(out, raw)
			continue
		}
		raw.wrappedText = content[m.endPos:markers[closeIdx].startPos]
		raw.closeLine = markers[closeIdx].line
		out = append(out, raw)
		// Mark the close consumed by jumping past it.
		i = closeIdx
	}
	return out
}

func assemble(raws []rawComment, stacks [][]string) []indexedComment {
	groups := map[string][]rawComment{} // by group_id (grouped cross-section)
	byID := map[string][]rawComment{}   // by id (same-id splits across blocks)
	idOrder := []string{}               // first-seen order for stable output
	for _, r := range raws {
		if r.groupID != "" && !isStandaloneScope(r.scope) {
			groups[r.groupID] = append(groups[r.groupID], r)
			continue
		}
		if _, seen := byID[r.id]; !seen {
			idOrder = append(idOrder, r.id)
		}
		byID[r.id] = append(byID[r.id], r)
	}

	var out []indexedComment
	for _, id := range idOrder {
		out = append(out, indexedComment{
			sortLine: byID[id][0].openLine,
			c:        mergeSameID(byID[id], stacks),
		})
	}
	for gid, members := range groups {
		sort.SliceStable(members, func(i, j int) bool {
			return members[i].openLine < members[j].openLine
		})
		first := members[0]
		c := Comment{
			ID:      first.id,
			Author:  first.author,
			Date:    first.date,
			Scope:   "cross_section",
			GroupID: gid,
			Body:    first.body,
		}
		for _, m := range members {
			ctx := buildContext(m.openLine, m.closeLine, stacks)
			c.Members = append(c.Members, Member{
				WrappedText: m.wrappedText,
				Context:     *ctx,
			})
		}
		out = append(out, indexedComment{sortLine: first.openLine, c: c})
	}
	return out
}

// mergeSameID collapses entries sharing the same id into a single Comment.
// The ProseMirror editor on the frontend cannot keep one Mark across block
// boundaries, so a multi-paragraph selection is persisted as N markers
// sharing id/body/author/date. Treat them as one logical comment with N
// fragments, matching what frontend/src/utils/collectComments.ts does.
func mergeSameID(raws []rawComment, stacks [][]string) Comment {
	if len(raws) == 1 {
		return toSoloComment(raws[0], stacks)
	}
	sort.SliceStable(raws, func(i, j int) bool {
		return raws[i].openLine < raws[j].openLine
	})
	first := raws[0]
	scope := first.scope
	if scope == "" {
		scope = "inline"
	}
	c := Comment{
		ID: first.id, Author: first.author, Date: first.date,
		Scope: scope, Body: first.body,
	}
	for _, r := range raws {
		ctx := buildContext(r.openLine, r.closeLine, stacks)
		c.Members = append(c.Members, Member{
			WrappedText: r.wrappedText,
			Context:     *ctx,
		})
	}
	return c
}

func toSoloComment(r rawComment, stacks [][]string) Comment {
	switch r.scope {
	case "global":
		return Comment{
			ID: r.id, Author: r.author, Date: r.date,
			Scope: "global", Body: r.body, Context: nil,
		}
	case "cross-section":
		// Legacy standalone form. Surface as cross_section (matching the
		// new-style group) but expose the joined section titles via
		// WrappedText so AI consumers see what it points at.
		c := Comment{
			ID: r.id, Author: r.author, Date: r.date,
			Scope: "cross_section", Body: r.body,
			Context: buildContext(r.openLine, r.openLine, stacks),
		}
		if r.target != "" {
			c.WrappedText = r.target
		}
		return c
	}
	scope := r.scope
	if scope == "" {
		scope = "inline"
	}
	return Comment{
		ID: r.id, Author: r.author, Date: r.date,
		Scope: scope, Body: r.body,
		WrappedText: r.wrappedText,
		Context:     buildContext(r.openLine, r.closeLine, stacks),
	}
}

func buildContext(openLine, closeLine int, stacks [][]string) *Context {
	var path []string
	if openLine >= 0 && openLine < len(stacks) {
		path = append([]string(nil), stacks[openLine]...)
	}
	return &Context{
		HeadingPath: path,
		LineRange:   [2]int{openLine, closeLine},
	}
}

type headingEntry struct {
	text  string
	level int
}

// computeHeadingStacks returns, for each 1-indexed line, the heading stack
// in effect after that line has been processed. Index 0 is unused and
// returned as a nil slice for convenience.
func computeHeadingStacks(content string) [][]string {
	lines := strings.Split(content, "\n")
	out := make([][]string, len(lines)+1)
	out[0] = nil
	var stack []headingEntry
	for i, line := range lines {
		rendered := stripMarkers(line)
		if m := headingRe.FindStringSubmatch(strings.TrimSpace(rendered)); m != nil {
			level := len(m[1])
			text := m[1] + " " + strings.TrimSpace(m[2])
			for len(stack) > 0 && stack[len(stack)-1].level >= level {
				stack = stack[:len(stack)-1]
			}
			stack = append(stack, headingEntry{level: level, text: text})
		}
		snap := make([]string, len(stack))
		for j, e := range stack {
			snap[j] = e.text
		}
		out[i+1] = snap
	}
	return out
}

func stripMarkers(line string) string {
	line = openMarkerRe.ReplaceAllString(line, "")
	line = closeMarkerRe.ReplaceAllString(line, "")
	return line
}

func parseAttrs(s string) map[string]string {
	out := map[string]string{}
	for _, m := range attrRe.FindAllStringSubmatch(s, -1) {
		out[m[1]] = unescapeAttr(m[2])
	}
	return out
}

// unescapeAttr is the inverse of the escape pipeline in
// frontend/src/utils/commentAttrs.ts. Order matters: undo `--` first so the
// trailing `\` doesn't accidentally consume an adjacent escape.
func unescapeAttr(v string) string {
	v = strings.ReplaceAll(v, `\-\-`, `--`)
	v = strings.ReplaceAll(v, `\n`, "\n")
	v = strings.ReplaceAll(v, `\"`, `"`)
	v = strings.ReplaceAll(v, `\\`, `\`)
	return v
}

func isStandaloneScope(scope string) bool {
	return scope == "global" || scope == "cross-section"
}
