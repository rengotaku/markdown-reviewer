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
 * markdown-it always terminates fence content with a newline; it is dropped so
 * the stored source matches what the author typed (and what we serialize back).
 */
export function mermaidCodeFromPre(pre: HTMLElement): string | null {
  const code = pre.querySelector(`code.language-${MERMAID_LANGUAGE}`);
  if (!code) return null;
  return (code.textContent ?? "").replace(/\n+$/, "");
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
        // Claim mermaid fences before StarterKit's CodeBlock (whose `pre` rule
        // sits at the default priority 50). getAttrs returns false for every
        // other `<pre>`, so ordinary code blocks fall through to codeBlock.
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
   * reload. Parsing needs no markdown-it setup: the fence is already rendered
   * as `<pre><code class="language-mermaid">`, which the parse rule above
   * turns into this node.
   */
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriter, node: PmNode) {
          const code = String(node.attrs.code ?? "").replace(/\n+$/, "");
          const fence = fenceFor(code);
          state.write(`${fence}${MERMAID_LANGUAGE}\n`);
          // escape=false keeps the source literal; `text` still re-applies the
          // active block delimiter per line (blockquote "> ", list indent, …).
          if (code) state.text(code, false);
          state.ensureNewLine();
          state.write(fence);
          state.closeBlock(node);
        },
        parse: {
          // handled by the `pre` parse rule above
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
