import Link from "@tiptap/extension-link";
import type { Mark as PmMark, Node as PmNode } from "@tiptap/pm/model";

/**
 * MarkdownLink is the Link mark plus the Markdown round-trip rules this editor
 * needs (#274).
 *
 * Two things happen here that stock `@tiptap/extension-link` +
 * `tiptap-markdown` don't do:
 *
 * 1. **Bare URLs stay bare.** With markdown-it's `linkify` on, a plain
 *    `https://example.com` in the source becomes a link mark whose text equals
 *    its href. prosemirror-markdown's default link serializer writes that back
 *    as an autolink `<https://example.com>`, so merely opening and saving a
 *    file would rewrite its body. The serializer below emits nothing around
 *    such a link, leaving the URL exactly as the author typed it.
 *
 * 2. **`<https://example.com>` stays angle-bracketed.** The distinction is
 *    invisible in the parsed document (both shapes produce the same mark), so
 *    it is carried in an `autolink` attribute that markdown-it's renderer sets
 *    from the token markup. The attribute never reaches the DOM.
 *
 * The classification only affects what gets written to disk; how a link is
 * displayed and clicked is unchanged (see ExternalLinkDecoration and
 * TiptapEditor's click/hover handlers — every scheme-qualified URL, which is
 * every linkified one, is treated as external).
 */

/**
 * Structural subset of prosemirror-markdown's MarkdownSerializerState used
 * below, mirroring MermaidBlock.ts's local declaration so this extension
 * doesn't take a direct dependency on tiptap-markdown's transitive packages.
 */
interface MarkdownWriter {
  /** Set while serializing a link that must not have its text escaped. */
  inAutolink?: boolean;
}

/** Minimal markdown-it surface this extension touches. */
interface MarkdownItLike {
  linkify: { set(options: Record<string, boolean>): unknown };
  renderer: {
    rules: Record<
      string,
      | ((
          tokens: MarkdownItToken[],
          idx: number,
          options: unknown,
          env: unknown,
          self: MarkdownItRenderer
        ) => string)
      | undefined
    >;
  };
}

interface MarkdownItToken {
  markup: string;
  attrSet(name: string, value: string): void;
}

interface MarkdownItRenderer {
  renderToken(
    tokens: MarkdownItToken[],
    idx: number,
    options: unknown
  ): string;
}

/**
 * isBareUrl reports whether the link can be written as its own text — a
 * scheme-qualified, title-less link whose only content is a text node equal to
 * the href and where the mark ends at that node.
 *
 * Same conditions as prosemirror-markdown's (unexported) `isPlainURL`: they
 * decide when the `[text](href)` form is redundant. The difference is what we
 * do with that knowledge — write the URL bare instead of wrapping it in `<>`.
 */
function isBareUrl(mark: PmMark, parent: PmNode, index: number): boolean {
  if (mark.attrs.title || !/^\w+:/.test(String(mark.attrs.href ?? "")))
    return false;
  const content = parent.child(index);
  if (
    !content.isText ||
    content.text !== mark.attrs.href ||
    content.marks[content.marks.length - 1] !== mark
  )
    return false;
  return (
    index === parent.childCount - 1 ||
    !mark.isInSet(parent.child(index + 1).marks)
  );
}

/** `](href "title")` — the closing half of the ordinary `[text](href)` form. */
function closeInlineLink(mark: PmMark): string {
  const href = String(mark.attrs.href ?? "").replace(/[()"]/g, "\\$&");
  const title = mark.attrs.title
    ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`
    : "";
  return `](${href}${title})`;
}

/**
 * markAutolinkTokens makes markdown-it tag `<https://example.com>` links so the
 * serializer can tell them apart from linkified bare URLs. markdown-it sets
 * `token.markup` to `"autolink"` for the angle-bracket form and `"linkify"` for
 * a bare URL it detected; both render as a plain `<a>` otherwise.
 */
function markAutolinkTokens(md: MarkdownItLike): void {
  const previous = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    if (tokens[idx].markup === "autolink") {
      tokens[idx].attrSet("data-autolink", "1");
    }
    return previous
      ? previous(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}

export const MarkdownLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      autolink: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-autolink") === "1",
        // Serialization-only: keep it out of the rendered `<a>` so it can't
        // leak into copied HTML or the DOM the decorations walk.
        renderHTML: () => ({}),
      },
    };
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize: {
          open(state: MarkdownWriter, mark: PmMark, parent: PmNode, index: number) {
            if (mark.attrs.autolink) {
              state.inAutolink = true;
              return "<";
            }
            // `inAutolink` also suppresses escaping of the link's text
            // (prosemirror-markdown checks it when writing text nodes), which
            // is what keeps `_` and friends inside a bare URL literal.
            state.inAutolink = isBareUrl(mark, parent, index);
            return state.inAutolink ? "" : "[";
          },
          close(state: MarkdownWriter, mark: PmMark) {
            const wasAutolink = state.inAutolink;
            state.inAutolink = undefined;
            if (mark.attrs.autolink) return ">";
            return wasAutolink ? "" : closeInlineLink(mark);
          },
          mixable: true,
        },
        parse: {
          setup(this: unknown, markdownit: MarkdownItLike) {
            // Only scheme-qualified URLs become links. markdown-it's fuzzy
            // matching would also link `www.example.com` and bare e-mail
            // addresses, whose link text differs from the generated href — the
            // serializer would then have to write `[www.example.com](http://…)`
            // and rewrite the file on save.
            markdownit.linkify.set({
              fuzzyLink: false,
              fuzzyEmail: false,
              fuzzyIP: false,
            });
            markAutolinkTokens(markdownit);
          },
        },
      },
    };
  },
});
