import { Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidBlockView } from "./MermaidBlockView";

/** Fence info string that marks a code block as a mermaid diagram. */
export const MERMAID_LANGUAGE = "mermaid";

/** Source inserted by the slash command / used when an attribute is missing. */
export const DEFAULT_MERMAID_CODE = "graph TD\n    A[Start] --> B[End]";

/**
 * Structural subset of prosemirror-markdown's MarkdownSerializerState that the
 * markdown spec below uses. Declared locally so the extension doesn't take a
 * direct dependency on tiptap-markdown's transitive packages.
 */
interface MarkdownWriter {
  write(content: string): void;
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: PmNode): void;
}

/**
 * mermaidCodeFromPre returns the diagram source of a markdown-it rendered
 * mermaid fence (`<pre><code class="language-mermaid">…</code></pre>`), or null
 * when the `<pre>` is an ordinary code block that must stay a `codeBlock`.
 *
 * markdown-it always terminates fence content with exactly one newline; that
 * one is dropped so the stored source matches what the author typed. Only one —
 * stripping every trailing newline would silently delete blank lines the author
 * put at the end of the diagram source.
 */
export function mermaidCodeFromPre(pre: HTMLElement): string | null {
  const code = pre.querySelector(`code.language-${MERMAID_LANGUAGE}`);
  if (!code) return null;
  return (code.textContent ?? "").replace(/\n$/, "");
}

/** Fence token shape and the markdown-it surface the parse hook below needs. */
interface FenceToken {
  info: string;
  content: string;
}
type FenceRule = (
  tokens: FenceToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown
) => string;
interface MarkdownItLike {
  renderer: { rules: Record<string, FenceRule | undefined> };
  utils: { escapeHtml: (input: string) => string };
  [PATCH_FLAG]?: boolean;
}

/** Marks an already-patched markdown-it instance (parse.setup runs per parse). */
const PATCH_FLAG = "__mermaidFencePatched";

/** The language of a fence is the first word of its info string. */
function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0] ?? "";
}

/**
 * patchFenceRenderer makes markdown-it emit mermaid fences directly as the
 * node's HTML shape, carrying the source in `data-code`.
 *
 * Going through `<pre><code class="language-mermaid">` would work too, but
 * tiptap-markdown wraps the default fence renderer in a "strip the last
 * newline" helper, which eats a blank line the author left at the end of the
 * diagram source — the file would then lose that line on the next save. Reading
 * `token.content` here keeps the source byte-exact apart from markdown-it's own
 * single terminating newline.
 */
function patchFenceRenderer(md: MarkdownItLike): void {
  if (md[PATCH_FLAG]) return;
  md[PATCH_FLAG] = true;

  const previous = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (fenceLanguage(token.info) === MERMAID_LANGUAGE) {
      const code = token.content.replace(/\n$/, "");
      return `<div data-type="mermaid-block" data-code="${md.utils.escapeHtml(code)}"></div>`;
    }
    return previous ? previous(tokens, idx, options, env, self) : "";
  };
}

/**
 * fenceFor returns a backtick fence long enough to wrap `code` verbatim — at
 * least three, and always one longer than the longest backtick run inside the
 * source (mirrors prosemirror-markdown's code_block serializer).
 */
export function fenceFor(code: string): string {
  const longest = (code.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      code: {
        default: DEFAULT_MERMAID_CODE,
        // Returning null (not "") when the attribute is absent matters: TipTap
        // merges attribute-level parseHTML *over* the parse rule's getAttrs, so
        // a non-null value here would clobber the source read off a fence.
        parseHTML: (element) => element.getAttribute("data-code"),
        renderHTML: (attributes) => ({ "data-code": attributes.code }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="mermaid-block"]' },
      {
        // Mermaid fences arriving as rendered HTML (pasted from a browser, or
        // any producer that isn't our own markdown-it hook). Claimed before
        // StarterKit's CodeBlock, whose `pre` rule sits at the default priority
        // 50; getAttrs returns false for every other `<pre>`, so ordinary code
        // blocks still fall through to codeBlock.
        tag: "pre",
        priority: 60,
        getAttrs: (element) => {
          const code = mermaidCodeFromPre(element as HTMLElement);
          return code === null ? false : { code };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "mermaid-block" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView);
  },

  /**
   * Markdown bridge (issue #189). Without it tiptap-markdown falls back to its
   * generic HTML-node handling and writes `<div data-type="mermaid-block" …>`
   * into the saved file — invalid Markdown that also loses the source on
   * reload. On the way in, `parse.setup` teaches markdown-it to render mermaid
   * fences as this node's HTML shape (see patchFenceRenderer).
   */
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          const code = String(node.attrs.code ?? "");
          const fence = fenceFor(code);
          state.write(`${fence}${MERMAID_LANGUAGE}\n`);
          // escape=false keeps the source literal; `text` still re-applies the
          // active block delimiter per line (blockquote "> ", list indent, …).
          // The appended newline terminates the last source line — appending it
          // unconditionally (rather than ensureNewLine) is what keeps a trailing
          // blank line in the source from collapsing on the way out.
          if (code) state.text(`${code}\n`, false);
          state.write(fence);
          state.closeBlock(node);
        },
        parse: {
          setup(this: unknown, markdownit: MarkdownItLike) {
            patchFenceRenderer(markdownit);
          },
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const mermaidBlockType = this.type;

    return [
      new Plugin({
        key: new PluginKey("mermaidPasteHandler"),
        props: {
          // Safety net for ProseMirror-native clipboard content (copied from
          // another editor instance) that arrives as a codeBlock rather than
          // as HTML: markdown text pastes already go through parseHTML.
          transformPasted(slice) {
            const nodes: PmNode[] = [];
            slice.content.forEach((node) => {
              if (
                node.type.name === "codeBlock" &&
                node.attrs.language === MERMAID_LANGUAGE
              ) {
                nodes.push(mermaidBlockType.create({ code: node.textContent }));
              } else {
                nodes.push(node);
              }
            });

            return new Slice(Fragment.from(nodes), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});
