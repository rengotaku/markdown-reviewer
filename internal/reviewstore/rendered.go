package reviewstore

import (
	"bufio"
	"bytes"
	"html"
	"regexp"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	ghtml "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

// renderedDoc is the canonical content as the editor presents it, per source
// line: what anchors are matched against (#404).
//
// Anchors are authored from the editor's ProseMirror text — Markdown already
// rendered by markdown-it, a CommonMark parser — and resolved here against the
// raw file. The backend used to approximate "rendered" with one regex per
// syntax, and every syntax it did not cover orphaned comments the moment they
// were created (#163, #168, #205, #370, #404). Parsing with goldmark, another
// CommonMark implementation, removes that class instead of adding one more
// case: entities, escapes, emphasis, links, code spans and block structure
// are all interpreted by the spec rather than by us.
//
// The frontend fixture in testdata/anchor_conformance.json pins the two
// implementations together; see conformance_test.go.
type renderedDoc struct {
	// text[i] is line i's rendered text. Lines that belong to a paragraph,
	// heading or table row hold only their inline content (block markers such
	// as `- ` / `> ` / `#` and table pipes are gone, like in the editor); code
	// and raw HTML lines, and anything the parser leaves outside a text block,
	// hold the raw line, which is also what the editor shows for them.
	text []string
	// stacks[i] is the heading path in effect on line i, each entry carrying
	// its `#` prefix (`## 認証`). A heading's own lines include itself.
	stacks [][]string
}

var mdParser = goldmark.New(
	goldmark.WithExtensions(extension.Table, extension.Strikethrough, extension.Linkify, extension.TaskList),
).Parser()

// preambleRe matches the non-editable preamble the editor keeps out of the
// document (frontend/src/utils/frontmatter.ts splitPreamble): the AI hint
// comment, then an optional YAML frontmatter block. Its lines are never
// anchor targets in the editor, and parsing them as Markdown would turn
// `title: x` + `---` into a setext heading.
var (
	preambleFrontmatterRe = regexp.MustCompile(`\A---[ \t]*\r?\n(?s:.*?)\r?\n---[ \t]*(?:\r?\n|\z)`)
)

func preambleLen(content string) int {
	n := 0
	if loc := hintBlockRe.FindStringIndex(content); loc != nil {
		n = loc[1]
	}
	if loc := preambleFrontmatterRe.FindStringIndex(content[n:]); loc != nil {
		n += loc[1]
	}
	return n
}

// renderDoc parses content and returns its per-line rendered text and heading
// stacks. len(text) == len(stacks) == len(strings.Split(content, "\n")).
func renderDoc(content string) renderedDoc {
	lines := strings.Split(content, "\n")
	doc := renderedDoc{
		text:   append([]string(nil), lines...),
		stacks: make([][]string, len(lines)),
	}

	// Blank the preamble rather than slicing it off so byte offsets — and so
	// line numbers — stay those of the file.
	source := []byte(content)
	pre := preambleLen(content)
	for i := 0; i < pre; i++ {
		if source[i] != '\n' && source[i] != '\r' {
			source[i] = ' '
		}
	}

	lineStarts := []int{0}
	for i, b := range source {
		if b == '\n' {
			lineStarts = append(lineStarts, i+1)
		}
	}
	lineOf := func(offset int) int {
		return sort.Search(len(lineStarts), func(i int) bool { return lineStarts[i] > offset }) - 1
	}

	r := &lineRenderer{lineOf: lineOf, parts: map[int]*strings.Builder{}, source: source}
	root := mdParser.Parse(text.NewReader(source))

	type heading struct {
		text  string
		line  int
		level int
	}
	var headings []heading

	_ = ast.Walk(root, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *ast.Heading:
			first, inline := r.renderBlock(n)
			if first >= 0 {
				headings = append(headings, heading{text: strings.TrimSpace(inline), line: first, level: n.Level})
			}
			return ast.WalkSkipChildren, nil
		case *ast.Paragraph, *ast.TextBlock, *east.TableCell:
			r.renderBlock(n)
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})

	for line, b := range r.parts {
		doc.text[line] = collapseSpaces(b.String())
	}

	type entry struct {
		text  string
		level int
	}
	var stack []entry
	h := 0
	for i := range lines {
		for h < len(headings) && headings[h].line == i {
			for len(stack) > 0 && stack[len(stack)-1].level >= headings[h].level {
				stack = stack[:len(stack)-1]
			}
			stack = append(stack, entry{text: strings.Repeat("#", headings[h].level) + " " + headings[h].text, level: headings[h].level})
			h++
		}
		snap := make([]string, len(stack))
		for j, e := range stack {
			snap[j] = e.text
		}
		doc.stacks[i] = snap
	}
	return doc
}

// spaceRunRe matches what ProseMirror's DOM parser collapses to one space in
// non-preformatted content (its default whitespace handling). The editor's
// text therefore never has two spaces in a row outside code blocks, even
// inside code spans, and neither may ours.
var spaceRunRe = regexp.MustCompile(`[ \t\r\f]+`)

func collapseSpaces(s string) string { return spaceRunRe.ReplaceAllString(s, " ") }

// tableCellSep joins the cells of one table row on the row's line. A snippet
// is taken from a single cell, so the separator only has to be something a
// snippet never contains.
const tableCellSep = "\n"

