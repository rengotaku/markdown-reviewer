import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Raw HTML round trip (#297).
 *
 * ProseMirror's schema has no node for raw HTML, so on load markdown-it's
 * `html_inline` / `html_block` tokens were turned into DOM and whatever the
 * schema didn't know was dropped (`topic.<name>` lost `<name>`, an HTML comment
 * vanished, `<br/>` became a hard break). These two nodes keep the token's
 * source verbatim and write it back unchanged on save. The editor shows that
 * source as text rather than rendering it: this is a review tool, and
 * rendering arbitrary HTML from the file would be an XSS hole.
 */

interface MarkdownWriter {
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

/** The checkbox markdown-it-task-lists injects into a `- [ ]` item, itself as
 *  an `html_inline` token; tiptap-markdown's task item parses it from the DOM. */
const TASK_CHECKBOX = /^<input class="task-list-item-checkbox"/;

/** Render markdown-it's raw HTML tokens as the placeholders these nodes parse,
 *  carrying the source in an attribute instead of letting it become DOM. */
function patchHtmlRenderer(md: MarkdownItLike) {
  const esc = md.utils.escapeHtml;
  md.renderer.rules.html_inline = (tokens, idx) => {
    const { content } = tokens[idx];
    if (TASK_CHECKBOX.test(content)) return content;
    return `<span ${INLINE_ATTR}="${esc(content)}"></span>`;
  };
  md.renderer.rules.html_block = (tokens, idx) =>
    `<div ${BLOCK_ATTR}="${esc(tokens[idx].content.replace(/\n+$/, ""))}"></div>\n`;
}

export const RawHtmlInline = Node.create({
  name: "rawHtmlInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (el) => el.getAttribute(INLINE_ATTR) ?? "",
        renderHTML: (attrs) => ({ [INLINE_ATTR]: attrs.raw }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${INLINE_ATTR}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "raw-html-inline", contenteditable: "false" }),
      String(node.attrs.raw),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.raw);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          state.write(String(node.attrs.raw));
        },
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
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (el) => el.getAttribute(BLOCK_ATTR) ?? "",
        renderHTML: (attrs) => ({ [BLOCK_ATTR]: attrs.raw }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[${BLOCK_ATTR}]` }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "raw-html-block", contenteditable: "false" }),
      String(node.attrs.raw),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.raw);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          state.write(String(node.attrs.raw));
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/** `<` followed by what would open a tag, a comment or a declaration. */
const TAG_START = /<(?=[A-Za-z/!?])/g;

/**
 * Text that writes `<` and `>` as themselves (#297). tiptap-markdown's own
 * text serializer turns every `<` / `>` into `&lt;` / `&gt;`, so `1 < 2` came
 * back as `1 &lt; 2`. Only a `<` that would be read back as the start of a tag
 * is escaped, and the CommonMark way (`\<`); a `>` that would start a
 * blockquote is already escaped by the serializer's line-start rules.
 */
export const MarkdownText = Node.create({
  // The same node as @tiptap/extension-text (which StarterKit bundles but does
  // not export), plus the serializer. StarterKit's own is turned off where
  // this is registered (`text: false`).
  name: "text",
  group: "inline",

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          const prev = state.options.escapeExtraCharacters;
          state.options.escapeExtraCharacters = TAG_START;
          try {
            state.text(node.text ?? "");
          } finally {
            state.options.escapeExtraCharacters = prev;
          }
        },
      },
    };
  },
});
