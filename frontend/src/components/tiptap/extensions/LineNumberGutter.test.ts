import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { computeLineNumbers } from "@/utils/lineNumbers";
import { computeDiffGutterMarks } from "@/utils/diffGutterMarks";
import { DiffGutter } from "./DiffGutter";
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

// #270: same contract as DiffGutter — numbers stay glued to their block for an
// in-block edit and vanish as soon as the block count stops matching.
describe("LineNumberGutter — doc changes (#270)", () => {
  it("keeps the number on its block while editing inside that block", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setLineNumbers({ lines: [1, 3], blockCount: 2 });
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " more");

    const numbered = Array.from(
      ed.view.dom.querySelectorAll("[data-line-number]")
    );
    expect(numbered).toHaveLength(2);
    expect(numbered[1].getAttribute("data-line-number")).toBe("3");
    expect(numbered[1].textContent).toBe("body more");
  });

  it("clears the numbers once a new top-level block appears", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setLineNumbers({ lines: [1, 3], blockCount: 2 });
    expect(ed.view.dom.querySelectorAll("[data-line-number]")).toHaveLength(2);

    ed.commands.insertContentAt(ed.state.doc.content.size, "<p>third</p>");
    expect(ed.view.dom.querySelectorAll("[data-line-number]")).toHaveLength(0);
  });
});

// #368: lists and tables are numbered per item / row, in the same order as
// gutterUnitRanges() walks the markdown.
describe("LineNumberGutter — list items and table rows (#368)", () => {
  function makeFullEditor(content: string): Editor {
    editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        TaskList,
        TaskItem.configure({ nested: true }),
        LineNumberGutter,
      ],
      content,
    });
    return editor;
  }

  function labelled(ed: Editor): string[] {
    return Array.from(ed.view.dom.querySelectorAll("[data-line-number]")).map(
      (el) => `${el.tagName.toLowerCase()}:${el.getAttribute("data-line-number")}`
    );
  }

  it("numbers each item, nested items after their parent", () => {
    const ed = makeFullEditor(
      "<ol><li><p>a</p><ul><li><p>a1</p></li></ul></li><li><p>b</p></li></ol>"
    );
    ed.commands.setLineNumbers({ lines: [1, 2, 3], blockCount: 3 });
    expect(labelled(ed)).toEqual(["li:1", "li:2", "li:3"]);
  });

  it("numbers task items like any other list item", () => {
    const ed = makeFullEditor(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>a</p></li>' +
        '<li data-type="taskItem" data-checked="true"><p>b</p></li></ul>'
    );
    ed.commands.setLineNumbers({ lines: [1, 2], blockCount: 2 });
    expect(labelled(ed)).toEqual(["li:1", "li:2"]);
  });

  it("numbers each table row", () => {
    const ed = makeFullEditor(
      "<table><tr><th><p>x</p></th></tr><tr><td><p>1</p></td></tr><tr><td><p>2</p></td></tr></table>"
    );
    ed.commands.setLineNumbers({ lines: [1, 3, 4], blockCount: 3 });
    expect(labelled(ed)).toEqual(["tr:1", "tr:3", "tr:4"]);
  });
});

// #368: tiptap-markdown splits a list mixing plain and task items into
// several lists (sometimes with an extra empty task item), so its items no
// longer line up with markdown-it's. Only that list falls back to one label;
// the rest of the doc keeps per-item / per-row labels.
describe("gutters — a block the two parsers split differently (#368)", () => {
  const body = "# T\n\n- a\n  - b\n  - [ ] c\n- d\n\ntext\n\n- x\n- y\n";

  function loadMarkdown(markdown: string): Editor {
    editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Markdown,
        DiffGutter,
        LineNumberGutter,
      ],
      content: markdown,
    });
    return editor;
  }

  it("labels the mismatched list as a whole and keeps the others per item", () => {
    const ed = loadMarkdown(body);
    ed.commands.setLineNumbers(computeLineNumbers(body, body));
    const labelled = Array.from(ed.view.dom.querySelectorAll("[data-line-number]")).map(
      (el) => `${el.tagName.toLowerCase()}:${el.getAttribute("data-line-number")}`
    );
    expect(labelled).toEqual(["h1:1", "ul:3", "p:8", "li:10", "li:11"]);
  });

  it("puts a change inside the mismatched list on the list itself", () => {
    const ed = loadMarkdown(body);
    const before = "# T\n\n- a\n  - b\n  - [ ] old\n- d\n\ntext\n\n- x\n- y\n";
    ed.commands.setDiffGutter(computeDiffGutterMarks(before, body));
    const marked = Array.from(ed.view.dom.querySelectorAll(".diff-gutter-mod")).map((el) =>
      el.tagName.toLowerCase()
    );
    expect(marked).toEqual(["ul"]);
  });
});
