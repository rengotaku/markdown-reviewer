package reviewstore

import "testing"

const hintTestBlock = "<!-- markdown-reviewer\nhint body\n-->\n\n"

func TestHintBlock_NoHint_ReturnsEmpty(t *testing.T) {
	if got := HintBlock("# Title\n\nbody\n"); got != "" {
		t.Fatalf("HintBlock() = %q, want empty", got)
	}
}

func TestHintBlock_PlainHeading_ReturnsHintOnly(t *testing.T) {
	content := hintTestBlock + "# Title\n\nbody\n"
	if got := HintBlock(content); got != hintTestBlock {
		t.Fatalf("HintBlock() = %q, want %q", got, hintTestBlock)
	}
}

// Regression (codex review, issue #282): hintBlockRe's trailing `\s*` used to
// be horizontal-whitespace-greedy, so reusing it for HintBlock swallowed a
// following indented line's leading spaces as if they belonged to the
// hint's own spacing — corrupting a restored body (a heading turning into
// what looks like an indented code block). HintBlock must stop at the blank
// line and leave the content line's indentation untouched.
func TestHintBlock_IndentedFirstLine_DoesNotEatIndentation(t *testing.T) {
	content := hintTestBlock + "    old_code()\n"
	got := HintBlock(content)
	if got != hintTestBlock {
		t.Fatalf("HintBlock() = %q, want %q (must not consume the code line's indentation)", got, hintTestBlock)
	}
	rest := content[len(got):]
	if rest != "    old_code()\n" {
		t.Fatalf("remaining content after HintBlock = %q, want the indented line untouched", rest)
	}
}

// Regression (codex review round 2, issue #282): StripAIHint shared the same
// indentation-eating bug HintBlock had (round 1 only fixed HintBlock's own
// copy). A revision snapshot taken right after a save must keep an indented
// first line intact, or restoring that snapshot later turns the code block
// into a plain paragraph.
func TestStripAIHint_IndentedFirstLine_DoesNotEatIndentation(t *testing.T) {
	content := hintTestBlock + "    old_code()\n"
	got := StripAIHint(content)
	want := "    old_code()\n"
	if got != want {
		t.Fatalf("StripAIHint() = %q, want %q (must not consume the code line's indentation)", got, want)
	}
}

func TestHintBlock_MultipleBlankLinesAfterHint_AllConsumed(t *testing.T) {
	content := "<!-- markdown-reviewer\nhint body\n-->\n\n\n# Title\n"
	got := HintBlock(content)
	want := "<!-- markdown-reviewer\nhint body\n-->\n\n\n"
	if got != want {
		t.Fatalf("HintBlock() = %q, want %q", got, want)
	}
}
