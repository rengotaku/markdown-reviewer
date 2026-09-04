import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { ExternalLinkDecoration } from "./extensions/ExternalLinkDecoration";
import { MarkdownLink } from "./extensions/MarkdownLink";

function createEditor(initialContent = "") {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      MarkdownLink.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
      }),
      Markdown.configure({
        linkify: true,
        transformPastedText: true,
        transformCopiedText: false,
      }),
      ExternalLinkDecoration,
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

// External-link decoration (#215 follow-up) is CSS/decoration-only — it
// must never leak into the serialized markdown. Regression coverage for
// that guarantee lives here (round-trip), the visual/classification
// behavior is covered by ExternalLinkDecoration.test.ts.
describe("external-link decoration does not affect markdown round-trip", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it("round-trips a document containing an external link unchanged", () => {
    const source = "before [example](https://example.com) after";
    editor = createEditor();
    editor.commands.setContent(source);
    editor.commands.setLinkBasePath("docs/intro.md");
    expect(getMarkdown(editor)).toBe(source);
  });

  it("round-trips a document containing an internal relative link unchanged", () => {
    const source = "see [sibling](./sibling.md) for details";
    editor = createEditor();
    editor.commands.setContent(source);
    editor.commands.setLinkBasePath("docs/intro.md");
    expect(getMarkdown(editor)).toBe(source);
  });
});

// Bare URLs (#274). markdown-it's linkify turns them into links so a reader
// can click them; the serializer has to hand them back to the file byte for
// byte, or opening and saving a document would rewrite its body.
describe("bare URL text (linkify)", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it("links a bare https:// URL in the source", () => {
    editor = createEditor();
    editor.commands.setContent("see https://example.com for details");
    expect(findLinkMark(editor, "https://example.com")).toBe(true);
  });

  it("writes a bare URL back without angle brackets or link syntax", () => {
    const source = "see https://example.com for details";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("keeps query strings and underscores literal in a bare URL", () => {
    const source = "https://example.com/a_b?x=1&y=2";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("keeps an angle-bracketed autolink angle-bracketed", () => {
    const source = "see <https://example.com> for details";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("leaves a bare URL at the end of a sentence's trailing period alone", () => {
    const source = "docs: https://example.com/page";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("does not link www. hosts (fuzzy matching is off)", () => {
    const source = "see www.example.com for details";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(findLinkMark(editor, "http://www.example.com")).toBe(false);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("does not link bare e-mail addresses (fuzzy matching is off)", () => {
    const source = "mail me at someone@example.com please";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("still writes an ordinary [text](url) link in inline form", () => {
    const source = "[example](https://example.com)";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("writes a link whose text happens to equal a relative path in inline form", () => {
    const source = "[./sibling.md](./sibling.md)";
    editor = createEditor();
    editor.commands.setContent(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it("treats a linkified bare URL as external", () => {
    editor = createEditor();
    editor.commands.setContent("see https://example.com for details");
    editor.commands.setLinkBasePath("docs/intro.md");
    const icons = editor.view.dom.querySelectorAll(".ext-link-icon");
    expect(icons).toHaveLength(1);
    expect(icons[0].textContent).toBe("https://example.com");
  });

  it("does not leak the autolink attribute into the rendered anchor", () => {
    editor = createEditor();
    editor.commands.setContent("<https://example.com>");
    expect(editor.getHTML()).not.toContain("autolink");
  });
});
