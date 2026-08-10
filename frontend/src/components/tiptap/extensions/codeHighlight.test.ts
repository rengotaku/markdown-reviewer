import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Markdown } from "tiptap-markdown";
import { createCodeLowlight, LANGUAGE_ALIASES } from "./codeHighlight";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function createEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false, codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight: createCodeLowlight() }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
    ],
    content: "",
  });
}

function markdownOf(ed: Editor): string {
  return (
    ed.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}

describe("code block highlighting (#198)", () => {
  it("emits highlight token spans for a registered language", () => {
    editor = createEditor();
    editor.commands.setContent("```go\nfunc main() {}\n```\n", {
      emitUpdate: false,
    });

    const tokens = editor.view.dom.querySelectorAll("pre code [class*='hljs-']");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("keeps the fence language through a markdown round-trip", () => {
    editor = createEditor();
    const source = "```go\nfunc main() {}\n```\n";
    editor.commands.setContent(source, { emitUpdate: false });

    expect(markdownOf(editor)).toContain("```go");
    expect(markdownOf(editor)).toContain("func main() {}");
  });

  it("keeps an unregistered language's fence name intact", () => {
    // The extension falls back to lowlight's auto-detection for languages it
    // doesn't know, so such a block may still get colours — what must not
    // happen is the fence name being rewritten or dropped on save.
    editor = createEditor();
    editor.commands.setContent("```brainfuck\n+++++\n```\n", {
      emitUpdate: false,
    });

    expect(markdownOf(editor)).toContain("```brainfuck");
    expect(markdownOf(editor)).toContain("+++++");
  });

  it("highlights aliased fence names such as sh and tf", () => {
    for (const alias of ["sh", "tf"]) {
      const ed = createEditor();
      ed.commands.setContent(
        alias === "sh"
          ? "```sh\nexport FOO=1 # comment\n```\n"
          : '```tf\nname = "value"\n```\n',
        { emitUpdate: false }
      );
      expect(
        ed.view.dom.querySelectorAll("pre code [class*='hljs-']").length,
        `alias ${alias} should highlight`
      ).toBeGreaterThan(0);
      ed.destroy();
    }
  });

  it("maps every alias onto a registered grammar", () => {
    const lowlight = createCodeLowlight();
    for (const alias of Object.keys(LANGUAGE_ALIASES)) {
      expect(lowlight.registered(alias), `${alias} is registered`).toBe(true);
    }
  });
});
