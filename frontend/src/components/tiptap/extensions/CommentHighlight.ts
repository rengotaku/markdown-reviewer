import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { resolveAnchorInDoc, type PmAnchor } from "@/utils/pmAnchor";

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

interface PluginState {
  comments: HighlightComment[];
  deco: DecorationSet;
}

const key = new PluginKey<PluginState>("commentHighlight");

function buildDeco(
  doc: ProseMirrorNode,
  comments: ReadonlyArray<HighlightComment>
): DecorationSet {
  const decos: Decoration[] = [];
  for (const c of comments) {
    const anchors = c.anchor ? [c.anchor] : (c.anchors ?? []);
    for (const a of anchors) {
      const range = resolveAnchorInDoc(doc, a);
      if (!range || range.from >= range.to) continue;
      decos.push(
        Decoration.inline(range.from, range.to, {
          class:
            c.status === "resolved"
              ? "comment-mark comment-mark--resolved"
              : "comment-mark",
          "data-comment-id": c.id,
        })
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentHighlight: {
      /** Replace the set of highlighted comments. */
      setCommentHighlights: (comments: HighlightComment[]) => ReturnType;
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
          init: () => ({ comments: [], deco: DecorationSet.empty }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as
              | { comments: HighlightComment[] }
              | undefined;
            if (meta) {
              return {
                comments: meta.comments,
                deco: buildDeco(newState.doc, meta.comments),
              };
            }
            if (tr.docChanged) {
              return {
                comments: value.comments,
                deco: buildDeco(newState.doc, value.comments),
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
      setCommentHighlights:
        (comments: HighlightComment[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, { comments }));
          return true;
        },
    };
  },
});
