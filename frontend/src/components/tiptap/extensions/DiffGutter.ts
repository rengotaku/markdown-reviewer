import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { GutterMark } from "@/utils/diffGutterMarks";

// DiffGutter paints a VSCode-git-gutter-style colored bar in the left margin of
// every top-level block that differs from the baseline revision (#121).
// Marks are computed off-thread in EditorPage from the current markdown vs
// `revisions[0]`; we just place `Decoration.node` on the matching top-level
// child so the CSS in editor.css can render `::before` bars — no DOM here.
//
// Safety: markdown-it (source of the marks) and the ProseMirror doc must agree
// on top-level block count. If they don't (parsing quirk, e.g. an HTML block
// tiptap collapsed away), we render nothing rather than misalign the bars.

export interface DiffGutterPayload {
  marks: GutterMark[];
  blockCount: number;
}

interface PluginState {
  payload: DiffGutterPayload;
  deco: DecorationSet;
}

const key = new PluginKey<PluginState>("diffGutter");

// tiptap/ProseMirror appends a phantom empty paragraph when the document ends
// with a non-textblock node (table, list, ...). markdown-it never emits an
// empty paragraph block, so that trailing node is safe to ignore when
// cross-checking counts — without this, any document ending in a table or
// list always fails the check and the gutter silently disappears (#125).
function effectiveChildCount(doc: ProseMirrorNode): number {
  if (doc.childCount === 0) return 0;
  const last = doc.child(doc.childCount - 1);
  if (last.type.name === "paragraph" && last.content.size === 0) {
    return doc.childCount - 1;
  }
  return doc.childCount;
}

function buildDeco(
  doc: ProseMirrorNode,
  payload: DiffGutterPayload
): DecorationSet {
  if (payload.marks.length === 0) return DecorationSet.empty;
  if (effectiveChildCount(doc) !== payload.blockCount) return DecorationSet.empty;

  const marksByIndex = new Map<number, GutterMark>();
  for (const m of payload.marks) marksByIndex.set(m.blockIndex, m);

  const decos: Decoration[] = [];
  let pos = 0;
  doc.forEach((node, offset, index) => {
    pos = offset;
    const mark = marksByIndex.get(index);
    if (mark) {
      const classes: string[] = [];
      if (mark.kind === "add") classes.push("diff-gutter-add");
      else if (mark.kind === "mod") classes.push("diff-gutter-mod");
      if (mark.delAbove) classes.push("diff-gutter-del-above");
      if (classes.length > 0) {
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: classes.join(" "),
          })
        );
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

const EMPTY_PAYLOAD: DiffGutterPayload = { marks: [], blockCount: 0 };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    diffGutter: {
      /** Replace the diff-gutter marks (recomputed by EditorPage). */
      setDiffGutter: (payload: DiffGutterPayload) => ReturnType;
    };
  }
}

export const DiffGutter = Extension.create({
  name: "diffGutter",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: () => ({ payload: EMPTY_PAYLOAD, deco: DecorationSet.empty }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as DiffGutterPayload | undefined;
            if (meta) {
              return {
                payload: meta,
                deco: buildDeco(newState.doc, meta),
              };
            }
            if (tr.docChanged) {
              return {
                payload: value.payload,
                deco: buildDeco(newState.doc, value.payload),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setDiffGutter:
        (payload: DiffGutterPayload) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, payload));
          return true;
        },
    };
  },
});
