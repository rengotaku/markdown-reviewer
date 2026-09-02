import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// getEditorMarkdown restores the blank-line counts BlankLines.ts stashed on
// each top-level block's `blankLinesBefore` attribute, so saving doesn't
// collapse a 5-blank-line gap back down to tiptap-markdown's default single
// blank line (#259).
//
// tiptap-markdown's MarkdownSerializer only exposes `serialize(doc)` for a
// whole document — there's no per-node hook for the separator between
// blocks. So each top-level child is serialized on its own (wrapped in a
// throwaway doc built from the same schema) and the blocks are rejoined
// with an explicit number of newlines. Serializing a document is otherwise
// stateful (MarkdownSerializerState tracks `closed`/`delim` across blocks,
// e.g. so a table's own trailing "\n" doesn't turn into a blank line), so
// each block's raw output is stripped of *trailing* newlines before
// rejoining and only the true last block's original trailing newline (if
// tiptap-markdown's own serializer already produced one, as it does for
// tables) is preserved — this was verified empirically against
// `serializer.serialize(doc)` for headings/paragraphs/lists/code
// blocks/tables/blockquotes/hr, not assumed.

interface MarkdownStorage {
  serializer: { serialize(content: ProseMirrorNode): string };
}

function getMarkdownStorage(editor: Editor): MarkdownStorage {
  const storage = editor.storage as unknown as { markdown: MarkdownStorage };
  return storage.markdown;
}

/** Serializes a single top-level node by wrapping it in a one-child
 *  document of the same schema, mirroring how tiptap-markdown's
 *  MarkdownSerializer.serialize() is normally called on the whole doc. */
function serializeBlock(editor: Editor, node: ProseMirrorNode): string {
  const wrapperDoc = editor.schema.topNodeType.create(null, node);
  return getMarkdownStorage(editor).serializer.serialize(wrapperDoc);
}

/**
 * Top-level children to serialize, dropping the phantom empty paragraph
 * tiptap appends after a trailing table/list/code block (same allowance
 * DiffGutter/LineNumberGutter/BlankLines make, #125). Serializing the whole
 * doc at once silently absorbs this phantom node (its own serialize output
 * is empty and there's no following block to force a blank-line delimiter
 * for it) — verified empirically against `serializer.serialize(doc)` — so
 * the per-block reconstruction below has to drop it explicitly to match.
 */
function contentBlocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  doc.forEach((node) => nodes.push(node));
  const last = nodes[nodes.length - 1];
  if (last && last.type.name === "paragraph" && last.content.size === 0) {
    nodes.pop();
  }
  return nodes;
}

/**
 * getEditorMarkdown serializes `editor`'s document to Markdown, restoring
 * any extra blank lines recorded on top-level blocks by the BlankLines
 * extension (see setBlankLinesBefore in BlankLines.ts).
 */
export function getEditorMarkdown(editor: Editor): string {
  const nodes = contentBlocks(editor.state.doc);
  if (nodes.length === 0) return "";

  const raws: string[] = [];
  const blankLinesBefore: number[] = [];
  for (const node of nodes) {
    raws.push(serializeBlock(editor, node));
    blankLinesBefore.push(
      typeof node.attrs.blankLinesBefore === "number"
        ? node.attrs.blankLinesBefore
        : 0
    );
  }

  // Strip each block's own trailing newline(s) before rejoining — the
  // number of newlines between blocks is decided entirely by us below, not
  // by whatever a given node's own serializer happened to emit.
  const trimmed = raws.map((raw) => raw.replace(/\n+$/, ""));

  let out = "\n".repeat(blankLinesBefore[0] ?? 0);
  trimmed.forEach((block, index) => {
    if (index > 0) {
      // Normal separator is a single blank line ("\n\n"); each extra blank
      // line adds one more "\n".
      out += "\n".repeat(2 + (blankLinesBefore[index] ?? 0));
    }
    out += block;
  });

  // The true last block's own serialization decides whether the whole
  // output ends with a trailing newline (tiptap-markdown's table serializer
  // emits one; most others don't) — preserve that, rather than guessing.
  const lastRaw = raws[raws.length - 1] ?? "";
  if (lastRaw.endsWith("\n")) out += "\n";

  return out;
}
