import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { copyTextOf, findCopyableBlock, tableMarkdownOf } from "./blockCopy";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const TABLE_MD = [
  "| 名前 | 役割 |",
  "| --- | --- |",
  "| alpha | 入口 |",
  "| beta | 出口 |",
  "",
].join("\n");

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: "",
  });
  ed.commands.setContent(content, { emitUpdate: false });
  return ed;
}

describe("tableMarkdownOf (#198)", () => {
  it("serializes the hovered table back to markdown", () => {
    editor = createEditor(TABLE_MD);
    const tableEl = editor.view.dom.querySelector("table") as HTMLElement;

    const markdown = tableMarkdownOf(editor, tableEl);

    expect(markdown).not.toBeNull();
    expect(markdown).toContain("| 名前 | 役割 |");
    expect(markdown).toContain("| alpha | 入口 |");
    expect(markdown).toContain("| beta | 出口 |");
  });

  it("copies only the hovered table when the document has several", () => {
    editor = createEditor(
      `${TABLE_MD}\n段落\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n`
    );
    const tables = editor.view.dom.querySelectorAll("table");
    expect(tables.length).toBe(2);

    const second = tableMarkdownOf(editor, tables[1] as HTMLElement);

    expect(second).toContain("| x | y |");
    expect(second).not.toContain("alpha");
  });

  it("routes a hovered cell through copyTextOf to the table markdown", () => {
    editor = createEditor(TABLE_MD);
    const cell = editor.view.dom.querySelector("td") as HTMLElement;
    const block = findCopyableBlock(cell);

    expect(block?.kind).toBe("table");
    expect(copyTextOf(editor, block!)).toContain("| alpha | 入口 |");
  });
});
