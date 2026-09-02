import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { BlankLinePayload } from "@/utils/blankLines";

// BlankLines makes the number of blank lines that separated a Markdown
// block from the previous one visible in the editor, and keeps it around so
// saving restores it (#259).
//
// tiptap-markdown always writes top-level blocks back out separated by a
// single blank line, so a source file's 2nd..5th blank lines carry no
// representation in the ProseMirror doc by default. Rather than inserting
// empty paragraph nodes (which would change the top-level child count that
// DiffGutter/LineNumberGutter/comment-anchor resolution all cross-check
// against markdown-it's block count), the extra count is stored as a
// `blankLinesBefore` attribute on the block itself and rendered as extra
// margin-top. markdownSerialize.ts reads the same attribute back out when
// writing markdown.

/** Top-level node types a Markdown body's blocks can render as. Mirrors the
 *  block-level node types registered in TiptapEditor.tsx. */
const BLOCK_NODE_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "mermaidBlock",
];

// Same phantom-trailing-paragraph allowance as DiffGutter/LineNumberGutter
// (#125): tiptap appends an empty paragraph after a trailing table/list that
// markdown-it never emits.
function effectiveChildCount(doc: ProseMirrorNode): number {
  if (doc.childCount === 0) return 0;
  const last = doc.child(doc.childCount - 1);
  if (last.type.name === "paragraph" && last.content.size === 0) {
    return doc.childCount - 1;
  }
  return doc.childCount;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blankLines: {
      /** Set each top-level block's `blankLinesBefore` attribute from a
       *  freshly computed payload (called right after loading a file). */
      setBlankLinesBefore: (payload: BlankLinePayload) => ReturnType;
    };
  }
}

export const BlankLines = Extension.create({
  name: "blankLines",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_NODE_TYPES,
        attributes: {
          blankLinesBefore: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.getAttribute("data-blank-lines-before");
              const parsed = raw ? parseInt(raw, 10) : 0;
              return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            },
            renderHTML: (attributes) => {
              const value = (attributes.blankLinesBefore as number) ?? 0;
              if (!value) return {};
              return {
                "data-blank-lines-before": String(value),
                // margin-top adds the normal paragraph gap plus one extra
                // line-height per extra blank line. Adding --paragraph-gap
                // (rather than just N * --blank-line-height) matters because
                // of margin collapsing: the browser takes the *max* of this
                // margin-top and the previous block's margin-bottom, so at
                // N=1 a bare `N * line-height` alone could still collapse to
                // the same gap as N=0 whenever line-height < paragraph-gap.
                style: `margin-top: calc(var(--paragraph-gap) + ${value} * var(--blank-line-height));`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlankLinesBefore:
        (payload: BlankLinePayload) =>
        ({ tr, dispatch, state }) => {
          if (payload.extras.length === 0) return true;
          if (effectiveChildCount(state.doc) !== payload.blockCount) return true;

          let changed = false;
          state.doc.forEach((node, offset, index) => {
            const extra = payload.extras[index] ?? 0;
            if (node.attrs.blankLinesBefore === extra) return;
            tr.setNodeMarkup(offset, undefined, { ...node.attrs, blankLinesBefore: extra });
            changed = true;
          });
          if (!changed) return true;

          // Loading a file shouldn't create an undo step for these
          // attribute writes.
          tr.setMeta("addToHistory", false);
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
