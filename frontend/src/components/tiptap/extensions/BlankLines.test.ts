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

/** Top-level node type names, in doc order — used to see where blank-line
 *  (empty paragraph) nodes landed relative to content blocks. */
function childTypes(ed: Editor): string[] {
  const types: string[] = [];
  ed.state.doc.forEach((node) => {
    types.push(node.type.name === "paragraph" && node.content.size === 0 ? "blank" : node.type.name);
  });
  return types;
}

describe("BlankLines", () => {
  it("inserts an empty paragraph before each block for its extra count", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [2, 0], blockCount: 2 });
    expect(childTypes(ed)).toEqual(["blank", "blank", "heading", "paragraph"]);
  });

  it("the inserted paragraphs are real, empty, editable doc nodes", () => {
    const ed = makeEditor("<p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [3], blockCount: 1 });
    const ps = ed.view.dom.querySelectorAll("p");
    // 3 blank paragraphs + the original "body" paragraph.
    expect(ps).toHaveLength(4);
    expect(ps[0].textContent).toBe("");
    expect(ps[1].textContent).toBe("");
    expect(ps[2].textContent).toBe("");
    expect(ps[3].textContent).toBe("body");
  });

  it("inserts nothing when the extra count is zero", () => {
    const ed = makeEditor("<p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [0], blockCount: 1 });
    expect(childTypes(ed)).toEqual(["paragraph"]);
  });

  it("does nothing when blockCount disagrees with the live doc", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [1, 2, 3], blockCount: 3 });
    expect(childTypes(ed)).toEqual(["heading", "paragraph"]);
  });

  it("does nothing when the payload is empty", () => {
    const ed = makeEditor("<p>body</p>");
    ed.commands.setBlankLinesBefore({ extras: [], blockCount: 0 });
    expect(childTypes(ed)).toEqual(["paragraph"]);
  });

  it("ignores the phantom trailing paragraph after a list", () => {
    const ed = makeEditor("<p>intro</p><ul><li>a</li></ul>");
    ed.commands.setBlankLinesBefore({ extras: [0, 2], blockCount: 2 });
    // 2 blanks land right before the list; the phantom trailing <p> (from
    // the list) survives untouched at the very end.
    expect(childTypes(ed)).toEqual(["paragraph", "blank", "blank", "bulletList", "blank"]);
  });

  it("does not create an undo step", () => {
    const ed = makeEditor("<p>body</p>");
    const before = ed.state.doc.toJSON();
    ed.commands.setBlankLinesBefore({ extras: [4], blockCount: 1 });
    expect(childTypes(ed)).toEqual(["blank", "blank", "blank", "blank", "paragraph"]);
    ed.commands.undo();
    expect(ed.state.doc.toJSON()).not.toEqual(before);
    // undo() should be a no-op here since the insert wasn't added to
    // history — the paragraph text content is unchanged either way.
    expect(ed.state.doc.textContent).toBe("body");
  });
});
