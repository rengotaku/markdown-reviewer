import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { MermaidBlock, fenceFor, mermaidCodeFromPre } from "./MermaidBlock";

/**
 * Round-trip tests for issue #189: a ```mermaid fence in the file must load as
 * a `mermaidBlock` node (so it renders as a diagram) and serialize back to the
 * same fence (so the saved .md stays plain Markdown instead of raw HTML).
 */

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({ transformPastedText: true, transformCopiedText: false }),
      MermaidBlock,
    ],
    content: "",
  });
}

function markdownOf(ed: Editor): string {
  const storage = ed.storage as unknown as { markdown: { getMarkdown: () => string } };
  return storage.markdown.getMarkdown();
}

function load(md: string): Editor {
  const ed = makeEditor();
  ed.commands.setContent(md, { emitUpdate: false });
  return ed;
}

const DIAGRAM = "graph TD\n    A[Start] --> B[End]";
const FENCE = "```mermaid\n" + DIAGRAM + "\n```";

describe("MermaidBlock markdown parsing", () => {
  it("parses a ```mermaid fence into a mermaidBlock node carrying the source", () => {
    editor = load(FENCE + "\n");

    const doc = editor.getJSON();
    const first = doc.content?.[0];
    expect(first?.type).toBe("mermaidBlock");
    expect(first?.attrs?.code).toBe(DIAGRAM);
  });

  it("leaves non-mermaid fences as ordinary code blocks", () => {
    editor = load("```go\nfmt.Println(1)\n```\n");

    const first = editor.getJSON().content?.[0];
    expect(first?.type).toBe("codeBlock");
    expect(first?.attrs?.language).toBe("go");
  });

  it("leaves indented (unfenced) code blocks alone", () => {
    editor = load("    plain indented code\n");

    expect(editor.getJSON().content?.[0]?.type).toBe("codeBlock");
  });

  it("parses a mermaid fence nested in a blockquote", () => {
    editor = load("> " + "```mermaid\n> " + DIAGRAM.replace(/\n/g, "\n> ") + "\n> ```\n");

    const quote = editor.getJSON().content?.[0];
    expect(quote?.type).toBe("blockquote");
    expect(quote?.content?.[0]?.type).toBe("mermaidBlock");
  });

  it("keeps HTML-significant characters in the source intact", () => {
    const code = 'graph TD\n    A["<b> & \\"quoted\\""] --> B';
    editor = load("```mermaid\n" + code + "\n```\n");

    expect(editor.getJSON().content?.[0]?.attrs?.code).toBe(code);
    expect(markdownOf(editor).trim()).toBe("```mermaid\n" + code + "\n```");
  });

  it("treats a fence whose info string has extra words as mermaid", () => {
    editor = load("```mermaid showLineNumbers\n" + DIAGRAM + "\n```\n");

    expect(editor.getJSON().content?.[0]?.type).toBe("mermaidBlock");
  });

  it("parses correctly when the same editor loads several documents", () => {
    editor = load(FENCE + "\n");
    editor.commands.setContent("```mermaid\ngraph LR\n  X-->Y\n```\n", { emitUpdate: false });
    editor.commands.setContent(FENCE + "\n", { emitUpdate: false });

    expect(editor.getJSON().content?.[0]?.attrs?.code).toBe(DIAGRAM);
    expect(markdownOf(editor).trim()).toBe(FENCE);
  });

  it("restores the source from the data-code HTML attribute", () => {
    editor = makeEditor();
    editor.commands.setContent(
      '<div data-type="mermaid-block" data-code="graph LR\n  A-->B"></div>',
      { emitUpdate: false }
    );

    const first = editor.getJSON().content?.[0];
    expect(first?.type).toBe("mermaidBlock");
    expect(first?.attrs?.code).toBe("graph LR\n  A-->B");
  });
});

describe("MermaidBlock markdown serialization", () => {
  it("serializes an inserted diagram back to a ```mermaid fence", () => {
    editor = makeEditor();
    editor.commands.insertContent({
      type: "mermaidBlock",
      attrs: { code: DIAGRAM },
    });

    expect(markdownOf(editor)).toContain(FENCE);
    expect(markdownOf(editor)).not.toContain("data-type=");
  });

  it("round-trips a fence unchanged", () => {
    editor = load(FENCE + "\n");

    expect(markdownOf(editor).trim()).toBe(FENCE);
  });

  it("round-trips a fence surrounded by prose unchanged", () => {
    const md = "# Title\n\nBefore.\n\n" + FENCE + "\n\nAfter.";
    editor = load(md + "\n");

    expect(markdownOf(editor).trim()).toBe(md);
  });

  it("keeps the diagram inside a blockquote fenced (delimiters preserved)", () => {
    editor = makeEditor();
    editor.commands.setContent(
      { type: "doc", content: [{ type: "blockquote", content: [{ type: "mermaidBlock", attrs: { code: "graph TD\n  A-->B" } }] }] },
      { emitUpdate: false }
    );

    expect(markdownOf(editor).trim()).toBe("> ```mermaid\n> graph TD\n>   A-->B\n> ```");
  });

  it("widens the fence when the source itself contains a triple backtick", () => {
    const code = 'graph TD\n    A["```"] --> B';
    editor = makeEditor();
    editor.commands.insertContent({ type: "mermaidBlock", attrs: { code } });

    const out = markdownOf(editor);
    expect(out).toContain("````mermaid\n" + code + "\n````");

    // ...and the widened fence must parse back to the same source.
    editor.destroy();
    editor = load(out);
    expect(editor.getJSON().content?.[0]?.attrs?.code).toBe(code);
  });

  it("keeps a blank line the author left at the end of the source", () => {
    const md = "```mermaid\n" + DIAGRAM + "\n\n```";
    editor = load(md + "\n");

    expect(editor.getJSON().content?.[0]?.attrs?.code).toBe(DIAGRAM + "\n");
    expect(markdownOf(editor).trim()).toBe(md);
  });

  it("emits an empty fence for an empty diagram instead of raw HTML", () => {
    editor = makeEditor();
    editor.commands.insertContent({ type: "mermaidBlock", attrs: { code: "" } });

    expect(markdownOf(editor)).toContain("```mermaid\n```");
  });
});

describe("mermaidCodeFromPre", () => {
  function pre(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  }

  it("returns the source of a mermaid fence without its trailing newline", () => {
    expect(
      mermaidCodeFromPre(pre('<pre><code class="language-mermaid">graph TD\n  A-->B\n</code></pre>'))
    ).toBe("graph TD\n  A-->B");
  });

  it("returns null for a non-mermaid fence", () => {
    expect(mermaidCodeFromPre(pre('<pre><code class="language-go">x</code></pre>'))).toBeNull();
  });

  it("returns null for a fence with no language", () => {
    expect(mermaidCodeFromPre(pre("<pre><code>x</code></pre>"))).toBeNull();
  });
});

describe("fenceFor", () => {
  it("uses three backticks when the source has none", () => {
    expect(fenceFor("graph TD")).toBe("```");
  });

  it("uses three backticks when the longest run is shorter", () => {
    expect(fenceFor("a `b` c")).toBe("```");
  });

  it("grows past the longest backtick run in the source", () => {
    expect(fenceFor("a ``` b")).toBe("````");
    expect(fenceFor("a ````` b")).toBe("``````");
  });
});
