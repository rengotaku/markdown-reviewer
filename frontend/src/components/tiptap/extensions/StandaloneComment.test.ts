import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
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

  it("appends successive addStandaloneComment calls without replacing each other", () => {
    editor = createEditor("Body paragraph.");
    editor.commands.addStandaloneComment({
      id: "g1",
      author: "k",
      date: "2026-05-25",
      body: "first",
      scope: "global",
    });
    editor.commands.addStandaloneComment({
      id: "g2",
      author: "k",
      date: "2026-05-25",
      body: "second",
      scope: "global",
    });
    editor.commands.addStandaloneComment({
      id: "x1",
      author: "k",
      date: "2026-05-25",
      target: "Section A\nSection B",
      body: "cross",
      scope: "cross-section",
    });

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") ids.push(node.attrs.id);
    });
    expect(ids).toEqual(["g1", "g2", "x1"]);

    const out = getMarkdown(editor);
    expect(out).toContain('id="g1"');
    expect(out).toContain('id="g2"');
    expect(out).toContain('id="x1"');
    // Three separate open markers, zero close markers.
    expect((out.match(/@comment id="/g) ?? []).length).toBe(3);
    expect(out).not.toContain("<!-- /@comment -->");
  });

  it("appends rather than replaces even when the previous standalone node is selected", () => {
    // Simulates what happens in the real UI: TipTap's selection can end up
    // wrapping a previously-inserted atom block (NodeSelection). Without an
    // explicit "insert at end" the next addStandaloneComment used to replace
    // the selected node — exactly the user-visible "global overwrites" bug.
    editor = createEditor("Body.");
    editor.commands.addStandaloneComment({
      id: "g1",
      author: "k",
      date: "2026-05-25",
      body: "first",
      scope: "global",
    });

    // Find the inserted standalone node and force the editor selection to
    // wrap it as a NodeSelection.
    let standalonePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "standaloneComment") standalonePos = pos;
    });
    expect(standalonePos).toBeGreaterThanOrEqual(0);
    const tr = editor.state.tr.setSelection(
      NodeSelection.create(editor.state.doc, standalonePos)
    );
    editor.view.dispatch(tr);

    editor.commands.addStandaloneComment({
      id: "g2",
      author: "k",
      date: "2026-05-25",
      body: "second",
      scope: "global",
    });

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") ids.push(node.attrs.id);
    });
    expect(ids).toEqual(["g1", "g2"]);
  });

  it("stacks consecutive standalone markers without a blank line between them", () => {
    editor = createEditor("Body paragraph.");
    editor.commands.addStandaloneComment({
      id: "g1",
      author: "k",
      date: "2026-05-25",
      body: "first",
      scope: "global",
    });
    editor.commands.addStandaloneComment({
      id: "g2",
      author: "k",
      date: "2026-05-25",
      body: "second",
      scope: "global",
    });
    editor.commands.addStandaloneComment({
      id: "x1",
      author: "k",
      date: "2026-05-25",
      target: "A\nB",
      body: "third",
      scope: "cross-section",
    });

    const md = getMarkdown(editor);
    // Exactly one newline between consecutive @comment markers, not a blank
    // line (which would be `\n\n`).
    expect(md).toMatch(/id="g1"[^>]*-->\n<!-- @comment id="g2"/);
    expect(md).toMatch(/id="g2"[^>]*-->\n<!-- @comment id="x1"/);
    // Blank line is preserved between regular content and the standalone
    // group so the HTML block is recognised on round-trip.
    expect(md).toMatch(/Body paragraph\.\n\n<!-- @comment id="g1"/);
  });

  it("survives a full reload after multiple additions (re-parse round-trip)", () => {
    editor = createEditor("Intro.");
    editor.commands.addStandaloneComment({
      id: "g1",
      author: "k",
      date: "2026-05-25",
      body: "global one",
      scope: "global",
    });
    editor.commands.addStandaloneComment({
      id: "x1",
      author: "k",
      date: "2026-05-25",
      target: "Problem\nTry",
      body: "cross one",
      scope: "cross-section",
    });
    editor.commands.addStandaloneComment({
      id: "x2",
      author: "k",
      date: "2026-05-25",
      target: "Action",
      body: "cross two",
      scope: "cross-section",
    });

    const md = getMarkdown(editor);
    // Reload the markdown into a fresh editor and verify all three survive.
    const reloaded = createEditor(md);
    const ids: string[] = [];
    reloaded.state.doc.descendants((node) => {
      if (node.type.name === "standaloneComment") ids.push(node.attrs.id);
    });
    reloaded.destroy();
    expect(ids.sort()).toEqual(["g1", "x1", "x2"]);
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
