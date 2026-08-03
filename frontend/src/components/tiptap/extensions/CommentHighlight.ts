import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  extractAnchorBlocks,
  resolveAnchorInBlocks,
  type PmAnchor,
} from "@/utils/pmAnchor";

// CommentHighlight paints inline highlights for sidecar comments. Comments live
// in review.json (not in the document), so highlights are decorations layered
// over the clean canonical body — applied via setCommentHighlights() and
// re-resolved whenever the doc changes so they track edits. Nothing here
// mutates the document, so it never marks the file dirty.

export interface HighlightComment {
  id: string;
  status: "open" | "resolved";
  anchor?: PmAnchor;
  anchors?: PmAnchor[];
}

/** A resolved (from, to) range in the live doc — see flashCommentRanges. */
export interface FlashRange {
  from: number;
  to: number;
}

interface PluginState {
  comments: HighlightComment[];
  deco: DecorationSet;
  /**
   * Transient decorations painted by flashCommentRanges and removed by
   * clearCommentFlash. Jumping to a *resolved* comment (#167) has no
   * persistent `comment-mark` decoration to scroll/flash — buildDeco skips
   * resolved comments by design (#96/#97) — so this paints a one-off
   * highlight at the live anchor position instead.
   */
  flashDeco: DecorationSet;
}

const key = new PluginKey<PluginState>("commentHighlight");

type PluginMeta =
  | { type: "setComments"; comments: HighlightComment[] }
  | { type: "flash"; ranges: FlashRange[] }
  | { type: "clearFlash" };

function buildDeco(
  doc: ProseMirrorNode,
  comments: ReadonlyArray<HighlightComment>
): DecorationSet {
  const decos: Decoration[] = [];
  // Flatten the doc once, not once per anchor: buildDeco re-runs on every
  // docChanged (i.e. per keystroke), and #162 made a single comment carry one
  // anchor per selected block — resolving each against a freshly extracted
  // block list would make the redraw O(anchors × doc size).
  const blocks = extractAnchorBlocks(doc);
  for (const c of comments) {
    // Resolved comments carry no highlight: the body stays clean once a comment
    // is dealt with. Reopening flips status back to "open", so the decoration
    // reappears the next time comments are pushed in.
    if (c.status === "resolved") continue;
    // A multi-line inline comment (#162) carries its first block in `anchor`
    // and the rest in `anchors`; combine both rather than treating them as
    // mutually exclusive (the pre-fix bug discarded `anchors` whenever
    // `anchor` was present, so only the first block ever highlighted).
    const anchors = [...(c.anchor ? [c.anchor] : []), ...(c.anchors ?? [])];
    for (const a of anchors) {
      const range = resolveAnchorInBlocks(blocks, a);
      if (!range || range.from >= range.to) continue;
      decos.push(
        Decoration.inline(range.from, range.to, {
          class: "comment-mark",
          "data-comment-id": c.id,
        })
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

/** Builds the transient flash decorations for flashCommentRanges. */
function buildFlashDeco(
  doc: ProseMirrorNode,
  ranges: ReadonlyArray<FlashRange>
): DecorationSet {
  const decos = ranges
    .filter((r) => r.from >= 0 && r.from < r.to && r.to <= doc.content.size)
    .map((r) =>
      Decoration.inline(r.from, r.to, { class: "comment-flash is-flash" })
    );
  return DecorationSet.create(doc, decos);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentHighlight: {
      /** Replace the set of highlighted comments. */
      setCommentHighlights: (comments: HighlightComment[]) => ReturnType;
      /**
       * Paint a transient highlight over `ranges` (cleared by
       * clearCommentFlash). Used to flash a jump target that has no
       * persistent comment-mark decoration, e.g. a resolved comment (#167).
       */
      flashCommentRanges: (ranges: FlashRange[]) => ReturnType;
      /** Remove any decorations painted by flashCommentRanges. */
      clearCommentFlash: () => ReturnType;
    };
  }
}

export const CommentHighlight = Extension.create({
  name: "commentHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: () => ({
            comments: [],
            deco: DecorationSet.empty,
            flashDeco: DecorationSet.empty,
          }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as PluginMeta | undefined;
            if (meta?.type === "setComments") {
              return {
                comments: meta.comments,
                deco: buildDeco(newState.doc, meta.comments),
                flashDeco: value.flashDeco.map(tr.mapping, newState.doc),
              };
            }
            if (meta?.type === "flash") {
              return {
                ...value,
                flashDeco: buildFlashDeco(newState.doc, meta.ranges),
              };
            }
            if (meta?.type === "clearFlash") {
              return { ...value, flashDeco: DecorationSet.empty };
            }
            if (tr.docChanged) {
              return {
                comments: value.comments,
                deco: buildDeco(newState.doc, value.comments),
                flashDeco: value.flashDeco.map(tr.mapping, newState.doc),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const pState = key.getState(state);
            if (!pState) return DecorationSet.empty;
            // Layer the transient flash decorations over the persistent ones
            // purely for rendering — they are tracked separately so a flash
            // clear/expire never touches the comment-mark set (#167).
            return pState.deco.add(state.doc, pState.flashDeco.find());
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setCommentHighlights:
        (comments: HighlightComment[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { type: "setComments", comments }));
          return true;
        },
      flashCommentRanges:
        (ranges: FlashRange[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { type: "flash", ranges }));
          return true;
        },
      clearCommentFlash:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { type: "clearFlash" }));
          return true;
        },
    };
  },
});
