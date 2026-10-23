import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { createLowlight } from "lowlight";
import { BlankLines } from "./BlankLines";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownText, RawHtmlBlock, RawHtmlInline } from "./RawHtml";
import { getEditorMarkdown } from "../markdownSerialize";
import { computeBlankLines } from "@/utils/blankLines";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** The editor's Markdown-relevant extensions, as TiptapEditor registers them. */
function makeEditor(): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false, text: false }),
      MarkdownText,
      RawHtmlInline,
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
  return editor;
}

/** Open `body` as TiptapEditor does, then serialize as a save does. */
function roundTrip(body: string): string {
  const ed = makeEditor();
  ed.commands.setContent(body, { emitUpdate: false });
  ed.commands.setBlankLinesBefore(computeBlankLines(body));
  return getEditorMarkdown(ed);
}

/** Open, type one character at the end, save — the issue's reproduction. */
function editAndSave(body: string): string {
  const ed = makeEditor();
  ed.commands.setContent(body, { emitUpdate: false });
  ed.commands.setBlankLinesBefore(computeBlankLines(body));
  ed.commands.focus("end");
  ed.commands.insertContent("。");
  return getEditorMarkdown(ed);
}

describe("raw HTML and angle brackets survive a save (#297)", () => {
  // The issue's measurements: each was lost or rewritten before the fix.
  it.each([
    ["an unknown inline tag", "- topic.<name> ok"],
    ["a > in prose", "- exact > 連結"],
    ["a < in prose", "- 1 < 2"],
    ["an HTML block", "<div>raw html block</div>"],
    ["an HTML comment", "<!-- comment -->"],
    ["an inline <br/>", "see <br/> here"],
    ["an autolink", "<https://example.com>"],
    ["an ampersand", "- A & B"],
  ])("keeps %s", (_label, body) => {
    expect(roundTrip(`${body}\n`)).toBe(body);
  });

  it("leaves a task list's checkbox to the task item, not to raw HTML", () => {
    // markdown-it-task-lists injects the checkbox as an html_inline token of
    // its own. (The blank line between the items is #268's normalization,
    // there before this change.)
    const out = roundTrip("- [x] done\n- [ ] todo\n");
    expect(out).not.toContain("<input");
    expect(out).toMatch(/^- \[x\] done$/m);
    expect(out).toMatch(/^- \[ \] todo$/m);
  });

  it("keeps them all through a real edit elsewhere in the file", () => {
    const body = [
      "# メモ",
      "",
      "<!-- メタ情報 -->",
      "",
      "- topic.<name> ok",
      "- exact > 連結",
      "- 1 < 2",
      "",
      "<div>raw html block</div>",
      "",
      "see <br/> here",
      "",
      "末尾の段落",
    ].join("\n");
    expect(editAndSave(`${body}\n`)).toBe(`${body}。`);
  });

  it("escapes a typed < that would otherwise be read back as a tag", () => {
    const ed = makeEditor();
    ed.commands.setContent("段落\n", { emitUpdate: false });
    ed.commands.focus("end");
    // As typed text: a plain string would be parsed as HTML.
    ed.commands.insertContent({ type: "text", text: "<div> と <!-- と a<b" });
    const saved = getEditorMarkdown(ed);
    expect(saved).toBe("段落\\<div> と \\<!-- と a\\<b");
    // ...and reads back as the same text, not as HTML.
    expect(roundTrip(`${saved}\n`)).toBe(saved);
  });

  it("shows the raw source as text rather than rendering it", () => {
    const ed = makeEditor();
    ed.commands.setContent('a <img src=x onerror="alert(1)"> b\n\n<script>alert(1)</script>\n', {
      emitUpdate: false,
    });
    const dom = ed.view.dom;
    expect(dom.querySelector("img")).toBeNull();
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector(".raw-html-inline")?.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(dom.querySelector(".raw-html-block")?.textContent).toBe("<script>alert(1)</script>");
  });
});
