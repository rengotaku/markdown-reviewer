import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

export type CopyableKind = "code" | "table";

export interface CopyableBlock {
  kind: CopyableKind;
  el: HTMLElement;
}

/**
 * The block whose copy button should be shown for a hovered element, or null.
 *
 * Mermaid blocks are excluded: they render as a `div` node view with their own
 * chart/source toggle, and the `pre` they show in source mode belongs to that
 * node view rather than to a markdown fence.
 */
export function findCopyableBlock(target: Element | null): CopyableBlock | null {
  if (!target) return null;
  const el = target.closest("pre, table");
  if (!(el instanceof HTMLElement)) return null;
  if (el.closest('[data-type="mermaid-block"]')) return null;
  return { kind: el.tagName === "TABLE" ? "table" : "code", el };
}

/** Raw text of a code block, without the highlight markup. */
export function codeTextOf(pre: HTMLElement): string {
  const code = pre.querySelector("code");
  return (code ?? pre).textContent ?? "";
}

interface MarkdownStorage {
  markdown?: { serializer?: { serialize: (content: unknown) => string } };
}

/**
 * Markdown source of the table containing `el`, or null if it can't be derived.
 *
 * Read back from the document rather than from the DOM: the rendered table has
 * no pipes, and re-deriving them from cells would drift from what a save
 * writes. `serialize` renders the *content* of what it is handed, so the node
 * goes in as a one-element Fragment to get the table itself, not just its rows.
 */
export function tableMarkdownOf(editor: Editor, el: HTMLElement): string | null {
  const node = tableNodeAt(editor, el);
  if (!node) return null;
  const serializer = (editor.storage as MarkdownStorage).markdown?.serializer;
  if (!serializer) return null;
  try {
    const markdown = serializer.serialize(Fragment.from(node)).trim();
    return markdown.length > 0 ? markdown : null;
  } catch {
    return null;
  }
}

function tableNodeAt(editor: Editor, el: HTMLElement): PMNode | null {
  let pos: number;
  try {
    pos = editor.view.posAtDOM(el, 0);
  } catch {
    return null;
  }
  if (pos < 0) return null;
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "table") return node;
  }
  return null;
}

/** Text to put on the clipboard for a block, or null when it can't be derived. */
export function copyTextOf(editor: Editor, block: CopyableBlock): string | null {
  if (block.kind === "code") {
    const text = codeTextOf(block.el);
    return text.length > 0 ? text : null;
  }
  return tableMarkdownOf(editor, block.el);
}