// lineRenderer accumulates rendered inline text per source line.
type lineRenderer struct {
	lineOf func(offset int) int
	parts  map[int]*strings.Builder
	source []byte
}

func (r *lineRenderer) emit(line int, s string, cellStart bool) {
	b, ok := r.parts[line]
	if !ok {
		b = &strings.Builder{}
		r.parts[line] = b
	} else if cellStart {
		b.WriteString(tableCellSep)
	}
	b.WriteString(s)
}

// renderBlock writes n's inline content to the lines it comes from and
// returns the first line it touched (-1 when it has no content) together
// with its whole inline text.
func (r *lineRenderer) renderBlock(n ast.Node) (int, string) {
	_, isCell := n.(*east.TableCell)
	first := -1
	var all strings.Builder
	cellStart := isCell
	write := func(offset int, s string) {
		if s == "" {
			return
		}
		line := r.lineOf(offset)
		if first < 0 {
			first = line
		}
		r.emit(line, s, cellStart)
		cellStart = false
		all.WriteString(s)
	}
	if isCell && n.FirstChild() == nil {
		// An empty cell still separates its neighbours.
		if segs := n.Lines(); segs.Len() > 0 {
			write(segs.At(0).Start, "")
		}
	}
	r.inline(n, write)
	return first, all.String()
}

// inline walks n's inline children in document order, writing each piece of
// rendered text at the source offset it came from.
func (r *lineRenderer) inline(n ast.Node, write func(offset int, s string)) {
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch c := c.(type) {
		case *ast.Text:
			v := c.Segment.Value(r.source)
			if c.IsRaw() {
				write(c.Segment.Start, string(v))
			} else {
				write(c.Segment.Start, renderText(v))
			}
			// A soft line break separates two source lines, which are
			// matched separately; nothing to add.
		case *ast.String:
			off := r.offsetNear(c, nil)
			if c.IsCode() || c.IsRaw() {
				write(off, string(c.Value))
			} else {
				write(off, renderText(c.Value))
			}
		case *ast.CodeSpan:
			// Code span content is literal: no entity or escape processing.
			for t := c.FirstChild(); t != nil; t = t.NextSibling() {
				if tt, ok := t.(*ast.Text); ok {
					v := tt.Segment.Value(r.source)
					write(tt.Segment.Start, strings.TrimSuffix(string(v), "\n"))
				}
			}
		case *ast.AutoLink:
			label := c.Label(r.source)
			write(r.offsetNear(c, label), string(label))
		case *ast.RawHTML:
			// The editor keeps inline HTML as its source text (#297).
			for i := 0; i < c.Segments.Len(); i++ {
				seg := c.Segments.At(i)
				write(seg.Start, string(seg.Value(r.source)))
			}
		case *ast.Image:
			// The editor has no image node; an image contributes no text.
		case *east.TaskCheckBox:
			// Rendered as a checkbox, not text.
		default:
			r.inline(c, write)
		}
	}
}

// offsetNear returns the source offset of an inline node that carries no
// segment of its own (an autolink, a string): needle searched forward from the
// end of the nearest preceding text, or from the start of the enclosing block.
// Only the line the offset falls on matters.
func (r *lineRenderer) offsetNear(n ast.Node, needle []byte) int {
	lower := r.lowerBound(n)
	if len(needle) > 0 && lower <= len(r.source) {
		if i := bytes.Index(r.source[lower:], needle); i >= 0 {
			return lower + i
		}
	}
	return lower
}

func (r *lineRenderer) lowerBound(n ast.Node) int {
	for cur := n; cur != nil && cur.Type() != ast.TypeBlock; cur = cur.Parent() {
		for p := cur.PreviousSibling(); p != nil; p = p.PreviousSibling() {
			if t, ok := p.(*ast.Text); ok {
				return t.Segment.Stop
			}
		}
	}
	for p := n.Parent(); p != nil; p = p.Parent() {
		if p.Type() == ast.TypeBlock && p.Lines().Len() > 0 {
			return p.Lines().At(0).Start
		}
	}
	return 0
}

var textWriter = ghtml.NewWriter()

// renderText resolves backslash escapes and entity / numeric character
// references in a text run exactly the way goldmark's HTML renderer does,
// then undoes the HTML escaping that renderer adds, leaving the text a reader
// sees.
func renderText(v []byte) string {
	var buf bytes.Buffer
	w := bufio.NewWriter(&buf)
	textWriter.Write(w, v)
	_ = w.Flush()
	return html.UnescapeString(buf.String())
}

// RenderSnippet renders a snippet given as Markdown into the text the editor
// would show for it, the form anchors store. Used by `mr comment add` when
// the snippet does not resolve as given (#404): a caller copying from the raw
// file passes `&gt;` or `**x**`, which the rendered body never contains.
func RenderSnippet(s string) string {
	var parts []string
	for _, t := range renderDoc(s).text {
		if t = strings.TrimSpace(t); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " ")
}

// RenderHeading renders an ATX heading line (`## タイトル &gt; 1`) into the
// heading_path form (`## タイトル > 1`). ok=false when s does not parse as a
// heading.
func RenderHeading(s string) (string, bool) {
	stacks := renderDoc(strings.TrimSpace(s)).stacks
	if len(stacks) == 0 || len(stacks[0]) == 0 {
		return "", false
	}
	return stacks[0][len(stacks[0])-1], true
}
