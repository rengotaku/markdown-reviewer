import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

// LineNumberGutter labels each top-level block with the Markdown source line
// its first line sits on (#234), so "N 行目" in a review comment lines up with
// what the editor shows.
//
// Numbers are computed in EditorPage from the saved markdown (markdown-it's
// block ranges) and pushed in, exactly like DiffGutter's marks: the extension
// only places `Decoration.node`s carrying a `data-line-number` attribute, and
// editor.css renders them via `::before { content: attr(data-line-number) }`.
//
// Safety mirrors DiffGutter: if markdown-it and the ProseMirror doc disagree
// on the top-level block count, render nothing rather than misaligned numbers.

export interface LineNumberPayload {
  /** Source line number (1-indexed) of each top-level block, in doc order. */
  lines: number[];
  /** Block count markdown-it saw — cross-checked against the live doc. */
  blockCount: number;
}

interface PluginState {
  payload: LineNumberPayload;
  deco: DecorationSet;
}

const key = new PluginKey<PluginState>("lineNumberGutter");

// Same phantom-trailing-paragraph allowance as DiffGutter (#125): tiptap
// appends an empty paragraph after a trailing table/list that markdown-it
// never emits.
function effectiveChildCount(doc: ProseMirrorNode): number {
  if (doc.childCount === 0) return 0;
  const last = doc.child(doc.childCount - 1);
  if (last.type.name === "paragraph" && last.content.size === 0) {
    return doc.childCount - 1;
  }
  return doc.childCount;
}

function buildDeco(doc: ProseMirrorNode, payload: LineNumberPayload): DecorationSet {
  if (payload.lines.length === 0) return DecorationSet.empty;
  if (effectiveChildCount(doc) !== payload.blockCount) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.forEach((node, offset, index) => {
    const line = payload.lines[index];
    if (line === undefined) return;
    decos.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: "line-number-gutter",
        "data-line-number": String(line),
      })
    );
  });
  return DecorationSet.create(doc, decos);
}

const EMPTY_PAYLOAD: LineNumberPayload = { lines: [], blockCount: 0 };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineNumberGutter: {
      /** Replace the line numbers (recomputed by EditorPage). */
      setLineNumbers: (payload: LineNumberPayload) => ReturnType;
    };
  }
}

export const LineNumberGutter = Extension.create({
  name: "lineNumberGutter",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: () => ({ payload: EMPTY_PAYLOAD, deco: DecorationSet.empty }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as LineNumberPayload | undefined;
            if (meta) {
              return { payload: meta, deco: buildDeco(newState.doc, meta) };
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
      setLineNumbers:
        (payload: LineNumberPayload) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, payload));
          return true;
        },
    };
  },
});
