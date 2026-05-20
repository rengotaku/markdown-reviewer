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
      'Hello <!-- @comment id="c1" author="kishira" date="2026-05-20" target="hello" -->body text<!-- /@comment --> world.';
    editor = createEditor(md);
    let found: { id: string; author: string; date: string; target: string; text: string } | null =
      null;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === "comment");
      if (!mark) return;
      found = {
        id: mark.attrs.id,
        author: mark.attrs.author,
        date: mark.attrs.date,
        target: mark.attrs.target,
        text: node.text ?? "",
      };
    });
    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      id: "c1",
      author: "kishira",
      date: "2026-05-20",
      target: "hello",
      text: "body text",
    });
  });

  it("serializes a comment mark back to HTML comment markers", () => {
    editor = createEditor("plain paragraph");
    editor
      .chain()
      .setTextSelection({ from: 1, to: 1 })
      .insertContent({
        type: "text",
        text: "body",
        marks: [
          {
            type: "comment",
            attrs: {
              id: "x1",
              author: "k",
              date: "2026-05-20",
              target: "snippet",
            },
          },
        ],
      })
      .run();
    const md = getMarkdown(editor);
    expect(md).toContain(
      '<!-- @comment id="x1" author="k" date="2026-05-20" target="snippet" -->body<!-- /@comment -->'
    );
  });

  it("round-trips read → write without producing a diff", () => {
    const original =
      'Intro paragraph.\n\nLine with <!-- @comment id="abc" author="kishira" date="2026-05-20" target="word" -->note<!-- /@comment --> inline.';
    editor = createEditor(original);
    const out = getMarkdown(editor);
    expect(out.trim()).toBe(original.trim());
  });

  it("escapes special characters in target attribute on round-trip", () => {
    const original =
      'Pre <!-- @comment id="c2" author="k" date="2026-05-20" target="say \\"hi\\"" -->note<!-- /@comment --> post.';
    editor = createEditor(original);
    let target = "";
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === "comment");
      if (mark) target = mark.attrs.target;
    });
    expect(target).toBe('say "hi"');
    const out = getMarkdown(editor);
    // Round-trip emits the same escaped form.
    expect(out).toContain('target="say \\"hi\\""');
  });

  it("removes a comment by id without touching unrelated marks", () => {
    const md =
      '<!-- @comment id="c1" author="k" date="2026-05-20" target="x" -->one<!-- /@comment --> and <!-- @comment id="c2" author="k" date="2026-05-20" target="y" -->two<!-- /@comment -->.';
    editor = createEditor(md);
    editor.commands.unsetCommentById("c1");
    const out = getMarkdown(editor);
    expect(out).not.toContain('id="c1"');
    expect(out).toContain('id="c2"');
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
        target: "plain",
      })
      .run();
    editor
      .chain()
      .setTextSelection({ from: 1, to: 6 })
      .setComment({
        id: "second",
        author: "k",
        date: "2026-05-20",
        target: "plain",
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
