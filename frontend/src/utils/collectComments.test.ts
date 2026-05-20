import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { CommentMark } from "@/components/tiptap/extensions/CommentMark";
import { collectComments } from "./collectComments";

function createEditor(content = ""): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
      CommentMark,
    ],
    content,
  });
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("collectComments", () => {
  it("returns [] for null editor", () => {
    expect(collectComments(null)).toEqual([]);
  });

  it("returns [] for editor without any comments", () => {
    editor = createEditor("Just plain text.");
    expect(collectComments(editor)).toEqual([]);
  });

  it("extracts comment body from mark attrs and target from wrapped text", () => {
    editor = createEditor(
      'Pre <!-- @comment id="c1" author="k" date="2026-05-20" target="word" body="fix this" -->word<!-- /@comment --> post.'
    );
    const result = collectComments(editor);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "c1",
      author: "k",
      date: "2026-05-20",
      target: "word",
      body: "fix this",
    });
    expect(result[0].from).toBeGreaterThan(0);
    expect(result[0].to).toBeGreaterThan(result[0].from);
  });

  it("returns [] when editor is destroyed", () => {
    editor = createEditor("text");
    editor.destroy();
    expect(collectComments(editor)).toEqual([]);
    editor = null;
  });

  it("collects multiple distinct comments", () => {
    editor = createEditor(
      '<!-- @comment id="c1" author="k" date="2026-05-20" target="a" body="x" -->a<!-- /@comment --> and <!-- @comment id="c2" author="k" date="2026-05-20" target="b" body="y" -->b<!-- /@comment -->.'
    );
    const result = collectComments(editor);
    expect(result.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
