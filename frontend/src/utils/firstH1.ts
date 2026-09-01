import { splitPreamble } from "@/utils/frontmatter";

/** Opening or closing line of a fenced code block (``` or ~~~). */
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
/** ATX h1: a single leading `#`, and nothing but `#`s for the optional closer. */
const ATX_H1_RE = /^\s{0,3}#[ \t]+(.*?)[ \t]*#*[ \t]*$/;
/** Setext h1 underline: a run of `=` under a non-empty line. */
const SETEXT_H1_RE = /^\s{0,3}=+[ \t]*$/;

/**
 * Strip the inline markdown a heading can carry so the title reads as plain
 * text: `**x**` / `*x*` / `` `x` `` / `[t](u)` / `![t](u)` all collapse to
 * their visible text, the same way the rendered heading shows them.
 */
function toPlainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .trim();
}

/**
 * Text of the document's first h1, or null when it has none.
 *
 * "First" is literal: a document with several h1s is named by the one nearest
 * the top, which is the one a reader sees first (#247). The AI hint and YAML
 * frontmatter are peeled off first so a `#` inside them is never mistaken for
 * the document's heading, and fenced code blocks are skipped so a shell
 * comment (`# do the thing`) cannot become the title.
 */
export function firstH1(raw: string): string | null {
  const { body } = splitPreamble(raw);
  const lines = body.split(/\r?\n/);
  let fence: string | null = null;
  let prev = "";

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fence) {
      // Only a fence of the same kind and at least the same length closes it.
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      prev = "";
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      prev = "";
      continue;
    }

    const atx = line.match(ATX_H1_RE);
    if (atx) {
      const text = toPlainText(atx[1]);
      if (text) return text;
      prev = "";
      continue;
    }

    // A setext underline names the line above it, so it can only be a heading
    // when that line held text (and wasn't itself a heading or a list item).
    if (prev.trim() && SETEXT_H1_RE.test(line)) {
      const text = toPlainText(prev);
      if (text) return text;
    }
    prev = /^\s{0,3}(#|[-*+>]|\d+[.)])[ \t]/.test(line) ? "" : line;
  }

  return null;
}
