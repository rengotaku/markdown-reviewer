import { Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Raw HTML round trip (#297).
 *
 * ProseMirror's schema has no node for raw HTML, so on load markdown-it's
 * `html_inline` / `html_block` tokens were turned into DOM and whatever the
 * schema didn't know was dropped (`topic.<name>` lost `<name>`, an HTML comment
 * vanished, `<br/>` became a hard break). Here the token's source is kept as
 * text — inline under the `rawHtml` mark, a block as a `rawHtmlBlock` — and
 * written back unchanged on save. Kept as text rather than as an atom holding
 * the source in an attribute, so every character still sits at its own
 * document position: comment anchors map text offsets to positions one to one
 * (utils/pmAnchor.ts), and the table serializer judges a cell empty by its
 * textContent. The editor shows the source rather than rendering it: this is a
 * review tool, and rendering arbitrary HTML from the file would be an XSS hole.
 */

interface MarkdownWriter {
  out: string;
  inTable?: boolean;
  write(text: string): void;
  text(text: string, escape?: boolean): void;
  closeBlock(node: PmNode): void;
  options: { escapeExtraCharacters?: RegExp };
}

interface MarkdownItToken {
  content: string;
}

interface MarkdownItLike {
  renderer: {
    rules: Record<string, (tokens: MarkdownItToken[], idx: number) => string>;
  };
  utils: { escapeHtml(value: string): string };
}

const INLINE_ATTR = "data-raw-html";
const BLOCK_ATTR = "data-raw-html-block";
export const RAW_HTML_MARK = "rawHtml";

/** The checkbox markdown-it-task-lists injects into a `- [ ]` item, itself as
 *  an `html_inline` token; tiptap-markdown's task item parses it from the DOM. */
const TASK_CHECKBOX = /^<input class="task-list-item-checkbox"/;

/** Render markdown-it's raw HTML tokens as escaped text inside the elements
 *  these extensions parse, instead of letting the HTML become DOM. */
function patchHtmlRenderer(md: MarkdownItLike) {
  const esc = md.utils.escapeHtml;
  md.renderer.rules.html_inline = (tokens, idx) => {
    const { content } = tokens[idx];
    if (TASK_CHECKBOX.test(content)) return content;
    return `<span ${INLINE_ATTR}="">${esc(content)}</span>`;
  };
  md.renderer.rules.html_block = (tokens, idx) =>
    `<pre ${BLOCK_ATTR}="">${esc(tokens[idx].content.replace(/\n+$/, ""))}</pre>\n`;
}

export const RawHtml = Mark.create({
  name: RAW_HTML_MARK,
  // Typing next to a tag is prose, not more of the tag.
  inclusive: false,
  // The source is literal: no emphasis, link or code inside it.
  excludes: "_",
  code: true,

  parseHTML() {
    return [{ tag: `span[${INLINE_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { [INLINE_ATTR]: "", class: "raw-html-inline" }), 0];
  },

  addStorage() {
    return {
      markdown: {
        // The text itself is written by MarkdownText, which sees the mark.
        serialize: { open: "", close: "" },
        parse: {
          setup(this: unknown, markdownit: MarkdownItLike) {
            patchHtmlRenderer(markdownit);
          },
        },
      },
    };
  },
});

export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  parseHTML() {
    // Ahead of the code block's own `pre` rule.
    return [{ tag: `pre[${BLOCK_ATTR}]`, preserveWhitespace: "full", priority: 60 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["pre", mergeAttributes(HTMLAttributes, { [BLOCK_ATTR]: "", class: "raw-html-block" }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          // `text` (not `write`) so each line gets the enclosing blockquote's
          // "> " or list item's indent, as a code block's lines do.
          state.text(node.textContent, false);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/** `<` that would open a tag, comment or declaration, and `&` that would start
 *  a character reference — both read back as something other than the text. */
const READ_BACK_AS_MARKUP = /<(?=[A-Za-z/!?])|&(?=#?[A-Za-z0-9]+;)/g;
/** The same, plus a `>` that begins an output line and would open a quote. */
const READ_BACK_AS_MARKUP_AT_LINE_START = /^>|<(?=[A-Za-z/!?])|&(?=#?[A-Za-z0-9]+;)/g;

/**
 * Text, with the serializer #297 needs. tiptap-markdown's own turns every `<`
 * / `>` into `&lt;` / `&gt;`, so `1 < 2` came back as `1 &lt; 2`. Here `<`, `&`
 * and `>` are written as themselves unless they would be read back as markup,
 * and then escaped the CommonMark way (`\<`). A `>` at the start of a block is
 * already escaped by the serializer's own line-start rules; one right after a
 * hard break starts an output line it does not know about, so that case is
 * handled here. Text under the `rawHtml` mark is written verbatim, except for
 * `|` inside a table, which would split the cell.
 *
 * The same node as @tiptap/extension-text (which StarterKit bundles but does
 * not export); StarterKit's own is turned off where this is registered.
 */
export const MarkdownText = Node.create({
  name: "text",
  group: "inline",

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          const text = node.text ?? "";
          if (node.marks.some((m) => m.type.name === RAW_HTML_MARK)) {
            state.text(state.inTable ? text.replace(/\|/g, "\\|") : text, false);
            return;
          }
          const prev = state.options.escapeExtraCharacters;
          state.options.escapeExtraCharacters = state.out.endsWith("\n")
            ? READ_BACK_AS_MARKUP_AT_LINE_START
            : READ_BACK_AS_MARKUP;
          try {
            state.text(text);
          } finally {
            state.options.escapeExtraCharacters = prev;
          }
        },
      },
    };
  },
});
