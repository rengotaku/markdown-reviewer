import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { splitPreamble } from "@/utils/frontmatter";

/**
 * Parser used only to locate headings. Kept separate from the editor's own
 * pipeline: this needs CommonMark block structure, nothing else.
 */
const md = new MarkdownIt();

/**
 * Visible text of an inline token: what the heading reads as once rendered.
 * Link/emphasis/code markup contributes its text and drops its syntax, an
 * image contributes its alt text, and a line break becomes a space.
 */
function inlineText(token: Token | undefined): string {
  return (token?.children ?? [])
    .map((c) => {
      // A line break inside a multi-line setext heading is a space on screen.
      if (c.type === "softbreak" || c.type === "hardbreak") return " ";
      if (c.type === "text" || c.type === "code_inline" || c.type === "image") {
        return c.content;
      }
      return "";
    })
    .join("")
    .trim();
}

/**
 * Text of the document's first h1, or null when it has none.
 *
 * "First" is literal: a document with several h1s is named by the one nearest
 * the top, which is the one a reader sees first (#247). The AI hint and YAML
 * frontmatter are peeled off first so a `#` inside them is never mistaken for
 * the document's heading — everything after that is CommonMark, so it is
 * markdown-it that decides what counts as a heading (a `#` inside a code
 * block or an indented line does not).
 */
export function firstH1(raw: string): string | null {
  const { body } = splitPreamble(raw);
  const tokens = md.parse(body, {});

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== "heading_open" || tokens[i].tag !== "h1") continue;
    const text = inlineText(tokens[i + 1]);
    if (text) return text;
  }

  return null;
}
