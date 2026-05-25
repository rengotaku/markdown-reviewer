import type { Editor } from "@tiptap/react";
import { DEFAULT_COMMENT_SCOPE, normalizeScope } from "@/utils/commentAttrs";

export interface CollectedComment {
  id: string;
  author: string;
  date: string;
  target: string;
  body: string;
  /** "inline" | "block" | "cross-section" | "global" */
  scope: string;
  /** Position of the first text node / standalone block carrying this comment. */
  from: number;
  /** Position right after the first range carrying this comment. */
  to: number;
}

/**
 * Walk the editor doc and gather every comment — both wrapping (Mark) and
 * standalone (Node) forms — preserving document order.
 *
 * Wrapping marks that share the same `id` across multiple blocks are merged
 * into one entry. ProseMirror Marks can't cross block boundaries, so a
 * `setMark` over a multi-paragraph selection becomes one Mark per block;
 * without this merge, the side pane would show duplicates.
 *
 * `from`/`to` are the **first** range — used for click-to-jump. All DOM
 * nodes for a given id receive `is-flash` via DOM queries elsewhere.
 */
export function collectComments(editor: Editor | null): CollectedComment[] {
  if (!editor || editor.isDestroyed) return [];
  const markType = editor.schema?.marks?.comment;
  const standaloneType = editor.schema?.nodes?.standaloneComment;
  if (!markType && !standaloneType) return [];

  const order: string[] = [];
  const byId = new Map<string, CollectedComment>();

  editor.state.doc.descendants((node, pos) => {
    if (standaloneType && node.type === standaloneType) {
      const id = (node.attrs.id as string | null) ?? "";
      if (byId.has(id)) return;
      const collected: CollectedComment = {
        id,
        author: (node.attrs.author as string | null) ?? "",
        date: (node.attrs.date as string | null) ?? "",
        target: "",
        body: (node.attrs.body as string | null) ?? "",
        scope: normalizeScope(node.attrs.scope as string | null),
        from: pos,
        to: pos + node.nodeSize,
      };
      byId.set(id, collected);
      order.push(id);
      return;
    }

    if (!node.isText || !markType) return;
    const mark = node.marks.find((m) => m.type === markType);
    if (!mark) return;

    const id = (mark.attrs.id as string | null) ?? "";
    const text = node.text ?? "";

    const existing = byId.get(id);
    if (existing) {
      existing.target += text;
      return;
    }

    const collected: CollectedComment = {
      id,
      author: (mark.attrs.author as string | null) ?? "",
      date: (mark.attrs.date as string | null) ?? "",
      target: text,
      body: (mark.attrs.body as string | null) ?? "",
      scope: normalizeScope(
        (mark.attrs.scope as string | null) ?? DEFAULT_COMMENT_SCOPE
      ),
      from: pos,
      to: pos + node.nodeSize,
    };
    byId.set(id, collected);
    order.push(id);
  });

  return order.map((id) => byId.get(id)!);
}
