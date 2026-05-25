import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { CommentMark } from "./CommentMark";
import { StandaloneCommentNode } from "./StandaloneComment";

function createEditor(initialContent = ""): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
      CommentMark,
      StandaloneCommentNode,
    ],
    content: initialContent,
  });
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("StandaloneCommentNode", () => {
  it("parses a scope=global marker into a standalone node", () => {
    const md =
      'Intro paragraph.\n\n<!-- @comment id="g1" author="kishira" date="2026-05-25" body="file-wide note" scope="global" -->\n\nNext paragraph.';
    editor = createEditor(md);

    const found: Array<{
      id: string;
      author: string;
      date: string;
      body: string;
      scope: string;
    }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "standaloneComment") return;
      found.push({
        id: node.attrs.id,
        author: node.attrs.author,
        date: node.attrs.date,
        body: node.attrs.body,
        scope: node.attrs.scope,
      });
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: "g1",
      author: "kishira",
      date: "2026-05-25",
      body: "file-wide note",
      scope: "global",
    });
  });

  it("parses a scope=cross-section marker into a standalone node", () => {
    const md =
      '<!-- @comment id="x1" author="k" date="2026-05-25" body="Problem/Try/Action 連動" scope="cross-section" -->';
    editor = createEditor(md);

    let scope = "";
    editor.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") scope = node.attrs.scope;
    });
    expect(scope).toBe("cross-section");
  });

  it("serializes a standalone node back to a marker with no closer", () => {
    editor = createEditor("Body paragraph.");
    editor.commands.addStandaloneComment({
      id: "g2",
      author: "k",
      date: "2026-05-25",
      body: "global note",
      scope: "global",
    });

    const md = getMarkdown(editor);
    expect(md).toContain(
      '<!-- @comment id="g2" author="k" date="2026-05-25" body="global note" scope="global" -->'
    );
    // Must not produce a closing marker.
    expect(md).not.toContain("<!-- /@comment -->");
  });

  it("round-trips a cross-section marker with bound section titles", () => {
    const md =
      '<!-- @comment id="x1" author="k" date="2026-05-25" target="Problem\\nTry\\nAction" body="連動で書き直し" scope="cross-section" -->';
    editor = createEditor(md);

    let parsed: { target: string; scope: string } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") {
        parsed = { target: node.attrs.target, scope: node.attrs.scope };
      }
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.scope).toBe("cross-section");
    expect(parsed!.target).toBe("Problem\nTry\nAction");

    const out = getMarkdown(editor);
    expect(out).toContain('target="Problem\\nTry\\nAction"');
    expect(out).toContain('scope="cross-section"');
  });

  it("serializes a cross-section node added via the command with sections target", () => {
    editor = createEditor("Body.");
    editor.commands.addStandaloneComment({
      id: "x2",
      author: "k",
      date: "2026-05-25",
      target: "Section A\nSection B",
      body: "横断指摘",
      scope: "cross-section",
    });
    const md = getMarkdown(editor);
    expect(md).toContain('target="Section A\\nSection B"');
    expect(md).toContain('scope="cross-section"');
    expect(md).not.toContain("<!-- /@comment -->");
  });

  it("removes a standalone node by id", () => {
    const md =
      '<!-- @comment id="g1" author="k" date="2026-05-25" body="one" scope="global" -->\n\n<!-- @comment id="g2" author="k" date="2026-05-25" body="two" scope="cross-section" -->';
    editor = createEditor(md);

    editor.commands.removeStandaloneCommentById("g1");

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") ids.push(node.attrs.id);
    });
    expect(ids).toEqual(["g2"]);

    const out = getMarkdown(editor);
    expect(out).not.toContain('id="g1"');
    expect(out).toContain('id="g2"');
  });

  it("round-trips a mix of inline marks and standalone markers", () => {
    const md =
      '<!-- @comment id="g1" author="k" date="2026-05-25" body="global" scope="global" -->\n\nIntro <!-- @comment id="c1" author="k" date="2026-05-25" target="word" body="inline note" -->word<!-- /@comment --> end.';
    editor = createEditor(md);

    let markCount = 0;
    let standaloneCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") standaloneCount += 1;
      if (!node.isText) return;
      markCount += node.marks.filter((m) => m.type.name === "comment").length;
    });
    expect(standaloneCount).toBe(1);
    expect(markCount).toBeGreaterThan(0);

    const out = getMarkdown(editor);
    expect(out).toContain('scope="global"');
    expect(out).toContain('id="c1"');
    // Inline-scope (default) must not gain a scope attribute on round-trip.
    expect(out).not.toMatch(/id="c1"[^>]*scope="inline"/);
  });
});
