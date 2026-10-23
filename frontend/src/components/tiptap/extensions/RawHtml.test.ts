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
import { MarkdownText, RawHtml, RawHtmlBlock } from "./RawHtml";
import { extractAnchorBlocks } from "@/utils/pmAnchor";
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

  // Cases from the codex review of the first version.
  it.each([
    ["a multi-line HTML block in a blockquote", "> <div>\n> line1\n> line2\n> </div>"],
    ["a multi-line HTML block in a list item", "- item\n\n  <div>\n  line1\n  </div>"],
    ["a table cell holding only HTML", "| html |\n| --- |\n| <br/> |"],
    ["a | inside an HTML attribute in a table cell", '| c |\n| --- |\n| a <span title="a\\|b">z</span> |'],
    ["a > after a hard break", "a\\\n\\> literal"],
  ])("keeps %s", (_label, body) => {
    // A table's own serializer ends with "\n" (there before this change).
    const save = (md: string) => roundTrip(`${md}\n`).replace(/\n+$/, "");
    expect(save(body)).toBe(body);
    // ...and keeps it on the next save too.
    expect(save(save(body))).toBe(body);
  });

  it("keeps a literal character reference as the same text across saves", () => {
    // `&amp;copy;` reads as the text "&copy;". Written back as `\&copy;` (the
    // same text, the CommonMark way), not as `&copy;`, which reads as "©".
    const once = roundTrip("A &amp;copy; and &amp;#65;\n");
    expect(once).toBe("A \\&copy; and \\&#65;");
    expect(roundTrip(`${once}\n`)).toBe(once);
    const ed = makeEditor();
    ed.commands.setContent(`${once}\n`, { emitUpdate: false });
    expect(ed.state.doc.textContent).toBe("A &copy; and &#65;");
  });

  it("maps comment anchor text to document positions one to one across raw HTML", () => {
    const ed = makeEditor();
    ed.commands.setContent("alpha <b>beta</b> tail\n\n<div>\nblock text\n</div>\n", {
      emitUpdate: false,
    });
    const blocks = extractAnchorBlocks(ed.state.doc);
    for (const word of ["beta", "tail", "block text"]) {
      const block = blocks.find((b) => b.text.includes(word))!;
      const from = block.start + block.text.indexOf(word);
      expect(ed.state.doc.textBetween(from, from + word.length)).toBe(word);
    }
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
