import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { GutterMark } from "@/utils/diffGutterMarks";
import { alignUnits, contentBlockCount, type ContentBlock } from "./blockAlignment";

// DiffGutter paints a VSCode-git-gutter-style colored bar in the left margin of
// every top-level block that differs from the baseline revision (#121).
// Marks are computed off-thread in EditorPage from the current markdown vs
// `revisions[0]`; we just place `Decoration.node` on the matching top-level
// child so the CSS in editor.css can render `::before` bars — no DOM here.
//
// Safety: markdown-it (source of the marks) and the ProseMirror doc must agree
// on top-level block count. If they don't (parsing quirk, e.g. an HTML block
// tiptap collapsed away), we render nothing rather than misalign the bars.
// Blank-line paragraphs (#261) never correspond to a markdown-it block, so
// they're excluded from both sides of that comparison (see blockAlignment.ts).

export interface DiffGutterPayload {
  marks: GutterMark[];
  blockCount: number;
  /** Units per top-level block (#368); see alignUnits. */
  groupSizes?: number[];
}

interface PluginState {
  payload: DiffGutterPayload;
  deco: DecorationSet;
  /** The doc's own unit count when `deco` was built (#270 fast path). */
  unitCount: number;
}

const key = new PluginKey<PluginState>("diffGutter");

function buildDeco(
  doc: ProseMirrorNode,
  payload: DiffGutterPayload
): DecorationSet {
  if (payload.marks.length === 0) return DecorationSet.empty;
  const targets = alignUnits(doc, payload.blockCount, payload.groupSizes);
  if (!targets) return DecorationSet.empty;

  // Several units map to the same node when a block is labelled as a whole
  // (see alignUnits): merge their marks — "add" only if every unit of the
  // block is new, a dash if any unit had one.
  const merged = new Map<number, { target: ContentBlock; units: number; adds: number; mods: number; delAbove: boolean }>();
  targets.forEach((target) => {
    const entry = merged.get(target.offset);
    if (entry) entry.units += 1;
    else merged.set(target.offset, { target, units: 1, adds: 0, mods: 0, delAbove: false });
  });
  for (const mark of payload.marks) {
    const target = targets[mark.blockIndex];
    if (!target) continue;
    const entry = merged.get(target.offset);
    if (!entry) continue;
    if (mark.kind === "add") entry.adds += 1;
    else if (mark.kind === "mod") entry.mods += 1;
    if (mark.delAbove) entry.delAbove = true;
  }

  const decos: Decoration[] = [];
  for (const { target, units, adds, mods, delAbove } of merged.values()) {
    const classes: string[] = [];
    if (adds === units) classes.push("diff-gutter-add");
    else if (adds + mods > 0) classes.push("diff-gutter-mod");
    if (delAbove) classes.push("diff-gutter-del-above");
    if (classes.length === 0) continue;
    decos.push(
      Decoration.node(target.offset, target.offset + target.node.nodeSize, {
        class: classes.join(" "),
      })
    );
  }
  return DecorationSet.create(doc, decos);
}

const EMPTY_PAYLOAD: DiffGutterPayload = { marks: [], blockCount: 0 };

function built(doc: ProseMirrorNode, payload: DiffGutterPayload): PluginState {
  return { payload, deco: buildDeco(doc, payload), unitCount: contentBlockCount(doc) };
}

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
          init: () => ({ payload: EMPTY_PAYLOAD, deco: DecorationSet.empty, unitCount: 0 }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as DiffGutterPayload | undefined;
            if (meta) return built(newState.doc, meta);
            if (tr.docChanged) {
              // Per-keystroke path (#270): rebuilding placed one Decoration per
              // top-level block on every transaction. The payload itself cannot
              // have changed here — EditorPage recomputes it from the markdown,
              // which is only re-serialized on the 250ms debounce (#265) and
              // arrives as a meta above — so mapping the existing decorations
              // through the change gives the same placement far more cheaply.
              //
              // The unit-count cross-check is kept: once the edit adds or
              // removes a unit (a block, list item or table row) the payload
              // no longer lines up with the doc, and rendering nothing (as
              // before) beats rendering misaligned bars until the next
              // payload lands.
              if (contentBlockCount(newState.doc) !== value.unitCount) {
                return { ...value, deco: DecorationSet.empty };
              }
              return { ...value, deco: value.deco.map(tr.mapping, newState.doc) };
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
