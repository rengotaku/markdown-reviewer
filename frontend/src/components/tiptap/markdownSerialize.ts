import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { hasLinkReferenceDefinitions, topLevelBlockRanges } from "@/utils/diffGutterMarks";
import { trueEndLine } from "@/utils/blankLines";

// getEditorMarkdown restores blank lines around top-level blocks so saving
// doesn't collapse a 5-blank-line gap back down to tiptap-markdown's default
// single blank line (#259). Since #261, blank lines are real empty paragraph
// nodes in the doc (see BlankLines.ts) rather than an attribute — the number
// of blank lines before a block is simply however many empty paragraphs sit
// immediately in front of it, counted fresh from the doc on every save so
// typing Enter/Backspace on a blank line changes the output exactly like any
// other edit.
//
// tiptap-markdown's MarkdownSerializer only exposes `serialize(doc)` for a
// whole document — there's no per-node hook for the separator between
// blocks. So each top-level content block is serialized on its own (wrapped
// in a throwaway doc built from the same schema) and the blocks are rejoined
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

/** True for a paragraph with no content — a blank line (#261). */
function isBlankLineParagraph(node: ProseMirrorNode): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

interface ContentBlocks {
  /** Top-level content blocks (blank-line paragraphs excluded), in doc order. */
  nodes: ProseMirrorNode[];
  /** Number of blank-line paragraphs immediately preceding `nodes[i]`,
   *  aligned by index. `blanksBefore[0]` counts blank lines at the very
   *  start of the document. */
  blanksBefore: number[];
}

/**
 * contentBlocksAndBlanks splits doc's top-level children into content
 * blocks and the blank-line count before each one.
 *
 * Drops the phantom empty paragraph tiptap appends after a trailing
 * table/list/code block (same allowance DiffGutter/LineNumberGutter/
 * blockAlignment.ts make, #125) before counting — serializing the whole doc
 * at once silently absorbs this phantom node (its own serialize output is
 * empty and there's no following block to force a blank-line delimiter for
 * it) — verified empirically against `serializer.serialize(doc)` — so it has
 * to be excluded explicitly here too, the same as before this issue.
 */
function contentBlocksAndBlanks(doc: ProseMirrorNode): ContentBlocks {
  const all: ProseMirrorNode[] = [];
  doc.forEach((node) => all.push(node));
  const last = all[all.length - 1];
  if (last && isBlankLineParagraph(last)) all.pop();

  const nodes: ProseMirrorNode[] = [];
  const blanksBefore: number[] = [];
  let pending = 0;
  for (const node of all) {
    if (isBlankLineParagraph(node)) {
      pending++;
      continue;
    }
    nodes.push(node);
    blanksBefore.push(pending);
    pending = 0;
  }
  return { nodes, blanksBefore };
}

// Unedited blocks keep their source (#268). Re-serializing a whole document
// normalizes Markdown it never touched — trailing double-space line breaks
// dropped, wrapped lines joined, `|------|` rewritten as `| --- |` — so
// opening a file and changing one character produced thousands of lines of
// diff, and some files came up "unsaved" just by being opened. Each
// top-level block's source text is remembered at load, keyed by the
// ProseMirror node object: a node nobody edited is the very same object in
// every later document (ProseMirror shares unchanged subtrees), so one still
// found in the map is written out as its source, and only the blocks that
// changed are serialized. A block that was edited and then put back exactly
// as it was (undo rebuilds the block around its restored content) is a new
// object, so a miss falls back to a block loaded with the same structure
// (`node.eq`) — only when exactly one loaded block matches, since two equal
// blocks may have been written differently (`* item` and `- item`). Adding,
// deleting and reordering blocks needs no bookkeeping. The original gap
// between two blocks is kept too, while both are untouched, still next to
// each other, and the blank lines between them haven't been edited.

interface BlockSource {
  /** The block's lines as loaded, without trailing blank lines. */
  text: string;
  /** Position among the loaded file's top-level blocks. */
  index: number;
  /** Newlines between the previous block's last line and this one's first,
   *  as loaded (1 = adjacent lines, 2 = one blank line, ...). */
  separator: number;
  /** Blank-line paragraphs the load put in front of this block. */
  blanksBefore: number;
  /** The file's last block. Only there can a construct be left open — an
   *  unclosed fence or HTML comment — since anywhere else it would already
   *  have swallowed what followed, so its source is reused only while it is
   *  still the last block. */
  last: boolean;
}

