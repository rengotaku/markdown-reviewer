import { Extension } from "@tiptap/core";
import { TextSelection, Selection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/**
 * IndentKeymap fills the two indentation gaps the stock keymaps leave (#278):
 *
 * 1. **Tab inside a code block.** StarterKit binds Tab only inside lists, so
 *    in a code block Tab escaped the editor and moved browser focus instead of
 *    indenting. Here Tab inserts one indent unit (Shift-Tab removes one), which
 *    is safe because fenced code round-trips leading whitespace verbatim.
 *    Deliberately *not* extended to paragraphs: a leading tab in a paragraph
 *    serializes to `\tparagraph`, which markdown-it re-parses as an indented
 *    code block — i.e. reloading the file would silently rewrite the text.
 *
 * 2. **Backspace on an emptied list item.** Deleting a line by clearing its
 *    text and pressing Backspace ran ProseMirror's default join, which *lifts*
 *    the now-empty item one level and re-nests the items that follow under it
 *    — so removing a level-3 line visibly moved the level-2 lines below it.
 *    Here the emptied item (and any list wrappers it leaves behind empty) is
 *    removed outright, so every surrounding item keeps the indent level it had.
 */

/** One indent unit inserted by Tab inside a code block. */
const CODE_INDENT = "\t";
/** Widest indent unit Shift-Tab looks for at the start of a line. */
const INDENT_SCAN_WIDTH = 2;

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function inCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  return $from.parent.type.spec.code === true;
}

/**
 * Range covering the list item the (empty) cursor sits in, widened to include
 * every ancestor list/item that would be left empty once it is removed. Returns
 * null when the cursor is not on an empty line inside a list item.
 */
function emptyListItemRange(
  state: EditorState
): { from: number; to: number } | null {
  const { empty, $from } = state.selection;
  if (!empty) return null;
  // Only a line that has already been emptied out — a Backspace inside text
  // must keep its normal meaning.
  if ($from.parent.content.size !== 0 || !$from.parent.isTextblock) return null;

  let depth = $from.depth;
  while (depth > 0 && !LIST_ITEM_TYPES.has($from.node(depth).type.name)) {
    depth -= 1;
  }
  if (depth === 0) return null;
  // An item holding sub-items is not "an empty line": deleting it would take
  // its children with it. Leave those to the default behaviour.
  if ($from.node(depth).childCount > 1) return null;

  let from = $from.before(depth);
  let to = $from.after(depth);
  // Walk outwards: an ancestor that holds nothing but the node we are about
  // to remove has to go with it, or an empty list/item would be left behind.
  for (let d = depth - 1; d > 0; d -= 1) {
    const node = $from.node(d);
    const isWrapper = LIST_TYPES.has(node.type.name) || LIST_ITEM_TYPES.has(node.type.name);
    if (!isWrapper || node.childCount > 1) break;
    from = $from.before(d);
    to = $from.after(d);
  }
  return { from, to };
}

function deleteRange(
  tr: Transaction,
  from: number,
  to: number
): Transaction {
  tr.delete(from, to);
  // Put the caret at the end of whatever now precedes the hole.
  const sel = Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size)), -1);
  return tr.setSelection(sel).scrollIntoView();
}

/**
 * Start position of every line the selection touches inside the current code
 * block, in document coordinates, ordered last-to-first so callers can edit
 * them without remapping positions.
 */
function selectedLineStarts(state: EditorState): number[] {
  const { $from, from, to } = state.selection;
  const blockStart = $from.start();
  const text = state.doc.textBetween(blockStart, $from.end(), "\n", "\n");
  const starts: number[] = [];
  let lineStart = blockStart;
  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    // A line counts as selected when the selection overlaps it, and for a
    // collapsed caret when it sits anywhere on the line.
    if (from <= lineEnd && to >= lineStart) starts.push(lineStart);
    lineStart = lineEnd + 1;
  }
  return starts.reverse();
}

/** Length of the indent unit sitting at `pos`, or 0 when there is none. */
function indentWidthAt(state: EditorState, pos: number): number {
  const ahead = state.doc.textBetween(
    pos,
    Math.min(pos + INDENT_SCAN_WIDTH, state.doc.resolve(pos).end()),
    "\n",
    "\n"
  );
  if (ahead.startsWith(CODE_INDENT)) return CODE_INDENT.length;
  const spaces = /^ {1,2}/.exec(ahead);
  return spaces ? spaces[0].length : 0;
}

export const IndentKeymap = Extension.create({
  name: "indentKeymap",
  // Must outrank StarterKit's list keymap (default priority 100) so the
  // Backspace handler below gets the first look at an emptied list item.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const { state, view } = editor;
        if (!inCodeBlock(state)) return false;
        const tr = state.tr;
        if (state.selection.empty) {
          // No selection: plain insert at the caret.
          const at = state.selection.from;
          tr.insertText(CODE_INDENT, at, at);
          tr.setSelection(
            TextSelection.create(tr.doc, at + CODE_INDENT.length)
          );
        } else {
          // With a selection, indent every line it touches rather than
          // replacing the selected text with a tab.
          for (const start of selectedLineStarts(state)) {
            tr.insertText(CODE_INDENT, start, start);
          }
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const { state, view } = editor;
        if (!inCodeBlock(state)) return false;
        const tr = state.tr;
        for (const start of selectedLineStarts(state)) {
          const width = indentWidthAt(state, start);
          if (width > 0) tr.delete(start, start + width);
        }
        // Swallow the key even when nothing was outdented: falling through
        // would move browser focus out of the code block.
        if (tr.docChanged) view.dispatch(tr.scrollIntoView());
        return true;
      },
      Backspace: ({ editor }) => {
        const range = emptyListItemRange(editor.state);
        if (!range) return false;
        editor.view.dispatch(deleteRange(editor.state.tr, range.from, range.to));
        return true;
      },
    };
  },
});
