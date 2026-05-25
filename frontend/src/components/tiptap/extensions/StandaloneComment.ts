import { Node, mergeAttributes } from "@tiptap/core";
import {
  buildStandaloneCommentAttrs,
  DEFAULT_COMMENT_SCOPE,
  isStandaloneScope,
  normalizeScope,
} from "@/utils/commentAttrs";

export interface StandaloneCommentAttributes {
  id: string;
  author: string;
  date: string;
  /**
   * Newline-joined list of bound section titles for `scope="cross-section"`.
   * Empty for `scope="global"`. See `encodeSections` in `utils/headings.ts`.
   */
  target?: string;
  body: string;
  /** Must be one of the standalone scopes ("cross-section" | "global"). */
  scope: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    standaloneComment: {
      addStandaloneComment: (attrs: StandaloneCommentAttributes) => ReturnType;
      removeStandaloneCommentById: (id: string) => ReturnType;
    };
  }
}

const SCOPE_LABEL: Record<string, string> = {
  global: "🌐 全体コメント",
  "cross-section": "🔖 横断コメント",
};

function scopeLabel(scope: string): string {
  return SCOPE_LABEL[scope] ?? "🔖 コメント";
}

/**
 * Block-level node for standalone comments (`scope="cross-section"` or
 * `scope="global"`). Standalone comments are not anchored to a text range —
 * they live as a self-contained block in the document and serialize to a
 * single open marker:
 *
 *   <!-- @comment id="..." author="..." date="..." body="..." scope="global" -->
 *
 * (No matching `<!-- /@comment -->` closer.)
 *
 * Counterpart: see CommentMark for the anchored ("inline" / "block") variant.
 */
export const StandaloneCommentNode = Node.create({
  name: "standaloneComment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  defining: true,

  addAttributes() {
    return {
      id: { default: "" },
      author: { default: "" },
      date: { default: "" },
      target: { default: "" },
      body: { default: "" },
      scope: { default: "global" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="standalone-comment"]',
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          const scope = normalizeScope(el.getAttribute("data-comment-scope"));
          if (!isStandaloneScope(scope)) return false;
          return {
            id: el.getAttribute("data-comment-id") ?? "",
            author: el.getAttribute("data-comment-author") ?? "",
            date: el.getAttribute("data-comment-date") ?? "",
            target: el.getAttribute("data-comment-target") ?? "",
            body: el.getAttribute("data-comment-body") ?? "",
            scope,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const scope = String(HTMLAttributes.scope ?? DEFAULT_COMMENT_SCOPE);
    const body = String(node.attrs.body ?? HTMLAttributes.body ?? "");
    const target = String(node.attrs.target ?? HTMLAttributes.target ?? "");
    const children: Array<unknown> = [
      [
        "div",
        { class: "standalone-comment__label" },
        scopeLabel(scope),
      ],
    ];
    if (scope === "cross-section" && target) {
      const sections = target
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      children.push([
        "div",
        { class: "standalone-comment__sections" },
        `対象: ${sections.join(" / ")}`,
      ]);
    }
    children.push([
      "div",
      { class: "standalone-comment__body" },
      body,
    ]);
    return [
      "div",
      mergeAttributes(
        {
          "data-type": "standalone-comment",
          "data-comment-id": HTMLAttributes.id ?? "",
          "data-comment-author": HTMLAttributes.author ?? "",
          "data-comment-date": HTMLAttributes.date ?? "",
          "data-comment-target": target,
          "data-comment-body": body,
          "data-comment-scope": scope,
          class: `standalone-comment standalone-comment--${scope}`,
          contenteditable: "false",
        },
        {}
      ),
      ...children,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            out: string;
            write: (s: string) => void;
            closeBlock: (n: unknown) => void;
          },
          node: { attrs: Record<string, string | null>; type: { name: string } },
          parent: { maybeChild: (i: number) => { type: { name: string } } | null } | null,
          index: number | undefined
        ) {
          const attrs = buildStandaloneCommentAttrs({
            id: node.attrs.id ?? "",
            author: node.attrs.author ?? "",
            date: node.attrs.date ?? "",
            target: node.attrs.target ?? "",
            body: node.attrs.body ?? "",
            scope: normalizeScope(node.attrs.scope),
          });
          state.write(`<!-- @comment ${attrs} -->`);
          // If the next sibling is another standalone comment, stack them on
          // consecutive lines with no blank line between. Otherwise close the
          // block normally so we keep a blank line separator from neighbouring
          // markdown blocks (CommonMark needs that blank line to recognise the
          // HTML comment as an HTML block when round-tripping).
          const next =
            parent && typeof index === "number"
              ? parent.maybeChild(index + 1)
              : null;
          if (next && next.type.name === node.type.name) {
            state.out += "\n";
          } else {
            state.closeBlock(node);
          }
        },
        parse: {
          // Parsing happens via commentDom.transformCommentMarkers: it converts
          // unpaired @comment HTML comments with a standalone scope into the
          // matching <div data-type="standalone-comment"> element that this
          // node's parseHTML rule picks up.
        },
      },
    };
  },

  addCommands() {
    return {
      addStandaloneComment:
        (attrs: StandaloneCommentAttributes) =>
        ({ tr, state, dispatch }) => {
          // Append the node via a raw transaction. The high-level
          // commands.insertContent* APIs both (a) wrap atom blocks with a
          // trailing empty paragraph (causing blank lines between consecutive
          // standalones on save) and (b) replace whatever node the selection
          // currently encloses (the "previous global gets overwritten" bug).
          //
          // TipTap still keeps a trailing empty paragraph at the very end of
          // the doc so the cursor has somewhere to live after an atom. Insert
          // *before* that trailing empty paragraph so consecutive standalones
          // end up as direct top-level siblings with no empty paragraphs
          // sandwiched between them.
          const nodeType = state.schema.nodes[this.name];
          if (!nodeType) return false;
          const created = nodeType.create({
            id: attrs.id,
            author: attrs.author,
            date: attrs.date,
            target: attrs.target ?? "",
            body: attrs.body,
            scope: normalizeScope(attrs.scope),
          });
          const doc = state.doc;
          let insertPos = doc.content.size;
          const last = doc.lastChild;
          if (
            last &&
            last.type.name === "paragraph" &&
            last.content.size === 0
          ) {
            insertPos -= last.nodeSize;
          }
          if (dispatch) {
            tr.insert(insertPos, created);
            dispatch(tr);
          }
          return true;
        },
      removeStandaloneCommentById:
        (id: string) =>
        ({ tr, state, dispatch }) => {
          let removed = false;
          // Walk descendants from the bottom so positions stay valid as we delete.
          const targets: Array<{ pos: number; size: number }> = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs.id === id) {
              targets.push({ pos, size: node.nodeSize });
            }
          });
          for (let i = targets.length - 1; i >= 0; i--) {
            const t = targets[i];
            tr.delete(t.pos, t.pos + t.size);
            removed = true;
          }
          if (removed && dispatch) dispatch(tr);
          return removed;
        },
    };
  },
});
