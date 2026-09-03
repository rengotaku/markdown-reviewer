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
import { BlankLines } from "./extensions/BlankLines";
import { getEditorMarkdown } from "./markdownSerialize";
import { computeBlankLines } from "@/utils/blankLines";

let editor: Editor | null = null;

function makeEditor(): Editor {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight: createLowlight() }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      BlankLines,
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
    ],
    content: "",
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Loads `body` the same way TiptapEditor.tsx does on file open: setContent
 *  followed by pushing the computed blank-line payload into the doc. */
function load(ed: Editor, body: string): void {
  ed.commands.setContent(body, { emitUpdate: false });
  ed.commands.setBlankLinesBefore(computeBlankLines(body));
}

// Whether the whole document ends with a trailing "\n" in tiptap-markdown's
// output is decided entirely by the *last block's own* serializer (verified
// empirically: table rows end with "\n", most other block types don't) and
// is unrelated to this feature — it's already true of
// `serializer.serialize(doc)` before any of this issue's changes. So each
// case's expected output is `body` with that pre-existing trailing-newline
// behavior applied, not `body` verbatim.
const NO_TRAILING_NEWLINE = (body: string) => body.replace(/\n+$/, "");

describe("getEditorMarkdown blank-line round trip", () => {
  const cases: [string, string, (body: string) => string][] = [
    [
      "1 blank line (baseline)",
      "# Title\n\nParagraph one.\n\nParagraph two.\n",
      NO_TRAILING_NEWLINE,
    ],
    [
      "2 blank lines between paragraphs",
      "Paragraph one.\n\n\nParagraph two.\n",
      NO_TRAILING_NEWLINE,
    ],
    [
      "5 blank lines between paragraphs",
      "Paragraph one.\n\n\n\n\n\nParagraph two.\n",
      NO_TRAILING_NEWLINE,
    ],
    [
      "blank lines after a list",
      "- item1\n- item2\n\n\n\nAfter list.\n",
      NO_TRAILING_NEWLINE,
    ],
    [
      "blank lines before and after a fenced code block",
      [
        "Intro.",
        "",
        "",
        "```js",
        "code();",
        "```",
        "",
        "",
        "",
        "Outro.",
        "",
      ].join("\n"),
      NO_TRAILING_NEWLINE,
    ],
    [
      "blank lines before and after a table",
      [
        "Intro.",
        "",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "",
        "Outro.",
        "",
      ].join("\n"),
      NO_TRAILING_NEWLINE,
    ],
    [
      "blank lines before and after a heading",
      "Intro.\n\n\n## Heading\n\n\n\nOutro.\n",
      NO_TRAILING_NEWLINE,
    ],
    [
      "leading blank lines at the start of the document",
      "\n\n\n# Title\n\nBody.\n",
      NO_TRAILING_NEWLINE,
    ],
    [
      "a fenced code block containing internal blank lines",
      ["```js", "foo();", "", "", "", "bar();", "```", ""].join("\n"),
      NO_TRAILING_NEWLINE,
    ],
    [
      "a table as the last block (trailing newline is preserved)",
      "Intro.\n\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      (body) => body,
    ],
  ];

  for (const [name, body, expectedFrom] of cases) {
    it(`round-trips: ${name}`, () => {
      const ed = makeEditor();
      load(ed, body);
      expect(getEditorMarkdown(ed)).toBe(expectedFrom(body));
    });
  }

  it("matches serializer.serialize(doc) exactly when there are no extra blank lines", () => {
    const body = "# Title\n\nParagraph one.\n\n- a\n- b\n\nOutro.\n";
    const ed = makeEditor();
    load(ed, body);
    const storage = (ed.storage as unknown as {
      markdown: { serializer: { serialize: (n: unknown) => string } };
    }).markdown;
    expect(getEditorMarkdown(ed)).toBe(storage.serializer.serialize(ed.state.doc));
  });
});

describe("setBlankLinesBefore does not add its own undo step", () => {
  // setContent(..., { emitUpdate: false }) still pushes an undoable
  // transaction (only the "update" event is suppressed, per #20 / the
  // setContent.test.ts convention this file mirrors) — that's unrelated to
  // this feature. What matters here is that the *follow-up*
  // setBlankLinesBefore call (BlankLines.ts tags it `addToHistory: false`)
  // doesn't add a second, separate undo step: a single undo() right after
  // loading must land back on the pre-load (empty) document in one step,
  // not first strip the blank-line attributes and leave the content behind.
  it("a single undo after loading reverts all the way to the pre-load document", () => {
    const ed = makeEditor();
    const body = "Paragraph one.\n\n\n\n\nParagraph two.\n";
    load(ed, body);
    expect(getEditorMarkdown(ed)).not.toBe("");
    ed.commands.undo();
    expect(getEditorMarkdown(ed)).toBe("");
  });
});

