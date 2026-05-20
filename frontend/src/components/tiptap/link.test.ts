import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";

function createEditor(initialContent = "") {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: true, autolink: true, linkOnPaste: true }),
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: false,
      }),
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

function findLinkMark(editor: Editor, href: string): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === "link" && mark.attrs.href === href) {
        found = true;
      }
    });
  });
  return found;
}

describe("markdown link syntax [label](url)", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it("parses [label](url) as a link mark with correct href", () => {
    editor = createEditor();
    editor.commands.setContent("[example](https://example.com)");
    expect(findLinkMark(editor, "https://example.com")).toBe(true);
  });

  it("preserves link text in markdown round-trip", () => {
    editor = createEditor();
    editor.commands.setContent("[example](https://example.com)");
    const output = getMarkdown(editor);
    expect(output).toContain("example");
    expect(output).toContain("https://example.com");
  });

  it("parses http:// link syntax", () => {
    editor = createEditor();
    editor.commands.setContent("[site](http://example.com)");
    expect(findLinkMark(editor, "http://example.com")).toBe(true);
  });

  it("parses multiple links in a paragraph", () => {
    editor = createEditor();
    editor.commands.setContent(
      "[first](https://first.example.com) and [second](https://second.example.com)"
    );
    expect(findLinkMark(editor, "https://first.example.com")).toBe(true);
    expect(findLinkMark(editor, "https://second.example.com")).toBe(true);
  });
});

describe("autolink: plain URL text detection", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it("auto-links https:// URL when followed by space", () => {
    editor = createEditor();
    editor.commands.insertContent("https://example.com ");
    expect(findLinkMark(editor, "https://example.com")).toBe(true);
  });

  it("auto-links http:// URL when followed by space", () => {
    editor = createEditor();
    editor.commands.insertContent("http://example.com ");
    expect(findLinkMark(editor, "http://example.com")).toBe(true);
  });
});

describe("Link extension configuration", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it("has openOnClick enabled", () => {
    editor = createEditor();
    const linkExtension = editor.extensionManager.extensions.find(
      (ext) => ext.name === "link"
    );
    expect(linkExtension?.options.openOnClick).toBe(true);
  });

  it("has autolink enabled", () => {
    editor = createEditor();
    const linkExtension = editor.extensionManager.extensions.find(
      (ext) => ext.name === "link"
    );
    expect(linkExtension?.options.autolink).toBe(true);
  });

  it("has linkOnPaste enabled", () => {
    editor = createEditor();
    const linkExtension = editor.extensionManager.extensions.find(
      (ext) => ext.name === "link"
    );
    expect(linkExtension?.options.linkOnPaste).toBe(true);
  });
});
