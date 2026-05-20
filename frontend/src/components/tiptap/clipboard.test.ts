import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { DOMParser as PmDOMParser } from "@tiptap/pm/model";

function createEditor(initialContent = "") {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: false,
      }),
    ],
    content: initialContent,
  });
  return editor;
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

const CODE_BLOCK_MARKDOWN = [
  "# Sample",
  "",
  "```",
  "user@host:~$ sudo cat /etc/environment | grep -i MY_APP",
  "export MY_APP_KEY=xxxx",
  "export MY_APP_SECRET=xxxx",
  "user@host:~$ sudo systemctl show foo.service 2>/dev/null | grep -i MY_APP",
  "user@host:~$ ls /var/www/app/*/shared/config/ 2>/dev/null",
  "credentials.yml.enc  master.key",
  "```",
].join("\n");

describe("code block markdown round-trip (initial load via content option)", () => {
  it("preserves > in code block content", () => {
    const editor = createEditor(CODE_BLOCK_MARKDOWN);
    const output = getMarkdown(editor);
    editor.destroy();
    expect(output).toContain("2>/dev/null");
    expect(output).not.toContain("&gt;");
  });

  it("preserves ~ in code block content", () => {
    const editor = createEditor(CODE_BLOCK_MARKDOWN);
    const output = getMarkdown(editor);
    editor.destroy();
    expect(output).toContain("user@host:~$");
    expect(output).not.toContain("\\~");
  });

  it("preserves * in code block content", () => {
    const editor = createEditor(CODE_BLOCK_MARKDOWN);
    const output = getMarkdown(editor);
    editor.destroy();
    expect(output).toContain("/app/*/shared");
    expect(output).not.toContain("\\*");
  });

  it("does not add backslash at line ends in code block", () => {
    const editor = createEditor(CODE_BLOCK_MARKDOWN);
    const output = getMarkdown(editor);
    editor.destroy();
    const lines = output.split("\n");
    const codeLines = lines.filter(
      (l) => !l.startsWith("```") && l.trim().length > 0 && l !== "# Sample"
    );
    codeLines.forEach((line) => {
      expect(line).not.toMatch(/\\$/);
    });
  });
});

describe("setContent then getMarkdown round-trip (simulates file load)", () => {
  it("preserves code block content after setContent", () => {
    const editor = createEditor();
    editor.commands.setContent(CODE_BLOCK_MARKDOWN);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("2>/dev/null");
    expect(output).not.toContain("&gt;");
    expect(output).toContain("user@host:~$");
    expect(output).not.toContain("\\~");
    expect(output).toContain("/app/*/shared");
    expect(output).not.toContain("\\*");
  });
});

describe("MarkdownParser.parse round-trip", () => {
  it("parser produces HTML that preserves code block content when re-parsed", () => {
    const editor = createEditor();
    const storage = editor.storage as {
      markdown?: { parser: { parse: (s: string) => string } };
    };
    const parser = storage.markdown?.parser;
    expect(parser).toBeDefined();

    const html = parser!.parse(CODE_BLOCK_MARKDOWN);

    editor.commands.setContent(html);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("2>/dev/null");
    expect(output).not.toContain("&gt;");
    expect(output).toContain("user@host:~$");
    expect(output).not.toContain("\\~");
  });
});

describe("paste via text/plain (clipboardTextParser path)", () => {
  it("correctly parses markdown pasted as text/plain", () => {
    const editor = createEditor();
    const storage = editor.storage as {
      markdown?: {
        parser: { parse: (s: string, opts?: { inline?: boolean }) => string };
      };
    };
    const parser = storage.markdown?.parser;
    expect(parser).toBeDefined();

    const parsed = parser!.parse(CODE_BLOCK_MARKDOWN, { inline: true });
    const dom = new window.DOMParser().parseFromString(
      `<body>${parsed}</body>`,
      "text/html"
    ).body;

    const context = editor.state.selection.$from;
    const slice = PmDOMParser.fromSchema(editor.state.schema).parseSlice(dom, {
      preserveWhitespace: true,
      context,
    });

    editor.view.dispatch(editor.state.tr.replaceSelection(slice));

    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("2>/dev/null");
    expect(output).not.toContain("&gt;");
    expect(output).toContain("user@host:~$");
    expect(output).not.toContain("\\~");
    expect(output).toContain("/app/*/shared");
    expect(output).not.toContain("\\*");
  });
});

describe("paste via text/html (GitHub-style HTML code block)", () => {
  it("correctly handles GitHub-style HTML paste with pre>code", () => {
    const editor = createEditor();

    const githubHtml = `<pre><code>user@host:~$ sudo cat /etc/environment | grep -i MY_APP\nexport MY_APP_KEY=xxxx\nuser@host:~$ sudo systemctl show foo.service 2&gt;/dev/null | grep -i MY_APP\nuser@host:~$ ls /var/www/app/*/shared/config/ 2&gt;/dev/null\ncredentials.yml.enc  master.key\n</code></pre>`;

    const dom = new window.DOMParser().parseFromString(
      `<body>${githubHtml}</body>`,
      "text/html"
    ).body;

    const context = editor.state.selection.$from;
    const slice = PmDOMParser.fromSchema(editor.state.schema).parseSlice(dom, {
      preserveWhitespace: true,
      context,
    });

    editor.view.dispatch(editor.state.tr.replaceSelection(slice));

    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("2>/dev/null");
    expect(output).not.toContain("&gt;");
  });
});

describe("MarkdownPaste extension: text/plain preferred over text/html when code fences present", () => {
  it("processes text/plain as markdown when code fences present (simulates MarkdownPaste extension logic)", () => {
    const editor = createEditor();

    const storage = editor.storage as {
      markdown?: {
        parser: { parse: (s: string, opts?: { inline?: boolean }) => string };
      };
    };
    const parser = storage.markdown?.parser;
    expect(parser).toBeDefined();

    const markdownText = [
      "```",
      "user@host:~$ sudo cat /etc/environment | grep -i MY_APP",
      "export MY_APP_KEY=xxxx",
      "user@host:~$ sudo systemctl show foo.service 2>/dev/null | grep -i MY_APP",
      "user@host:~$ ls /var/www/app/*/shared/config/ 2>/dev/null",
      "credentials.yml.enc  master.key",
      "```",
    ].join("\n");

    const parsed = parser!.parse(markdownText, { inline: true });
    const body = new window.DOMParser().parseFromString(
      `<body>${parsed}</body>`,
      "text/html"
    ).body;

    const context = editor.state.selection.$from;
    const slice = PmDOMParser.fromSchema(editor.state.schema).parseSlice(body, {
      preserveWhitespace: true,
      context,
    });

    editor.view.dispatch(editor.state.tr.replaceSelection(slice));

    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("2>/dev/null");
    expect(output).not.toContain("&gt;");
    expect(output).toContain("user@host:~$");
    expect(output).not.toContain("\\~");
    expect(output).toContain("/app/*/shared");
    expect(output).not.toContain("\\*");
    const lines = output.split("\n");
    const codeLines = lines.filter((l) => !l.startsWith("```") && l.trim().length > 0);
    codeLines.forEach((line) => {
      expect(line).not.toMatch(/\\$/);
    });
  });
});
