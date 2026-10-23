import { Fragment } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

interface MarkdownStorage {
  markdown?: { serializer?: { serialize: (content: unknown) => string } };
}

/**
 * The current selection as Markdown, for the selection menu's "コピー" (#199),
 * or null when nothing is selected.
 *
 * The browser's own copy puts rendered text on the clipboard, which drops the
 * syntax a review is about (emphasis, links, list markers, table pipes). This
 * serializes the selected slice the way a save would. A selection inside a
 * single code block is copied verbatim instead: as Markdown it would come out
 * as a paragraph with `*`, `_` and the like escaped. Falls back to plain text
 * when the slice can't be serialized.
 */
export function selectionMarkdownOf(editor: Editor): string | null {
  const { state } = editor;
  const { from, to, empty, $from, $to } = state.selection;
  if (empty || from === to) return null;
  const plain = state.doc.textBetween(from, to, "\n");
  if ($from.parent === $to.parent && $from.parent.type.spec.code) return plain;

  const serializer = (editor.storage as MarkdownStorage).markdown?.serializer;
  if (!serializer) return plain;
  const { content } = state.doc.slice(from, to);
  // A selection within one paragraph slices to bare inline nodes; the
  // serializer renders the block content of the Fragment it is handed, so
  // give them a paragraph to sit in.
  const blocks =
    content.firstChild?.isInline === true
      ? Fragment.from(state.schema.nodes.paragraph.create(null, content))
      : content;
  try {
    const markdown = serializer.serialize(blocks).trim();
    return markdown.length > 0 ? markdown : plain;
  } catch {
    return plain;
  }
}
