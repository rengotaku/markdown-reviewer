import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DiffGutter } from "./DiffGutter";

// Exercises the diff-gutter decoration plugin against a real (headless) editor.
// Marks are expressed as top-level block indices coming from markdown-it; the
// plugin cross-checks against the doc's childCount before painting so a
// mismatch never places bars on the wrong block.

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), DiffGutter],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function nodeAt(ed: Editor, selector: string) {
  return Array.from(ed.view.dom.querySelectorAll(selector));
}

describe("DiffGutter", () => {
  it("paints an add class on the block at the given index", () => {
    // Two top-level blocks: <h2> and <p>. Mark block index 1 (the paragraph).
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1, kind: "add" }],
      blockCount: 2,
    });
    const added = nodeAt(ed, ".diff-gutter-add");
    expect(added).toHaveLength(1);
    expect(added[0].tagName.toLowerCase()).toBe("p");
    // "mod" class must not leak onto the same node.
    expect(nodeAt(ed, ".diff-gutter-mod")).toHaveLength(0);
  });

  it("paints a mod class + del-above class when both are set", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1, kind: "mod", delAbove: true }],
      blockCount: 2,
    });
    expect(nodeAt(ed, ".diff-gutter-mod")).toHaveLength(1);
    expect(nodeAt(ed, ".diff-gutter-del-above")).toHaveLength(1);
    // Should be the *same* node carrying both classes.
    const combined = nodeAt(ed, ".diff-gutter-mod.diff-gutter-del-above");
    expect(combined).toHaveLength(1);
  });

  it("degrades to no decorations when blockCount disagrees with the doc", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>"); // childCount = 2
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1, kind: "add" }],
      blockCount: 5, // mismatch — bail out
    });
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(0);
  });

  it("replaces the mark set on subsequent calls", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1, kind: "add" }],
      blockCount: 2,
    });
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(1);
    ed.commands.setDiffGutter({ marks: [], blockCount: 2 });
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(0);
  });

  it("re-renders decorations after a doc change (block count still matches)", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1, kind: "add" }],
      blockCount: 2,
    });
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(1);
    // Type into the paragraph — block count is unchanged.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "!");
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(1);
  });

  it("does not mark the document dirty (doc unchanged by gutter marks)", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    const before = ed.state.doc.toJSON();
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 0, kind: "mod" }, { blockIndex: 1, kind: "add" }],
      blockCount: 2,
    });
    expect(ed.state.doc.toJSON()).toEqual(before);
  });

  it("ignores marks with no kind and no delAbove (nothing to paint)", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p>");
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1 }],
      blockCount: 2,
    });
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(0);
    expect(nodeAt(ed, ".diff-gutter-mod")).toHaveLength(0);
    expect(nodeAt(ed, ".diff-gutter-del-above")).toHaveLength(0);
  });

  it("tolerates the phantom trailing empty paragraph tiptap appends (#125)", () => {
    // Documents ending in a non-textblock (list/table) get an extra empty
    // paragraph from tiptap that markdown-it never counts: childCount = 3,
    // blockCount = 2. The gutter must still paint instead of degrading.
    const ed = makeEditor("<h2>title</h2><ul><li>item</li></ul><p></p>");
    expect(ed.state.doc.childCount).toBe(3);
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 1, kind: "mod" }],
      blockCount: 2,
    });
    const painted = nodeAt(ed, ".diff-gutter-mod");
    expect(painted).toHaveLength(1);
    expect(painted[0].tagName.toLowerCase()).toBe("ul");
  });

  it("still degrades when the mismatch is not just the trailing empty paragraph", () => {
    const ed = makeEditor("<h2>title</h2><p>body</p><p></p>"); // effective 2
    ed.commands.setDiffGutter({
      marks: [{ blockIndex: 0, kind: "add" }],
      blockCount: 1, // real mismatch — bail out
    });
    expect(nodeAt(ed, ".diff-gutter-add")).toHaveLength(0);
  });
});
