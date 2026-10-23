import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { createLowlight } from "lowlight";
import { closeHistory } from "@tiptap/pm/history";
import { BlankLines } from "./extensions/BlankLines";
import { MarkdownLink } from "./extensions/MarkdownLink";
import { MarkdownText, RawHtml, RawHtmlBlock } from "./extensions/RawHtml";
import { getEditorMarkdown, recordBlockSources } from "./markdownSerialize";
import { computeBlankLines } from "@/utils/blankLines";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Opens `body` the way TiptapEditor does on file open. */
function open(body: string): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false, text: false }),
      MarkdownText,
      RawHtml,
      RawHtmlBlock,
      CodeBlockLowlight.configure({ lowlight: createLowlight() }),
      MarkdownLink,
      Markdown.configure({ linkify: true, transformPastedText: true, transformCopiedText: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      BlankLines,
    ],
    content: "",
  });
  editor.commands.setContent(body, { emitUpdate: false });
  editor.commands.setBlankLinesBefore(computeBlankLines(body));
  recordBlockSources(editor, body);
  return editor;
}

/** Document position just after the first occurrence of `text`. */
function posAfter(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    const i = node.text!.indexOf(text);
    if (i >= 0) found = pos + i + text.length;
  });
  if (found < 0) throw new Error(`not found: ${text}`);
  return found;
}

/** Markdown that a whole-document serialization rewrites in many places. */
const BODY = [
  "# 見出し",
  "見出しの直後の段落（空行なし）",
  "",
  "行末に半角スペース 2 つ  ",
  "で改行した段落と",
  "折り返した行",
  "",
  "| 名前 | 役割 |",
  "|------|-----|",
  "| alpha | 入口 |",
  "",
  "* アスタリスクの",
  "* リスト",
  "",
  "1) 括弧の",
  "2) 番号",
  "",
  "***",
  "",
  "~~~",
  "チルダの fence",
  "~~~",
  "",
  "",
  "",
  "末尾の段落",
].join("\n");

describe("unedited blocks keep their source on save (#268)", () => {
  it("writes an untouched document back byte for byte", () => {
    expect(getEditorMarkdown(open(`${BODY}\n`))).toBe(BODY);
  });

  it("rewrites only the block that was edited", () => {
    const ed = open(`${BODY}\n`);
    ed.commands.insertContentAt(posAfter(ed, "末尾の段落"), "。");
    expect(getEditorMarkdown(ed)).toBe(BODY.replace("末尾の段落", "末尾の段落。"));
  });

  it("keeps the other blocks and their gaps when a block is deleted", () => {
    const ed = open(`${BODY}\n`);
    // Delete the `***` rule.
    let from = -1;
    let to = -1;
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name === "horizontalRule") {
        from = offset;
        to = offset + node.nodeSize;
      }
    });
    ed.commands.deleteRange({ from, to });
    const out = getEditorMarkdown(ed);
    expect(out).not.toContain("***");
    expect(out).toContain("|------|-----|");
    expect(out).toContain("行末に半角スペース 2 つ  \nで改行した段落と\n折り返した行");
    expect(out.startsWith("# 見出し\n見出しの直後の段落（空行なし）")).toBe(true);
  });

  it("writes the source again once an edit is undone", () => {
    const ed = open(`${BODY}\n`);
    // A real edit comes well after the load; in a test the two would land in
    // one undo group, and undo would take the load back too.
    ed.view.dispatch(closeHistory(ed.state.tr));
    ed.commands.insertContentAt(posAfter(ed, "折り返した行"), "!");
    expect(getEditorMarkdown(ed)).not.toBe(BODY);
    ed.commands.undo();
    expect(getEditorMarkdown(ed)).toBe(BODY);
  });

  it("serializes a newly added block and keeps the ones around it", () => {
    const ed = open("前の段落\n\n後の段落\n");
    ed.commands.insertContentAt(posAfter(ed, "前の段落") + 1, {
      type: "paragraph",
      content: [{ type: "text", text: "足した段落" }],
    });
    expect(getEditorMarkdown(ed)).toBe("前の段落\n\n足した段落\n\n後の段落");
  });

  it("keeps a block's own gap when the blank lines before it are edited", () => {
    const ed = open("一つ目\n\n\n\n二つ目\n");
    // Remove one of the two extra blank-line paragraphs.
    let blank = -1;
    ed.state.doc.forEach((node, offset) => {
      if (blank < 0 && node.type.name === "paragraph" && node.content.size === 0) blank = offset;
    });
    ed.commands.deleteRange({ from: blank, to: blank + 2 });
    expect(getEditorMarkdown(ed)).toBe("一つ目\n\n\n二つ目");
  });

  // Cases from the codex review.
  it.each([["an unclosed fence", "~~~\ncode"]])(
    "closes %s at the end of the file once a block is added after it",
    (_label, body) => {
    const ed = open(`前の段落\n\n${body}\n`);
    ed.commands.insertContentAt(ed.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: "足した段落" }],
    });
    const saved = getEditorMarkdown(ed);
    // Read back, the added paragraph is still a paragraph of its own.
    const reread = open(`${saved}\n`);
    const last = reread.state.doc.lastChild!;
    const lastBlock = last.content.size === 0 ? reread.state.doc.child(reread.state.doc.childCount - 2) : last;
    expect(lastBlock.type.name).toBe("paragraph");
    expect(lastBlock.textContent).toBe("足した段落");
    }
  );

  it("serializes everything when a reference definition sits inside a block", () => {
    const ed = open("> [ref]: https://example.com\n> note\n\n[text][ref]\n");
    ed.commands.insertContentAt(posAfter(ed, "note"), "!");
    const saved = getEditorMarkdown(ed);
    // Wherever the definition went, the link still points at it.
    expect(saved).not.toMatch(/\[text\]\[ref\]/);
    expect(saved).toContain("https://example.com");
  });

  it("does not pick one of two equal blocks' sources after an undo", () => {
    // Two lists with the same content but different markers: undoing an
    // edit to the second must not write it with the first one's `*`.
    const ed = open("* item\n\n- item\n");
    ed.view.dispatch(closeHistory(ed.state.tr));
    const ends: number[] = [];
    ed.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "item") ends.push(pos + node.text.length);
    });
    ed.commands.insertContentAt(ends[1], "!");
    ed.commands.undo();
    const saved = getEditorMarkdown(ed);
    expect(saved.startsWith("* item\n\n")).toBe(true);
    expect(saved).not.toBe("* item\n\n* item");
  });

  it("falls back to serializing everything when a line belongs to no block", () => {
    // A link reference definition has no node: keeping `[文書][ref]` verbatim
    // while the definition is dropped would break the link.
    const out = getEditorMarkdown(open("[文書][ref] を参照\n\n[ref]: https://example.com\n"));
    expect(out).not.toContain("[文書][ref]");
    expect(out).toContain("https://example.com");
  });
});
