/// <reference types="node" />

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import { contentExtensions } from "@/components/tiptap/contentExtensions";
import { splitPreamble } from "./frontmatter";
import { computeAnchorAtBlock, extractAnchorBlocks, type PmAnchor } from "./pmAnchor";

/**
 * Anchor conformance between the editor and the backend (#404).
 *
 * The editor authors anchors from ProseMirror text (Markdown already rendered:
 * entities decoded, escapes resolved, marks dropped). The backend resolves
 * them against the raw file. Whenever the two disagree on what a line "says",
 * a comment is orphaned the moment it is created — #163, #164, #168, #205,
 * #370 and #404 were each one more syntax where they disagreed.
 *
 * This test parses every case with the editor's own extensions and writes the
 * anchors the editor would create into a fixture. The Go test
 * (internal/reviewstore/conformance_test.go) requires every one of them to
 * resolve. A change on either side that makes them disagree fails CI:
 *   - frontend parsing changes → the fixture no longer matches; regenerate
 *     with `UPDATE_ANCHOR_FIXTURE=1 npx vitest run anchorConformance` and the
 *     Go test then checks the new anchors
 *   - backend resolution changes → the Go test fails on the committed fixture
 *
 * Each case keeps one block per source line: the backend resolves per line,
 * and a selection never spans a soft line break in practice.
 */

// vitest runs from frontend/ (jsdom gives import.meta.url a non-file scheme).
const FIXTURE = resolve(process.cwd(), "../internal/reviewstore/testdata/anchor_conformance.json");

const HINT =
  "<!-- markdown-reviewer\n本文はクリーンです。\nCLI(推奨):  mr review <このファイルのパス>\n-->\n\n";

const CASES: Record<string, string> = {
  "entity in heading": "# C&C 報告（2026-11-17）チーム &gt; 11月\n\n- 進捗: 予定どおり\n",
  "entities in text": "x &lt; y &amp; z &gt; w\n\n数値参照 &#62; と &#x3E; と &copy;\n",
  "unknown entity stays literal": "&notanentity; と & 単体\n",
  "backslash escapes": "\\[新\\] / \\[旧\\] と \\_x\\_ と \\*y\\* と a\\\\b\n",
  "escaped entity": "\\&gt; はそのまま\n",
  "tildes": "~~取消~~ と ~draft~ と ~~~三つ~~~ と a~b と ~~~~四つ~~~~ と ~~開きだけ\n\n# ~見出し~ の章\n\n配下の本文\n",
  "emphasis": "**強調** と *斜体* と __太字__ と _細字_ と ~~取消~~\n\n***両方*** と snake_case_name と a*b*c\n",
  "code spans": "`a_b` と ``a`b`` と ` x ` と `&gt;` と `\\[`\n",
  "links": "[テキスト](https://example.com) と [角括弧](<a b.md>) と [参照][r]\n\n[r]: https://example.com/r\n",
  "autolinks": "<https://example.com/a> と https://example.com/b と www.example.com\n",
  "image": "前 ![代替](x.png) 後\n",
  "whitespace runs": "a  b\t\tc   `x  y`   d\n\n全角\u3000\u3000空白\n",
  "inline html": "a <span>b</span> c\n\n改行 <br> の前後\n",
  "heading forms": "Setext 見出し\n===\n\n本文1\n\n## 閉じ付き ##\n\n本文2\n\n### `code` と **強調** の見出し\n\n本文3\n",
  "lists": "- 箇条\n* 星\n+ 足し\n1. 番号\n2) 括弧\n  - 入れ子 &gt; 項目\n\n- [ ] 未完了\n- [x] 完了 &amp; 済\n",
  "blockquote": "> 引用 &gt; 文\n>\n> - 引用内の箇条\n",
  "table": "| 列A | 列B |\n|---|---|\n| a &gt; b | \\[新\\] と `c` |\n| x \\| y | **z** |\n",
  "fenced code is literal": "```sh\n# コメント &gt; そのまま\necho **x** \\[y\\]\n```\n\n## 後の見出し\n\n本文\n",
  "code in list": "- 項目\n\n  ```\n  中 &gt; 身\n  ```\n",
  "mermaid": "```mermaid\ngraph TD\n  A --> B\n```\n\n後の段落\n",
  "html block": "<div>\n生 HTML &gt; ブロック\n</div>\n\n後の段落\n",
  "frontmatter and hint": `${HINT}---\ntitle: x\nkind: y\n---\n\n# 見出し &gt; 1\n\n本文\n`,
};

interface FixtureCase {
  name: string;
  markdown: string;
  anchors: PmAnchor[];
}

const editors: Editor[] = [];
afterAll(() => editors.forEach((e) => e.destroy()));

function editorAnchors(markdown: string): PmAnchor[] {
  const editor = new Editor({ extensions: contentExtensions(), content: "" });
  editors.push(editor);
  editor.commands.setContent(splitPreamble(markdown).body, { emitUpdate: false });
  const blocks = extractAnchorBlocks(editor.state.doc);
  const anchors: PmAnchor[] = [];
  blocks.forEach((_, i) => {
    const a = computeAnchorAtBlock(blocks, i);
    if (a) anchors.push({ heading_path: a.heading_path, snippet: a.snippet, occurrence: a.occurrence });
  });
  return anchors;
}

function buildFixture(): FixtureCase[] {
  return Object.entries(CASES).map(([name, markdown]) => ({
    name,
    markdown,
    anchors: editorAnchors(markdown),
  }));
}

describe("anchor conformance fixture (#404)", () => {
  it("matches what the editor authors for every case", () => {
    const fixture = buildFixture();
    const json = JSON.stringify(fixture, null, 2) + "\n";
    if (process.env.UPDATE_ANCHOR_FIXTURE === "1") {
      writeFileSync(FIXTURE, json);
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(fixture);
  });

  it("every case produces anchors", () => {
    for (const c of buildFixture()) {
      expect(c.anchors.length, c.name).toBeGreaterThan(0);
    }
  });
});
