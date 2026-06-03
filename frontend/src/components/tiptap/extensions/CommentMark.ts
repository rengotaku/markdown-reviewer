import { Mark, mergeAttributes } from "@tiptap/core";
import {
  buildCommentAttrs,
  DEFAULT_COMMENT_SCOPE,
  normalizeScope,
} from "@/utils/commentAttrs";
import { transformCommentMarkers } from "./commentDom";

export interface CommentAttributes {
  id: string;
  author: string;
  date: string;
  body: string;
  /**
   * Comment scope. Defaults to "inline". Only "inline" / "block" make sense
   * for the wrapping mark — "cross-section" / "global" live as standalone
   * nodes (see StandaloneCommentNode).
   */
  scope?: string;
  /**
   * Group identifier shared by every block-scope marker created in one
   * cross-section action. Lets the side pane fold N markers back into one
   * logical comment. Empty / null for plain (non-grouped) block comments.
   */
  groupId?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      setComment: (attrs: CommentAttributes) => ReturnType;
      unsetComment: () => ReturnType;
      unsetCommentById: (id: string) => ReturnType;
      updateCommentBodyById: (id: string, body: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  // Disallow nesting: applying CommentMark over an existing CommentMark replaces it.
  excludes: "comment",

  addAttributes() {
    return {
      id: { default: null },
      author: { default: null },
      date: { default: null },
      body: { default: null },
      scope: { default: DEFAULT_COMMENT_SCOPE },
      groupId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-comment-id]",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            id: el.getAttribute("data-comment-id"),
            author: el.getAttribute("data-comment-author"),
            date: el.getAttribute("data-comment-date"),
            body: el.getAttribute("data-comment-body"),
            scope: normalizeScope(el.getAttribute("data-comment-scope")),
            groupId: el.getAttribute("data-comment-group-id") || null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = {
      "data-comment-id": HTMLAttributes.id ?? "",
      "data-comment-author": HTMLAttributes.author ?? "",
      "data-comment-date": HTMLAttributes.date ?? "",
      "data-comment-body": HTMLAttributes.body ?? "",
      "data-comment-scope": HTMLAttributes.scope ?? DEFAULT_COMMENT_SCOPE,
      class: "comment-mark",
    };
    if (HTMLAttributes.groupId) {
      attrs["data-comment-group-id"] = HTMLAttributes.groupId;
    }
    return [
      "span",
      mergeAttributes(
        attrs,
        // Drop bare attribute keys — only the data-* form is rendered.
        {}
      ),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: unknown, mark: { attrs: Record<string, string | null> }) {
            const attrs = buildCommentAttrs({
              id: mark.attrs.id ?? "",
              author: mark.attrs.author ?? "",
              date: mark.attrs.date ?? "",
              body: mark.attrs.body ?? "",
              scope: mark.attrs.scope ?? "",
              groupId: mark.attrs.groupId ?? "",
            });
            return `<!-- @comment ${attrs} -->`;
          },
          close() {
            return "<!-- /@comment -->";
          },
          // mixable: true → let prosemirror-markdown reorder this mark
          // relative to other inline marks (bold/italic/etc.) instead of
          // hard-closing and reopening at each format boundary. Without
          // this, a comment wrapping `text **bold** more` serializes as
          // six fragmented `<!-- @comment -->` pairs. Code marks remain
          // a forced boundary (markdown's backtick spans can't contain
          // other marks), but that's far less common.
          mixable: true,
          expelEnclosingWhitespace: false,
        },
        parse: {
          updateDOM(element: HTMLElement) {
            transformCommentMarkers(element);
          },
        },
      },
    };
  },

  addCommands() {
    return {
      setComment:
        (attrs: CommentAttributes) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetComment:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      unsetCommentById:
        (id: string) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks[this.name];
          if (!markType) return false;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(
              (m) => m.type === markType && m.attrs.id === id
            );
            if (!mark) return;
            tr.removeMark(pos, pos + node.nodeSize, mark);
            changed = true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      // Edit just the body of an existing comment mark, leaving every other
      // attribute (id / author / date / scope / groupId) intact. Works for
      // grouped (cross-section) comments too — pass any member id and every
      // text node sharing the same groupId is rewritten.
      updateCommentBodyById:
        (id: string, body: string) =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks[this.name];
          if (!markType) return false;
          // First find the canonical groupId so we can sweep grouped members.
          let groupId: string | null = null;
          state.doc.descendants((node) => {
            if (groupId !== null || !node.isText) return;
            const m = node.marks.find(
              (mk) => mk.type === markType && mk.attrs.id === id
            );
            if (m) groupId = (m.attrs.groupId as string | null) ?? "";
          });
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find((m) => {
              if (m.type !== markType) return false;
              if (groupId) return m.attrs.groupId === groupId;
              return m.attrs.id === id;
            });
            if (!mark) return;
            const nextMark = markType.create({ ...mark.attrs, body });
            tr.removeMark(pos, pos + node.nodeSize, mark);
            tr.addMark(pos, pos + node.nodeSize, nextMark);
            changed = true;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },
});
