import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { ExternalLinkDecoration } from "./ExternalLinkDecoration";

// Exercises the external-link decoration plugin against a real (headless)
// editor — same style as DiffGutter.test.ts. `Link` (not the schema-level
// mark alone) is required so `resolveInternalLink`'s job of telling
// "external" from "internal (same-root relative)" from "in-page anchor"
// actually has real hrefs to classify.

let editor: Editor | null = null;

function makeEditor(content: string, basePath = "docs/intro.md"): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: false }),
      ExternalLinkDecoration,
    ],
    content,
  });
  editor.commands.setLinkBasePath(basePath);
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function iconEls(ed: Editor) {
  return Array.from(ed.view.dom.querySelectorAll(".ext-link-icon"));
}

describe("ExternalLinkDecoration", () => {
  it("marks a scheme-qualified (external) link", () => {
    const ed = makeEditor('<p><a href="https://example.com">ext</a></p>');
    expect(iconEls(ed)).toHaveLength(1);
    expect(iconEls(ed)[0].textContent).toBe("ext");
  });

  it("does not mark an internal same-root relative link", () => {
    const ed = makeEditor('<p><a href="./sibling.md">sibling</a></p>');
    expect(iconEls(ed)).toHaveLength(0);
  });

  it("does not mark a pure in-page anchor link", () => {
    const ed = makeEditor('<p><a href="#heading">heading</a></p>');
    expect(iconEls(ed)).toHaveLength(0);
  });

  it("does not mark plain (non-link) text", () => {
    const ed = makeEditor("<p>just text</p>");
    expect(iconEls(ed)).toHaveLength(0);
  });

  it("recomputes when the base path changes", () => {
    // `../other/target.md` resolved from `docs/intro.md` stays inside the
    // root (internal); resolved from the root itself (`intro.md`) it would
    // walk past the root and become unresolvable — i.e. "external" per the
    // same rule LinkPreviewCard/TiptapEditor's click handler use.
    const ed = makeEditor(
      '<p><a href="../other/target.md">t</a></p>',
      "docs/intro.md"
    );
    expect(iconEls(ed)).toHaveLength(0);

    ed.commands.setLinkBasePath("intro.md");
    expect(iconEls(ed)).toHaveLength(1);
  });

  it("does not alter the markdown-relevant doc content, only decorations", () => {
    const ed = makeEditor('<p><a href="https://example.com">ext</a></p>');
    // The decoration wraps the text in an extra <span>, but the underlying
    // ProseMirror doc (what tiptap-markdown serializes from) is untouched.
    expect(ed.getText()).toBe("ext");
  });
});

// #270: the full doc.descendants() scan no longer runs per keystroke. Existing
// icons are mapped through the change; a link that appears or changes target
// while typing is picked up by the resync that TiptapEditor fires from its
// 250ms markdown debounce.
describe("ExternalLinkDecoration — mapping vs resync (#270)", () => {
  it("keeps an existing icon on its link across an unrelated edit", () => {
    const ed = makeEditor('<p><a href="https://example.com">ext</a></p><p>x</p>');
    expect(iconEls(ed)).toHaveLength(1);

    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "yz");

    expect(iconEls(ed)).toHaveLength(1);
    expect(iconEls(ed)[0].textContent).toBe("ext");
  });

  it("picks up a link added after load once resync runs", () => {
    const ed = makeEditor("<p>plain</p>");
    expect(iconEls(ed)).toHaveLength(0);

    ed.commands.insertContentAt(
      ed.state.doc.content.size - 1,
      '<a href="https://example.com">ext</a>'
    );
    ed.commands.resyncLinkDecorations();

    expect(iconEls(ed)).toHaveLength(1);
    expect(iconEls(ed)[0].textContent).toBe("ext");
  });

  it("drops the icon on resync once the link becomes internal", () => {
    const ed = makeEditor('<p><a href="https://example.com">ext</a></p>');
    expect(iconEls(ed)).toHaveLength(1);

    ed.commands.setTextSelection({ from: 1, to: 4 });
    ed.commands.setLink({ href: "./sibling.md" });
    ed.commands.resyncLinkDecorations();

    expect(iconEls(ed)).toHaveLength(0);
  });
});