/** markdown-it's top-level token type → the node types it loads as. */
const NODE_TYPES_FOR_TOKEN: Record<string, readonly string[]> = {
  heading_open: ["heading"],
  paragraph_open: ["paragraph"],
  blockquote_open: ["blockquote"],
  bullet_list_open: ["bulletList", "taskList"],
  ordered_list_open: ["orderedList"],
  table_open: ["table"],
  fence: ["codeBlock", "mermaidBlock"],
  code_block: ["codeBlock"],
  hr: ["horizontalRule"],
  html_block: ["rawHtmlBlock"],
};

interface BlockSources {
  byNode: WeakMap<ProseMirrorNode, BlockSource>;
  /** The loaded blocks by type and text, for the structural fallback. */
  byText: Map<string, Array<[ProseMirrorNode, BlockSource]>>;
}

const sourcesByEditor = new WeakMap<Editor, BlockSources>();

const textKey = (node: ProseMirrorNode) => `${node.type.name}\u0000${node.textContent}`;

function lookupSource(sources: BlockSources, node: ProseMirrorNode): BlockSource | undefined {
  const hit = sources.byNode.get(node);
  if (hit) return hit;
  const matches = sources.byText.get(textKey(node))?.filter(([loaded]) => loaded.eq(node)) ?? [];
  return matches.length === 1 ? matches[0][1] : undefined;
}

/**
 * Remembers the source of each top-level block of the document `editor` just
 * loaded from `body` (call after the blank lines are in place). The blocks
 * are paired with markdown-it's top-level ranges by position, so this records
 * nothing — and every block is serialized as before — unless the pairing is
 * certain: the same number of blocks, of matching kinds, and no non-blank
 * line outside every block. A file with a link reference definition is left
 * to the serializer too, wherever the definition sits: it has no node of its
 * own, so serializing the block around it drops it, and an untouched
 * `[text][ref]` elsewhere would be left pointing at nothing.
 */
export function recordBlockSources(editor: Editor, body: string): void {
  const sources: BlockSources = { byNode: new WeakMap(), byText: new Map() };
  sourcesByEditor.set(editor, sources);

  const { nodes, blanksBefore } = contentBlocksAndBlanks(editor.state.doc);
  const ranges = topLevelBlockRanges(body);
  if (nodes.length === 0 || nodes.length !== ranges.length) return;
  if (hasLinkReferenceDefinitions(body)) return;
  const lines = body.split("\n");
  const ends = ranges.map((range) => trueEndLine(lines, range));

  const covered = new Array<boolean>(lines.length).fill(false);
  ranges.forEach((range, i) => covered.fill(true, range.start, ends[i]));
  if (lines.some((line, i) => !covered[i] && line.trim() !== "")) return;
  if (!nodes.every((node, i) => NODE_TYPES_FOR_TOKEN[ranges[i].type]?.includes(node.type.name))) {
    return;
  }

  nodes.forEach((node, i) => {
    const source: BlockSource = {
      text: lines.slice(ranges[i].start, ends[i]).join("\n"),
      index: i,
      separator: i === 0 ? 0 : ranges[i].start - ends[i - 1] + 1,
      blanksBefore: blanksBefore[i] ?? 0,
      last: i === nodes.length - 1,
    };
    sources.byNode.set(node, source);
    const key = textKey(node);
    sources.byText.set(key, [...(sources.byText.get(key) ?? []), [node, source]]);
  });
}

/**
 * getEditorMarkdown serializes `editor`'s document to Markdown, restoring
 * any blank lines represented by empty paragraphs before top-level blocks
 * (see contentBlocksAndBlanks above).
 */
export function getEditorMarkdown(editor: Editor): string {
  const { nodes, blanksBefore } = contentBlocksAndBlanks(editor.state.doc);
  if (nodes.length === 0) return "";

  const sources = sourcesByEditor.get(editor);
  const kept = nodes.map((node, i) => {
    const source = sources ? lookupSource(sources, node) : undefined;
    return source?.last && i !== nodes.length - 1 ? undefined : source;
  });
  const raws = nodes.map((node, i) => kept[i]?.text ?? serializeBlock(editor, node));

  // Strip each block's own trailing newline(s) before rejoining — the
  // number of newlines between blocks is decided entirely by us below, not
  // by whatever a given node's own serializer happened to emit.
  const trimmed = raws.map((raw) => raw.replace(/\n+$/, ""));

  let out = "\n".repeat(blanksBefore[0] ?? 0);
  trimmed.forEach((block, index) => {
    if (index > 0) {
      const prev = kept[index - 1];
      const self = kept[index];
      if (
        prev &&
        self &&
        self.index === prev.index + 1 &&
        self.blanksBefore === (blanksBefore[index] ?? 0)
      ) {
        out += "\n".repeat(self.separator);
      } else {
        // Normal separator is a single blank line ("\n\n"); each blank-line
        // paragraph before this block adds one more "\n".
        out += "\n".repeat(2 + (blanksBefore[index] ?? 0));
      }
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
