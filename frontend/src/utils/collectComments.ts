import type { Editor } from "@tiptap/react";

export interface CollectedComment {
  id: string;
  author: string;
  date: string;
  target: string;
  body: string;
  from: number;
  to: number;
}

/**
 * Walk the editor doc and gather every comment-mark range as a CollectedComment.
 * Contiguous text nodes sharing the same comment id are merged.
 */
export function collectComments(editor: Editor | null): CollectedComment[] {
  if (!editor) return [];
  const markType = editor.schema.marks.comment;
  if (!markType) return [];

  const result: CollectedComment[] = [];
  let current: CollectedComment | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) {
      // Crossing a non-text node ends any in-progress span.
      if (current) {
        result.push(current);
        current = null;
      }
      return;
    }
    const mark = node.marks.find((m) => m.type === markType);
    if (!mark) {
      if (current) {
        result.push(current);
        current = null;
      }
      return;
    }
    const id = (mark.attrs.id as string | null) ?? "";
    const text = node.text ?? "";
    if (current && current.id === id && current.to === pos) {
      current = { ...current, body: current.body + text, to: pos + node.nodeSize };
      return;
    }
    if (current) {
      result.push(current);
    }
    current = {
      id,
      author: (mark.attrs.author as string | null) ?? "",
      date: (mark.attrs.date as string | null) ?? "",
      target: (mark.attrs.target as string | null) ?? "",
      body: text,
      from: pos,
      to: pos + node.nodeSize,
    };
  });

  if (current) result.push(current);
  return result;
}
