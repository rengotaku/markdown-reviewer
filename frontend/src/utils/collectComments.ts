import type { Editor } from "@tiptap/react";

export interface CollectedComment {
  id: string;
  author: string;
  date: string;
  target: string;
  body: string;
  /** Position of the first text node carrying this comment mark. */
  from: number;
  /** Position right after the first text node carrying this comment mark. */
  to: number;
}

/**
 * Walk the editor doc and gather every comment-mark text node, merging
 * marks that share the same `id` even when they span multiple blocks.
 *
 * Background: ProseMirror Marks cannot cross block boundaries — a `setMark`
 * over a multi-paragraph selection is materialized as one Mark per block.
 * Naïvely emitting one CollectedComment per text run produces a duplicate
 * entry per block in the side pane. This function merges by `id` so the UI
 * sees one logical comment regardless of how many blocks it spans.
 *
 * `from`/`to` are the **first** mark range — used for click-to-jump. All
 * blocks for a given id receive `is-flash` via DOM queries elsewhere.
 */
export function collectComments(editor: Editor | null): CollectedComment[] {
  if (!editor || editor.isDestroyed) return [];
  const markType = editor.schema?.marks?.comment;
  if (!markType) return [];

  const order: string[] = [];
  const byId = new Map<string, CollectedComment>();

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type === markType);
    if (!mark) return;

    const id = (mark.attrs.id as string | null) ?? "";
    const text = node.text ?? "";

    const existing = byId.get(id);
    if (existing) {
      // Append the additional wrapped text to the target so the side pane
      // shows the full snippet covered by the comment.
      existing.target += text;
      return;
    }

    const collected: CollectedComment = {
      id,
      author: (mark.attrs.author as string | null) ?? "",
      date: (mark.attrs.date as string | null) ?? "",
      target: text,
      body: (mark.attrs.body as string | null) ?? "",
      from: pos,
      to: pos + node.nodeSize,
    };
    byId.set(id, collected);
    order.push(id);
  });

  return order.map((id) => byId.get(id)!);
}
