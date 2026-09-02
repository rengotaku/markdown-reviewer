import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlankLines } from "./BlankLines";

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), BlankLines],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function blanksBefore(ed: Editor): number[] {
  const values: number[] = [];
  ed.state.doc.forEach((node) => {
    values.push((node.attrs.blankLinesBefore as number) ?? 0);
  });
  return values;
}

describe("BlankLines", () => {
  it("sets blankLinesBefore on each top-level block when blockCount matches", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [2, 0], blockCount: 2 });
    expect(blanksBefore(ed)).toEqual([2, 0]);
  });

  it("renders the blank-line attribute as a data attribute and inline style", () => {
    const ed = makeEditor("<p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [3], blockCount: 1 });
    const p = ed.view.dom.querySelector("p");
    expect(p?.getAttribute("data-blank-lines-before")).toBe("3");
    expect(p?.getAttribute("style")).toContain("--blank-line-height");
  });

  it("omits the attribute entirely when the extra count is zero", () => {
    const ed = makeEditor("<p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [0], blockCount: 1 });
    const p = ed.view.dom.querySelector("p");
    expect(p?.hasAttribute("data-blank-lines-before")).toBe(false);
  });

  it("does nothing when blockCount disagrees with the live doc", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [1, 2, 3], blockCount: 3 });
    expect(blanksBefore(ed)).toEqual([0, 0]);
  });

  it("does nothing when the payload is empty", () => {
    const ed = makeEditor("<p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [], blockCount: 0 });
    expect(blanksBefore(ed)).toEqual([0]);
  });

  it("ignores the phantom trailing paragraph after a list", () => {
    const ed = makeEditor("<p>intro</p><ul><li>a</li></ul>");
    ed.commands.setBlankLinesBefore({ extras: [0, 2], blockCount: 2 });
    expect(blanksBefore(ed).slice(0, 2)).toEqual([0, 2]);
  });

  it("does not create an undo step", () => {
    const ed = makeEditor("<p>body</p>");
    const before = ed.state.doc.toJSON();
    ed.commands.setBlankLinesBefore({ extras: [4], blockCount: 1 });
    expect(blanksBefore(ed)).toEqual([4]);
    ed.commands.undo();
    expect(ed.state.doc.toJSON()).not.toEqual(before);
    // undo() should be a no-op here since the attribute write wasn't added
    // to history — the paragraph text content is unchanged either way.
    expect(ed.state.doc.textContent).toBe("body");
  });
});
