import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import type { Editor as ReactEditor } from "@tiptap/react";
import { selectionMarkdownOf } from "./selectionCopy";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(content: string, withMarkdown = true): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: [
      StarterKit,
      ...(withMarkdown
        ? [Markdown.configure({ transformPastedText: false, transformCopiedText: false })]
        : []),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: "",
  });
  ed.commands.setContent(content, { emitUpdate: false });
  editor = ed;
  return ed;
}

/** Document position of the first character of `text`. */
function posOf(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    const i = node.text!.indexOf(text);
    if (i >= 0) found = pos + i;
  });
  if (found < 0) throw new Error(`not found: ${text}`);
  return found;
}

function select(ed: Editor, fromText: string, toText: string) {
  ed.commands.setTextSelection({ from: posOf(ed, fromText), to: posOf(ed, toText) + toText.length });
}

const copy = (ed: Editor) => selectionMarkdownOf(ed as unknown as ReactEditor);

describe("selectionMarkdownOf (#199)", () => {
  it("keeps inline syntax within a paragraph", () => {
    const ed = createEditor("前の文 **強調** と [リンク](https://example.com) の後\n");
    select(ed, "強調", "リンク");
    expect(copy(ed)).toBe("**強調** と [リンク](https://example.com)");
  });

  it("keeps block syntax across blocks", () => {
    const ed = createEditor("## 見出し\n\n- いち\n- に\n");
    select(ed, "見出し", "に");
    expect(copy(ed)).toBe("## 見出し\n\n- いち\n- に");
  });

  it("copies a selection inside a code block verbatim, unescaped", () => {
    const ed = createEditor("```\nconst a_b = *c*;\nnext();\n```\n");
    select(ed, "const", "*c*;");
    expect(copy(ed)).toBe("const a_b = *c*;");
  });

  it("falls back to plain text without a Markdown serializer", () => {
    const ed = createEditor("<p>前 <strong>強調</strong> 後</p>", false);
    select(ed, "前", "後");
    expect(copy(ed)).toBe("前 強調 後");
  });

  it("keeps the spaces at either end of a partial selection", () => {
    const ed = createEditor("left middle right\n");
    ed.commands.setTextSelection({ from: posOf(ed, " middle "), to: posOf(ed, " middle ") + 8 });
    expect(copy(ed)).toBe(" middle ");
  });

  const TABLE = "| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |\n";

  it("copies a selection across the header and body rows as a table, every cell kept", () => {
    const ed = createEditor(TABLE);
    select(ed, "A", "delta");
    const out = copy(ed)!;
    for (const cell of ["A", "B", "alpha", "beta", "gamma", "delta"]) expect(out).toContain(cell);
    expect(out.split("\n")[0]).toMatch(/^\|/);
  });

  it("keeps every selected body cell when the header row is not selected", () => {
    const ed = createEditor(TABLE);
    select(ed, "alpha", "delta");
    const out = copy(ed)!;
    for (const cell of ["alpha", "beta", "gamma", "delta"]) expect(out).toContain(cell);
    expect(out).not.toContain("<");
  });

  it("keeps every selected cell of a single row", () => {
    const ed = createEditor(TABLE);
    select(ed, "alpha", "beta");
    const out = copy(ed)!;
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).not.toContain("<");
  });

  it("returns null for an empty selection", () => {
    const ed = createEditor("本文\n");
    ed.commands.setTextSelection(1);
    expect(copy(ed)).toBeNull();
  });
});
