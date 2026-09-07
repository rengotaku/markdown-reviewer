import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { IndentKeymap } from "./IndentKeymap";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mkEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ link: false }),
      IndentKeymap,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
    ],
    content: "",
  });
}

function markdownOf(ed: Editor): string {
  return (ed.storage as unknown as { markdown: { getMarkdown(): string } })
    .markdown.getMarkdown();
}

function press(ed: Editor, key: string, shiftKey = false): void {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  ed.view.someProp("handleKeyDown", (fn) => fn(ed.view, event));
}

function pressReturning(ed: Editor, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  return ed.view.someProp("handleKeyDown", (fn) => fn(ed.view, event)) === true;
}

function posOfText(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) found = pos;
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

/** Clears the text of the line containing `text`, leaving the caret on it. */
function emptyLineOf(ed: Editor, text: string): void {
  const pos = posOfText(ed, text);
  ed.commands.setTextSelection({ from: pos, to: pos + text.length });
  ed.commands.deleteSelection();
}

describe("IndentKeymap — Backspace on an emptied list item", () => {
  it("removes a level-3 item without moving the items below it", () => {
    editor = mkEditor();
    editor.commands.setContent("- a\n    - b\n        - c\n    - d\n");
    emptyLineOf(editor, "c");
    press(editor, "Backspace");
    expect(markdownOf(editor)).toBe("- a\n  - b\n  - d");
  });

  it("keeps the following siblings at their own level", () => {
    editor = mkEditor();
    editor.commands.setContent(
      "- a\n    - b\n        - c1\n        - c2\n    - d\n"
    );
    emptyLineOf(editor, "c1");
    press(editor, "Backspace");
    expect(markdownOf(editor)).toBe("- a\n  - b\n    - c2\n  - d");
  });

  it("keeps the deeper items below a removed level-2 item", () => {
    editor = mkEditor();
    editor.commands.setContent("- a\n    - b\n    - c\n- d\n");
    emptyLineOf(editor, "b");
    press(editor, "Backspace");
    expect(markdownOf(editor)).toBe("- a\n  - c\n- d");
  });

  it("removes an emptied task list item the same way", () => {
    editor = mkEditor();
    editor.commands.setContent("- [ ] a\n    - [ ] b\n- [ ] c\n");
    emptyLineOf(editor, "b");
    press(editor, "Backspace");
    // tiptap-markdown serializes task lists loose, hence the blank lines.
    expect(markdownOf(editor)).toBe("- [ ] a\n\n- [ ] c");
  });

  it("does not handle Backspace inside text (the browser deletes the char)", () => {
    editor = mkEditor();
    editor.commands.setContent("- a\n    - bc\n");
    const pos = posOfText(editor, "bc");
    editor.commands.setTextSelection(pos + 2);
    const handled = pressReturning(editor, "Backspace");
    expect(handled).toBe(false);
    expect(markdownOf(editor)).toBe("- a\n  - bc");
  });

  it("leaves an empty item that still holds a sublist alone", () => {
    editor = mkEditor();
    editor.commands.setContent("- a\n    - b\n        - c\n");
    emptyLineOf(editor, "b");
    press(editor, "Backspace");
    // Default lift behaviour still applies here: the item is not "an empty
    // line", it carries children.
    expect(markdownOf(editor)).toContain("c");
  });
});

describe("IndentKeymap — Tab inside a code block", () => {
  it("inserts an indent instead of leaving the editor", () => {
    editor = mkEditor();
    editor.commands.setContent("```\ncode\n```\n");
    editor.commands.setTextSelection(posOfText(editor, "code"));
    press(editor, "Tab");
    expect(markdownOf(editor)).toBe("```\n\tcode\n```");
  });

  it("Shift-Tab removes one indent", () => {
    editor = mkEditor();
    editor.commands.setContent("```\n\tcode\n```\n");
    editor.commands.setTextSelection(posOfText(editor, "\tcode") + 1);
    press(editor, "Tab", true);
    expect(markdownOf(editor)).toBe("```\ncode\n```");
  });

  it("indents every line a selection touches instead of replacing it", () => {
    editor = mkEditor();
    editor.commands.setContent("```\none\ntwo\n```\n");
    const start = posOfText(editor, "one\ntwo");
    editor.commands.setTextSelection({ from: start, to: start + 7 });
    press(editor, "Tab");
    expect(markdownOf(editor)).toBe("```\n\tone\n\ttwo\n```");
    press(editor, "Tab", true);
    expect(markdownOf(editor)).toBe("```\none\ntwo\n```");
  });

  it("does not touch paragraphs (a leading tab would become a code block)", () => {
    editor = mkEditor();
    editor.commands.setContent("hello\n");
    editor.commands.setTextSelection(1);
    press(editor, "Tab");
    expect(markdownOf(editor)).toBe("hello");
  });

  it("still sinks list items with Tab", () => {
    editor = mkEditor();
    editor.commands.setContent("- a\n- b\n");
    editor.commands.setTextSelection(posOfText(editor, "b"));
    press(editor, "Tab");
    expect(markdownOf(editor)).toBe("- a\n  - b");
  });
});
