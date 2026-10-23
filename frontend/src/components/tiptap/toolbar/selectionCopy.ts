import { Fragment, type Schema } from "@tiptap/pm/model";
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
  const blocks = asBlocks(state.schema, content);
  try {
    // Only the trailing newline the serializer ends blocks with goes: spaces
    // the selection took in are part of what was selected.
    const markdown = serializer.serialize(blocks).replace(/\n+$/, "");
    if (markdown.trim().length === 0) return plain;
    // A table without its header row has no GFM form and comes out as HTML;
    // plain text at least keeps every selected cell.
    if (blocks.firstChild?.type.name === "table" && markdown.startsWith("<")) return plain;
    return markdown;
  } catch {
    return plain;
  }
}

/**
 * Turns the selected slice into block content the serializer can render.
 * A slice keeps only what lies below the selection's shared ancestor, so a
 * selection within one paragraph is bare inline nodes, and one across table
 * cells or rows is cells or rows with no table around them — which the
 * serializer drops cells from rather than failing. Each is put back inside the
 * parents it lost.
 */
function asBlocks(schema: Schema, content: Fragment): Fragment {
  const first = content.firstChild;
  if (!first) return content;
  if (first.isInline) return Fragment.from(schema.nodes.paragraph.create(null, content));
  const { table, tableRow } = schema.nodes;
  if (table && tableRow) {
    const kind = first.type.name;
    if (kind === "tableCell" || kind === "tableHeader") {
      return Fragment.from(table.create(null, tableRow.create(null, content)));
    }
    if (kind === "tableRow") return Fragment.from(table.create(null, content));
  }
  return content;
}
