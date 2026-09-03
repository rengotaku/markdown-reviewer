import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { LineNumberGutter } from "./LineNumberGutter";

// Mirrors DiffGutter.test.ts: the numbers are top-level block indices coming
// from markdown-it, and the plugin cross-checks blockCount against the live
// doc before painting so a mismatch never labels the wrong block.

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), LineNumberGutter],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function numbers(ed: Editor): string[] {
  return Array.from(ed.view.dom.querySelectorAll("[data-line-number]")).map(
    (el) => el.getAttribute("data-line-number") ?? ""
  );
}

describe("LineNumberGutter", () => {
  it("labels each top-level block with its source line", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setLineNumbers({ lines: [1, 3], blockCount: 2 });
    expect(numbers(ed)).toEqual(["1", "3"]);
  });

  it("renders nothing when the payload is empty", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setLineNumbers({ lines: [], blockCount: 0 });
    expect(numbers(ed)).toEqual([]);
  });

  it("renders nothing when blockCount disagrees with the doc", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setLineNumbers({ lines: [1, 3, 5], blockCount: 3 });
    expect(numbers(ed)).toEqual([]);
  });

  it("ignores the phantom trailing paragraph tiptap appends after a list", () => {
    const ed = makeEditor("<p>intro</p><ul><li>a</li></ul>");
    ed.commands.setLineNumbers({ lines: [1, 3], blockCount: 2 });
    expect(numbers(ed).slice(0, 2)).toEqual(["1", "3"]);
  });

  it("keeps the numbers after an unrelated doc edit", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setLineNumbers({ lines: [1, 3], blockCount: 2 });
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "!");
    expect(numbers(ed)).toEqual(["1", "3"]);
  });
});

describe("LineNumberGutter with blank-line paragraphs (#261)", () => {
  it("skips blank-line paragraphs when aligning payload indices to doc children", () => {
    // Doc: [blank, heading, blank, blank, paragraph] — 2 content blocks.
    const ed = makeEditor("<p></p><h2>title</h2><p></p><p></p><p>body</p>");
    ed.commands.setLineNumbers({ lines: [1, 4], blockCount: 2 });
    const decorated = Array.from(
      ed.view.dom.querySelectorAll("[data-line-number]")
    );
    expect(decorated.map((el) => el.tagName.toLowerCase())).toEqual(["h2", "p"]);
    expect(decorated.map((el) => el.getAttribute("data-line-number"))).toEqual(["1", "4"]);
    expect(decorated[1].textContent).toBe("body");
  });
});
