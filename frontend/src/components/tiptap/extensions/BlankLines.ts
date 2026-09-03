import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { BlankLinePayload } from "@/utils/blankLines";

// BlankLines materializes the blank lines that separated a Markdown block
// from the previous one as real, empty paragraph nodes in the ProseMirror
// doc, so they're editable content — a caret can land on them, Enter adds
// one, Backspace removes one — rather than invisible spacing (#261).
//
// tiptap-markdown always writes top-level blocks back out separated by a
// single blank line, so a source file's 2nd..5th blank lines carry no
// representation in the ProseMirror doc by default. setBlankLinesBefore
// (called once, right after loading a file) inserts `extras[i]` empty
// paragraphs immediately before the i-th top-level block markdown-it saw,
// recovering the original count. From then on the doc's own empty
// paragraphs *are* the source of truth: markdownSerialize.ts counts
// however many sit before each content block when writing markdown back
// out, so typing Enter/Backspace on a blank line changes the saved blank
// line count exactly like editing any other content.
//
// An empty paragraph anywhere in the doc is always treated as one blank
// line — there is no other concept of "an empty paragraph" in Markdown
// itself (a literal empty line is exactly what one is), so no separate
// marker attribute is needed to tell "a blank line" apart from "a paragraph
// the user happened to leave empty": they're the same thing. DiffGutter and
// LineNumberGutter exclude these nodes the same way when cross-checking
// against markdown-it's block count (see blockAlignment.ts).

// Same phantom-trailing-paragraph allowance as DiffGutter/LineNumberGutter
// (#125): tiptap appends an empty paragraph after a trailing table/list that
// markdown-it never emits. At the point setBlankLinesBefore runs (right
// after setContent, before any blank paragraphs have been inserted), that's
// the only way an empty paragraph can already exist in the doc.
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
      /** Insert `payload.extras[i]` empty paragraphs before the doc's i-th
       *  top-level block (called right after loading a file). */
      setBlankLinesBefore: (payload: BlankLinePayload) => ReturnType;
    };
  }
}

export const BlankLines = Extension.create({
  name: "blankLines",

  addCommands() {
    return {
      setBlankLinesBefore:
        (payload: BlankLinePayload) =>
        ({ tr, dispatch, state }) => {
          if (payload.extras.length === 0) return true;
          if (effectiveChildCount(state.doc) !== payload.blockCount) return true;

          const paragraphType = state.schema.nodes.paragraph;
          if (!paragraphType) return true;

          let changed = false;
          // Insert from the last block back to the first: each insertion
          // lands immediately before block i, which only shifts the
          // positions of blocks *after* i in `tr.doc` — blocks 0..i-1 (used
          // to compute the next iteration's offset) are never touched, so
          // offsets computed fresh from `tr.doc` on each iteration stay
          // correct without any manual position mapping.
          for (let i = payload.blockCount - 1; i >= 0; i--) {
            const extra = payload.extras[i] ?? 0;
            if (extra <= 0) continue;
            let offset = 0;
            for (let j = 0; j < i; j++) offset += tr.doc.child(j).nodeSize;
            for (let k = 0; k < extra; k++) {
              tr.insert(offset, paragraphType.create());
            }
            changed = true;
          }
          if (!changed) return true;

          // Loading a file shouldn't create an undo step for this.
          tr.setMeta("addToHistory", false);
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