describe("loading a file with blank lines does not mark it dirty (#259 regression of #20)", () => {
  // Mirrors TiptapEditor.tsx's file-open effect verbatim: setContent(...,
  // { emitUpdate: false }) suppresses onUpdate for the setContent
  // transaction itself, then the settle window (settleUntilRef) has to be
  // opened *before* setBlankLinesBefore runs — that command dispatches its
  // transaction synchronously, which re-enters onUpdate synchronously too.
  // Opening the window afterwards (the shape that regressed) means
  // onUpdate reads a stale, already-expired settleUntil from a *previous*
  // load and slips through the guard.
  function loadLikeTiptapEditor(
    ed: Editor,
    body: string,
    settle: { until: number },
    order: "settle-before-attrs" | "settle-after-attrs"
  ): void {
    ed.commands.setContent(body, { emitUpdate: false });
    if (order === "settle-before-attrs") {
      settle.until = Date.now() + 250;
      ed.commands.setBlankLinesBefore(computeBlankLines(body));
    } else {
      // The regressed order: settle window opened only after the
      // attribute-only transaction has already dispatched (and already
      // re-entered onUpdate).
      ed.commands.setBlankLinesBefore(computeBlankLines(body));
      settle.until = Date.now() + 250;
    }
  }

  const body =
    "Para one.\n\nPara two.\n\n\nPara three.\n\n\n\n\n\nPara four.\n\n- a\n- b\n- c\n\n\n\nAfter list.\n";

  it("does not fire onUpdate when the settle window opens before setBlankLinesBefore (fixed order)", () => {
    const ed = makeEditor();
    const settle = { until: 0 };
    let updateCalls = 0;
    ed.on("update", () => {
      // Same guard TiptapEditor.tsx's onUpdate applies before calling
      // updateActiveMarkdown.
      if (Date.now() < settle.until) return;
      updateCalls++;
    });

    loadLikeTiptapEditor(ed, body, settle, "settle-before-attrs");

    expect(updateCalls).toBe(0);
  });

  it("documents the regression: opening the settle window after setBlankLinesBefore fires onUpdate", () => {
    const ed = makeEditor();
    const settle = { until: 0 };
    let updateCalls = 0;
    ed.on("update", () => {
      if (Date.now() < settle.until) return;
      updateCalls++;
    });

    loadLikeTiptapEditor(ed, body, settle, "settle-after-attrs");

    expect(updateCalls).toBe(1);
  });
});

describe("blank lines are editable content (#261)", () => {
  // Blank lines are real empty paragraph nodes once loaded (BlankLines.ts),
  // so growing/shrinking their count is an ordinary doc edit — exactly what
  // pressing Enter on a blank line (adds one) or Backspace at its start
  // (removes one) does. These tests drive the same structural change
  // directly via a transaction, since headless Editor.commands don't expose
  // a literal "press Enter"/"press Backspace" affordance, but the resulting
  // doc shape (one more/one fewer empty paragraph) is identical.

  function blankParagraphOffsets(ed: Editor): number[] {
    const offsets: number[] = [];
    ed.state.doc.forEach((node, offset) => {
      if (node.type.name === "paragraph" && node.content.size === 0) {
        offsets.push(offset);
      }
    });
    return offsets;
  }

  it("Enter on a blank line: inserting one more empty paragraph adds one blank line to the output", () => {
    const ed = makeEditor();
    const body = "Paragraph one.\n\n\nParagraph two.\n"; // 2 blank lines
    load(ed, body);
    expect(getEditorMarkdown(ed)).toBe(NO_TRAILING_NEWLINE(body));

    const [blankOffset] = blankParagraphOffsets(ed);
    const paragraphType = ed.schema.nodes.paragraph;
    ed.view.dispatch(ed.state.tr.insert(blankOffset, paragraphType.create()));

    expect(getEditorMarkdown(ed)).toBe(
      NO_TRAILING_NEWLINE("Paragraph one.\n\n\n\nParagraph two.\n")
    );
  });

  it("Backspace on a blank line: removing one empty paragraph removes one blank line from the output", () => {
    const ed = makeEditor();
    const body = "Paragraph one.\n\n\n\nParagraph two.\n"; // 3 blank lines
    load(ed, body);
    expect(getEditorMarkdown(ed)).toBe(NO_TRAILING_NEWLINE(body));

    const [blankOffset] = blankParagraphOffsets(ed);
    const blankNode = ed.state.doc.nodeAt(blankOffset)!;
    ed.view.dispatch(ed.state.tr.delete(blankOffset, blankOffset + blankNode.nodeSize));

    expect(getEditorMarkdown(ed)).toBe(
      NO_TRAILING_NEWLINE("Paragraph one.\n\n\nParagraph two.\n")
    );
  });

  it("removing every blank paragraph collapses the gap back to the normal single blank line", () => {
    const ed = makeEditor();
    const body = "Paragraph one.\n\n\n\n\nParagraph two.\n"; // 4 blank lines
    load(ed, body);

    for (const offset of blankParagraphOffsets(ed).slice().reverse()) {
      const node = ed.state.doc.nodeAt(offset)!;
      ed.view.dispatch(ed.state.tr.delete(offset, offset + node.nodeSize));
    }

    expect(getEditorMarkdown(ed)).toBe(
      NO_TRAILING_NEWLINE("Paragraph one.\n\nParagraph two.\n")
    );
  });
});
