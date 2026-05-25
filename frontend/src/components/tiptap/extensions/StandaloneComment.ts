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
            write: (s: string) => void;
            closeBlock: (n: unknown) => void;
          },
          node: { attrs: Record<string, string | null> }
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
          state.closeBlock(node);
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
        ({ commands, state }) =>
          // Always append at the very end of the document. Inserting at the
          // current selection makes the command sensitive to where the cursor
          // happens to be when the dialog closes — e.g. if the editor's
          // selection ends up wrapping a previously-inserted standalone node,
          // the next insertContent would *replace* that node instead of
          // appending. Pinning to doc.size makes the behavior deterministic.
          commands.insertContentAt(state.doc.content.size, {
            type: this.name,
            attrs: {
              id: attrs.id,
              author: attrs.author,
              date: attrs.date,
              target: attrs.target ?? "",
              body: attrs.body,
              scope: normalizeScope(attrs.scope),
            },
          }),
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
