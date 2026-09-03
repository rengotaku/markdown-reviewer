import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
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
  /**
   * The comment whose thread is open (#251). Carried in the decoration rather
   * than toggled on the DOM node: ProseMirror re-renders decorated spans on
   * its own transactions, which would silently drop a class set from outside.
   */
  activeId: string | null;
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
  | { type: "setActive"; activeId: string | null }
  | { type: "flash"; ranges: FlashRange[] }
  | { type: "clearFlash" }
  | { type: "resync" };

function buildDeco(
  doc: ProseMirrorNode,
  comments: ReadonlyArray<HighlightComment>,
  activeId: string | null
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
        Decoration.inline(
          range.from,
          range.to,
          {
            class: c.id === activeId ? "comment-mark is-active" : "comment-mark",
            "data-comment-id": c.id,
            // Reachable by keyboard (#251): the thread opens on click, so the
            // highlight has to be a focusable control rather than plain text.
            tabindex: "0",
            role: "button",
          },
          // Kept in the (public) spec as well as the DOM attrs so a lookup by
          // document range — what the selection bubble needs — does not have
          // to go through the rendered DOM the way the old right-click menu
          // did with `closest("[data-comment-id]")`.
          { commentId: c.id }
        )
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

/**
 * Ids of the comment highlights overlapping `[from, to]`, innermost first
 * (the shortest range wins). The selection bubble uses the first entry to
 * offer 編集 / 削除 for the comment the selection sits inside; ordering by
 * range length reproduces what right-clicking used to resolve through the
 * innermost DOM element.
 *
 * Only persistent comment marks are considered — the transient flash
 * decorations live in a separate set (see PluginState.flashDeco).
 */
export function commentIdsInRange(
  state: EditorState,
  from: number,
  to: number
): string[] {
  const pState = key.getState(state);
  if (!pState) return [];
  const seen = new Set<string>();
  return pState.deco
    .find(from, to)
    // `find` also returns decorations that merely touch the range (a
    // decoration ending exactly at `from`, or starting exactly at `to`).
    // Both are half-open ranges, so touching is not overlapping: without this
    // filter, selecting the text right after a comment would offer 編集 / 削除
    // for that comment — and 削除 asks for no confirmation.
    .filter((d) => d.from < to && d.to > from)
    .sort((a, b) => a.to - a.from - (b.to - b.from))
    .map((d) => (d.spec as { commentId?: string } | null)?.commentId)
    .filter((id): id is string => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentHighlight: {
      /** Replace the set of highlighted comments. */
      setCommentHighlights: (comments: HighlightComment[]) => ReturnType;
      /** Mark one comment's highlight as the open thread's anchor (#251). */
      setActiveComment: (id: string | null) => ReturnType;
      /**
       * Paint a transient highlight over `ranges` (cleared by
       * clearCommentFlash). Used to flash a jump target that has no
       * persistent comment-mark decoration, e.g. a resolved comment (#167).
       */
      flashCommentRanges: (ranges: FlashRange[]) => ReturnType;
      /** Remove any decorations painted by flashCommentRanges. */
      clearCommentFlash: () => ReturnType;
      /**
       * Re-resolve every comment anchor against the current document. Cheap
       * mapping keeps highlights in place per keystroke; this puts them back
       * on their true anchor once typing pauses (#270).
       */
      resyncCommentHighlights: () => ReturnType;
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
            activeId: null,
            deco: DecorationSet.empty,
            flashDeco: DecorationSet.empty,
          }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as PluginMeta | undefined;
            if (meta?.type === "setComments") {
              return {
                ...value,
                comments: meta.comments,
                deco: buildDeco(newState.doc, meta.comments, value.activeId),
                flashDeco: value.flashDeco.map(tr.mapping, newState.doc),
              };
            }
            if (meta?.type === "setActive") {
              if (meta.activeId === value.activeId) return value;
              return {
                ...value,
                activeId: meta.activeId,
                deco: buildDeco(newState.doc, value.comments, meta.activeId),
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
            if (meta?.type === "resync") {
              return {
                ...value,
                deco: buildDeco(newState.doc, value.comments, value.activeId),
                flashDeco: value.flashDeco.map(tr.mapping, newState.doc),
              };
            }
            if (tr.docChanged) {
              // Per-keystroke path: map the existing decorations through the
              // change instead of re-resolving every anchor against a freshly
              // flattened document (#270). buildDeco is O(doc size + anchors)
              // and ran on every transaction, which is what made typing and
              // comment writes drag on a large file. Mapping is O(number of
              // decorations) and keeps highlights glued to their text for any
              // edit that does not rewrite the anchored snippet itself.
              //
              // Anchors are content-addressed (heading path + snippet +
              // occurrence), so an edit *inside* an anchored range can move a
              // highlight somewhere mapping cannot predict. That is repaired by
              // the "resync" meta above, which TiptapEditor fires from the same
              // 250ms debounce that re-serializes the markdown (#265) — so the
              // full re-resolve still happens, just once per typing pause
              // rather than once per keystroke.
              return {
                ...value,
                deco: value.deco.map(tr.mapping, newState.doc),
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
      setActiveComment:
        (id: string | null) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { type: "setActive", activeId: id }));
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
      resyncCommentHighlights:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { type: "resync" }));
          return true;
        },
    };
  },
});
