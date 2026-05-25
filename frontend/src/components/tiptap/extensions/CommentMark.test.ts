import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { CommentMark } from "./CommentMark";

function createEditor(initialContent = ""): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
      CommentMark,
    ],
    content: initialContent,
  });
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("CommentMark", () => {
  it("parses an HTML comment pair into a comment mark", () => {
    const md =
      'Hello <!-- @comment id="c1" author="kishira" date="2026-05-20" body="please fix" -->body text<!-- /@comment --> world.';
    editor = createEditor(md);
    let found: {
      id: string;
      author: string;
      date: string;
      body: string;
      text: string;
    } | null = null;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === "comment");
      if (!mark) return;
      found = {
        id: mark.attrs.id,
        author: mark.attrs.author,
        date: mark.attrs.date,
        body: mark.attrs.body,
        text: node.text ?? "",
      };
    });
    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      id: "c1",
      author: "kishira",
      date: "2026-05-20",
      body: "please fix",
      text: "body text",
    });
  });

  it("serializes a comment mark back to HTML comment markers (Notion-style)", () => {
    editor = createEditor("plain paragraph");
    editor
      .chain()
      .setTextSelection({ from: 1, to: 6 })
      .setComment({
        id: "x1",
        author: "k",
        date: "2026-05-20",
        body: "review me",
      })
      .run();
    const md = getMarkdown(editor);
    expect(md).toContain(
      '<!-- @comment id="x1" author="k" date="2026-05-20" body="review me" -->plain<!-- /@comment -->'
    );
    // target attribute is no longer emitted for wrapped comments.
    expect(md).not.toContain("target=");
  });

  it("round-trips read → write without producing a diff (no target attr)", () => {
    const original =
      'Intro paragraph.\n\nLine with <!-- @comment id="abc" author="kishira" date="2026-05-20" body="note body" -->note<!-- /@comment --> inline.';
    editor = createEditor(original);
    const out = getMarkdown(editor);
    expect(out.trim()).toBe(original.trim());
  });

  it("drops legacy target attribute on save (redundant with wrapped text)", () => {
    const original =
      'Pre <!-- @comment id="c2" author="k" date="2026-05-20" target="say \\"hi\\"" body="" -->note<!-- /@comment --> post.';
    editor = createEditor(original);
    const out = getMarkdown(editor);
    expect(out).not.toContain("target=");
    // The wrapped text and other attributes survive.
    expect(out).toContain('id="c2"');
    expect(out).toContain("-->note<!-- /@comment -->");
  });

  it("removes a comment by id without touching unrelated marks", () => {
    const md =
      '<!-- @comment id="c1" author="k" date="2026-05-20" body="" -->one<!-- /@comment --> and <!-- @comment id="c2" author="k" date="2026-05-20" body="" -->two<!-- /@comment -->.';
    editor = createEditor(md);
    editor.commands.unsetCommentById("c1");
    const out = getMarkdown(editor);
    expect(out).not.toContain('id="c1"');
    expect(out).toContain('id="c2"');
  });

  it("defaults to scope=inline and omits the scope attribute on serialize", () => {
    editor = createEditor("plain text");
    editor
      .chain()
      .setTextSelection({ from: 1, to: 6 })
      .setComment({
        id: "s1",
        author: "k",
        date: "2026-05-25",
        body: "no scope arg",
      })
      .run();
    const md = getMarkdown(editor);
    // Default scope must not leak into the file format (backward compat).
    expect(md).not.toContain("scope=");
  });

  it("round-trips an explicit scope=block attribute on a wrapping comment", () => {
    const original =
      'A <!-- @comment id="b1" author="k" date="2026-05-25" body="block-level note" scope="block" -->paragraph<!-- /@comment --> end.';
    editor = createEditor(original);
    let scope = "";
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === "comment");
      if (mark) scope = mark.attrs.scope ?? "";
    });
    expect(scope).toBe("block");
    const out = getMarkdown(editor);
    expect(out).toContain('scope="block"');
  });

  it("falls back to scope=inline for legacy markers missing the attribute", () => {
    const original =
      '<!-- @comment id="legacy" author="k" date="2026-05-25" body="b" -->word<!-- /@comment -->';
    editor = createEditor(original);
    let scope = "";
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === "comment");
      if (mark) scope = mark.attrs.scope ?? "";
    });
    expect(scope).toBe("inline");
    // Legacy file (no target, no scope) round-trips byte-for-byte.
    expect(getMarkdown(editor).trim()).toBe(original.trim());
  });

  it("excludes nesting — a second comment mark replaces the existing one over the same range", () => {
    editor = createEditor("plain");
    editor
      .chain()
      .setTextSelection({ from: 1, to: 6 })
      .setComment({
        id: "first",
        author: "k",
        date: "2026-05-20",
        body: "",
      })
      .run();
    editor
      .chain()
      .setTextSelection({ from: 1, to: 6 })
      .setComment({
        id: "second",
        author: "k",
        date: "2026-05-20",
        body: "",
      })
      .run();
    let count = 0;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      count += node.marks.filter((m) => m.type.name === "comment").length;
    });
    // Each marked text node should still carry exactly one comment mark.
    expect(count).toBeGreaterThan(0);
    let nestedSeen = 0;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const c = node.marks.filter((m) => m.type.name === "comment").length;
      if (c > 1) nestedSeen += 1;
    });
    expect(nestedSeen).toBe(0);
  });
});
