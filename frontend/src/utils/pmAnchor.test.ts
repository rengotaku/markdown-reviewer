import { describe, it, expect, afterEach } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import {
  resolveAnchorInBlocks,
  computeAnchorInBlocks,
  computeAnchorAtBlock,
  computeAnchorsFromSelection,
  blockIndexAtPos,
  extractAnchorBlocks,
  resolveAnchorInDoc,
  stripBlockMarkers,
  type AnchorBlock,
} from "./pmAnchor";

// A small flattened document mirroring the markdown:
//   # 認証
//   ## トークンの期限
//   - アクセストークン: 24 時間
//   ## エラー
//   24 時間 という別の出現
// Positions are illustrative but internally consistent (start..end per block).
const blocks: AnchorBlock[] = [
  { start: 1, end: 5, text: "認証", headingStack: ["# 認証"], lineGroup: 0 },
  {
    start: 7,
    end: 18,
    text: "トークンの期限",
    headingStack: ["# 認証", "## トークンの期限"],
    lineGroup: 1,
  },
  {
    start: 20,
    end: 40,
    text: "アクセストークン: 24 時間",
    headingStack: ["# 認証", "## トークンの期限"],
    lineGroup: 2,
  },
  {
    start: 42,
    end: 48,
    text: "エラー",
    headingStack: ["# 認証", "## エラー"],
    lineGroup: 3,
  },
  {
    start: 50,
    end: 70,
    text: "24 時間 という別の出現",
    headingStack: ["# 認証", "## エラー"],
    lineGroup: 4,
  },
];

describe("pmAnchor", () => {
  it("resolves a heading-scoped snippet to its first match range", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["## トークンの期限"],
      snippet: "24 時間",
      occurrence: 0,
    });
    // block index 2 (start=20); offset = snippet position within the block text.
    const off = "アクセストークン: 24 時間".indexOf("24 時間");
    expect(r).toEqual({ from: 20 + off, to: 20 + off + "24 時間".length });
  });

  it("scopes the same snippet to a different heading", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["## エラー"],
      snippet: "24 時間",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 50, to: 50 + "24 時間".length });
  });

  it("returns null for an orphaned snippet", () => {
    expect(
      resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "無い", occurrence: 0 })
    ).toBeNull();
  });

  it("computeAnchorInBlocks is the inverse of resolveAnchorInBlocks", () => {
    const a = computeAnchorInBlocks(blocks, 4, "24 時間");
    expect(a.heading_path).toEqual(["# 認証", "## エラー"]);
    expect(a.occurrence).toBe(0); // first under ## エラー
    expect(resolveAnchorInBlocks(blocks, a)).toEqual({
      from: 50,
      to: 50 + "24 時間".length,
    });
  });

  it("counts occurrence among duplicates under the same heading", () => {
    const dup: AnchorBlock[] = [
      { start: 1, end: 5, text: "H", headingStack: ["## H"], lineGroup: 0 },
      { start: 7, end: 10, text: "x y", headingStack: ["## H"], lineGroup: 1 },
      { start: 12, end: 15, text: "x z", headingStack: ["## H"], lineGroup: 2 },
    ];
    const a = computeAnchorInBlocks(dup, 2, "x");
    expect(a.occurrence).toBe(1);
    expect(resolveAnchorInBlocks(dup, a)).toEqual({ from: 12, to: 13 });
  });

  it("computeAnchorAtBlock anchors a whole heading block", () => {
    const a = computeAnchorAtBlock(blocks, 3);
    expect(a).not.toBeNull();
    expect(a!.snippet).toBe("エラー");
    expect(a!.heading_path).toEqual(["# 認証", "## エラー"]);
    expect(resolveAnchorInBlocks(blocks, a!)).toEqual({ from: 42, to: 45 });
  });

  it("blockIndexAtPos locates the block holding a position", () => {
    expect(blockIndexAtPos(blocks, 25)).toBe(2);
    expect(blockIndexAtPos(blocks, 60)).toBe(4);
    expect(blockIndexAtPos(blocks, 999)).toBe(-1);
  });

  it("returns null for an empty snippet", () => {
    expect(
      resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "", occurrence: 0 })
    ).toBeNull();
  });

  it("returns null when the snippet only appears under a non-matching heading", () => {
    expect(
      resolveAnchorInBlocks(blocks, {
        heading_path: ["## 存在しない見出し"],
        snippet: "24 時間",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("computeAnchorAtBlock returns null for a missing or empty block", () => {
    expect(computeAnchorAtBlock(blocks, 99)).toBeNull();
    const blank: AnchorBlock[] = [
      { start: 1, end: 3, text: "   ", headingStack: [], lineGroup: 0 },
    ];
    expect(computeAnchorAtBlock(blank, 0)).toBeNull();
  });
});

// The ProseMirror adapters (extractAnchorBlocks / resolveAnchorInDoc /
// computeAnchorsFromSelection) run against a real headless TipTap editor,
// since their whole job is walking the live document tree.
describe("pmAnchor ProseMirror adapters", () => {
  let editor: Editor | null = null;

  function makeEditor(content: string): Editor {
    editor = new Editor({
      extensions: [StarterKit.configure({ link: false })],
      content,
    });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  const CONTENT =
    "<h1>認証</h1>" +
    "<h2>トークンの期限</h2>" +
    "<p>アクセストークン: 24 時間</p>" +
    "<h2>エラー</h2>" +
    "<p>24 時間 という別の出現</p>";

  it("extractAnchorBlocks flattens blocks with their heading stacks", () => {
    const ed = makeEditor(CONTENT);
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks.map((b) => b.text)).toEqual([
      "認証",
      "トークンの期限",
      "アクセストークン: 24 時間",
      "エラー",
      "24 時間 という別の出現",
    ]);
    expect(blocks[2].headingStack).toEqual(["# 認証", "## トークンの期限"]);
    // Sibling h2 replaces the previous h2 on the stack (pop-then-push).
    expect(blocks[4].headingStack).toEqual(["# 認証", "## エラー"]);
  });

  it("extractAnchorBlocks descends into list items", () => {
    const ed = makeEditor("<h2>List</h2><ul><li><p>item one</p></li><li><p>item two</p></li></ul>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain("item one");
    expect(texts).toContain("item two");
    const item = blocks.find((b) => b.text === "item one")!;
    expect(item.headingStack).toEqual(["## List"]);
  });

  it("resolveAnchorInDoc resolves a stored anchor to a live range", () => {
    const ed = makeEditor(CONTENT);
    const range = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## エラー"],
      snippet: "24 時間",
      occurrence: 0,
    });
    expect(range).not.toBeNull();
    expect(ed.state.doc.textBetween(range!.from, range!.to)).toBe("24 時間");
  });

  it("resolveAnchorInDoc returns null for text no longer present", () => {
    const ed = makeEditor(CONTENT);
    expect(
      resolveAnchorInDoc(ed.state.doc, {
        heading_path: [],
        snippet: "消えたテキスト",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("computeAnchorsFromSelection round-trips a single-block selection through resolveAnchorInDoc", () => {
    const ed = makeEditor(CONTENT);
    // Locate "24 時間" in the トークンの期限 paragraph and anchor that selection.
    const target = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## トークンの期限"],
      snippet: "24 時間",
      occurrence: 0,
    })!;
    const anchors = computeAnchorsFromSelection(ed.state.doc, target.from, target.to);
    expect(anchors).toEqual([
      { heading_path: ["# 認証", "## トークンの期限"], snippet: "24 時間", occurrence: 0 },
    ]);
    expect(resolveAnchorInDoc(ed.state.doc, anchors[0])).toEqual(target);
  });

  // A1: single paragraph, partial selection — must match the pre-fix
  // single-block behavior (issue #162, case A1).
  it("A1: anchors a partial selection within a single paragraph", () => {
    const ed = makeEditor("<p>alpha beta gamma</p>");
    const target = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "beta",
      occurrence: 0,
    })!;
    const anchors = computeAnchorsFromSelection(ed.state.doc, target.from, target.to);
    expect(anchors).toEqual([{ heading_path: [], snippet: "beta", occurrence: 0 }]);
  });

  // A2: selection starts mid-paragraph-1 and ends mid-paragraph-2 — one anchor
  // per touched block, each clamped to its own overlap with the selection
  // (issue #162, case A2).
  it("A2: anchors both blocks when the selection spans paragraph middles", () => {
    const ed = makeEditor("<p>one two three</p><p>four five six</p>");
    const from = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "two",
      occurrence: 0,
    })!.from;
    const to = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "five",
      occurrence: 0,
    })!.to;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].snippet).toBe("two three");
    expect(anchors[1].snippet).toBe("four five");
  });

  // A3 (the bug's repro case): selection starts at the end of paragraph 1
  // (line-end) and ends mid paragraph 2. Paragraph 1's overlap trims to an
  // empty snippet and must be skipped rather than yielding no anchors at all.
  it("A3: skips an empty leading block when the selection starts at a paragraph's line end", () => {
    const ed = makeEditor("<p>alpha bravo</p><p>charlie delta</p>");
    const from = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "bravo",
      occurrence: 0,
    })!.to; // end of paragraph 1's text — nothing left to select in block 1
    const to = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "charlie",
      occurrence: 0,
    })!.to;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toEqual([{ heading_path: [], snippet: "charlie", occurrence: 0 }]);
  });

  // A4: selection starts mid paragraph 1 and ends at paragraph 2's line head
  // (0 characters selected there) — only paragraph 1 yields an anchor.
  it("A4: skips an empty trailing block when the selection ends at a paragraph's line head", () => {
    const ed = makeEditor("<p>alpha bravo</p><p>charlie delta</p>");
    const from = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "bravo",
      occurrence: 0,
    })!.from;
    const to = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "charlie",
      occurrence: 0,
    })!.from; // paragraph 2's line head — 0 chars selected there
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toEqual([{ heading_path: [], snippet: "bravo", occurrence: 0 }]);
  });

  // A5: select three whole paragraphs — one anchor per block, each covering
  // the full paragraph text.
  it("A5: anchors every block when the whole selection spans three paragraphs", () => {
    const ed = makeEditor("<p>first</p><p>second</p><p>third</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[2].start + blocks[2].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors.map((a) => a.snippet)).toEqual(["first", "second", "third"]);
  });

  // A6: selecting only whitespace trims every touched block to an empty
  // snippet — the result is an empty array, not a thrown error.
  it("A6: returns an empty array for a whitespace-only selection", () => {
    const ed = makeEditor("<p>a b</p>");
    // Position 2..3 is the single space between "a" and "b".
    const anchors = computeAnchorsFromSelection(ed.state.doc, 2, 3);
    expect(anchors).toEqual([]);
  });

  // A7: three paragraphs share the same text; selecting the 2nd and 3rd must
  // report their true occurrence among all earlier same-text blocks (1 and 2
  // respectively), not occurrence 0 for both.
  it("A7: computes occurrence relative to all preceding blocks, not just the selection", () => {
    const ed = makeEditor("<p>dup</p><p>dup</p><p>dup</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[1].start;
    const to = blocks[2].start + blocks[2].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].occurrence).toBe(1);
    expect(anchors[1].occurrence).toBe(2);
  });

  // A8: selecting a heading plus the paragraph directly under it must anchor
  // both blocks, and the paragraph's heading_path must include that heading.
  it("A8: anchors a heading and the paragraph beneath it, carrying the heading in heading_path", () => {
    const ed = makeEditor("<h2>Section</h2><p>body text</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors[1].heading_path).toContain("## Section");
  });

  // A9: selecting two list items yields one anchor per item.
  it("A9: anchors each selected list item separately", () => {
    const ed = makeEditor(
      "<h2>List</h2><ul><li><p>item one</p></li><li><p>item two</p></li></ul>"
    );
    const blocks = extractAnchorBlocks(ed.state.doc);
    const itemOne = blocks.find((b) => b.text === "item one")!;
    const itemTwo = blocks.find((b) => b.text === "item two")!;
    const anchors = computeAnchorsFromSelection(
      ed.state.doc,
      itemOne.start,
      itemTwo.start + itemTwo.text.length
    );
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.snippet)).toEqual(["item one", "item two"]);
  });
});

// #168: snippets written by AI clients keep the raw line's block-level markers
// (the backend matches Markdown lines, which have them), but ProseMirror block
// text does not. Measured on a real file: 8 of 9 backend-resolvable comments
// were unresolvable in the editor for exactly this reason — 7 ordered-list
// markers and 1 blockquote marker.
describe("resolveAnchorInBlocks with block-level markers (#168)", () => {
  const blocks: AnchorBlock[] = [
    {
      start: 1,
      end: 20,
      text: "同じ移行を他の人が再現できる状態にした",
      headingStack: ["### 実績"],
      lineGroup: 0,
    },
    {
      start: 30,
      end: 60,
      text: "⚠️ レビューで挙げた 6 件を削除した",
      headingStack: ["### 実績"],
      lineGroup: 1,
    },
    { start: 70, end: 90, text: "特になし。", headingStack: ["### 課題"], lineGroup: 2 },
  ];

  it("resolves a snippet carrying an ordered-list marker", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["### 実績"],
      snippet: "4. 同じ移行を他の人が再現できる状態にした",
      occurrence: 0,
    });
    // The range must cover the block text only — the "4. " is not in the doc.
    expect(r).toEqual({ from: 1, to: 1 + "同じ移行を他の人が再現できる状態にした".length });
  });

  it("resolves a snippet carrying a blockquote marker", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["### 実績"],
      snippet: "> ⚠️ レビューで挙げた 6 件を削除した",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 30, to: 30 + "⚠️ レビューで挙げた 6 件を削除した".length });
  });

  it("resolves a blockquote marker written without a space", () => {
    // CommonMark accepts ">text" and ">>text"; the backend matches the raw
    // line, so the editor has to strip these forms too.
    for (const snippet of [">特になし。", ">>特になし。", "> > 特になし。"]) {
      expect(resolveAnchorInBlocks(blocks, { heading_path: [], snippet, occurrence: 0 })).toEqual(
        { from: 70, to: 70 + "特になし。".length }
      );
    }
  });

  it("leaves prose that merely starts with a hyphen or digit alone", () => {
    // "-text" / "1.text" / "#text" are not list items or headings, so nothing
    // may be stripped — otherwise the fallback would match the wrong block.
    const prose: AnchorBlock[] = [
      { start: 1, end: 10, text: "-5 度まで下がった", headingStack: [], lineGroup: 0 },
    ];
    expect(stripBlockMarkers("-5 度まで下がった")).toBe("-5 度まで下がった");
    expect(
      resolveAnchorInBlocks(prose, {
        heading_path: [],
        snippet: "-5 度まで下がった",
        occurrence: 0,
      })
    ).toEqual({ from: 1, to: 1 + "-5 度まで下がった".length });
  });

  it("resolves nested markers such as '> - '", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: [],
      snippet: "> - 特になし。",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 70, to: 70 + "特になし。".length });
  });

  it("prefers an exact match over the stripped form", () => {
    // A block whose text genuinely starts with "1. " must win against a later
    // block matching only after stripping, so real content is never skipped.
    const withLiteral: AnchorBlock[] = [
      { start: 1, end: 10, text: "1. リテラルな行", headingStack: [], lineGroup: 0 },
      { start: 20, end: 30, text: "リテラルな行", headingStack: [], lineGroup: 1 },
    ];
    const r = resolveAnchorInBlocks(withLiteral, {
      heading_path: [],
      snippet: "1. リテラルな行",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 1, to: 1 + "1. リテラルな行".length });
  });

  it("still returns null when the text is genuinely gone", () => {
    expect(
      resolveAnchorInBlocks(blocks, {
        heading_path: [],
        snippet: "1. 本文から消えた行",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("refuses to guess when the stripped form is ambiguous", () => {
    // "1. 同じ文" and "2. 同じ文" both strip to "同じ文". The occurrence on a
    // marker-prefixed snippet was counted against raw Markdown lines, where
    // "2. 同じ文" appears once — so occurrence 0 means the *second* item. The
    // stripped set numbers them differently, so committing to an index here
    // would point at a confidently wrong line. Orphan is the honest answer.
    const dup: AnchorBlock[] = [
      { start: 1, end: 10, text: "同じ文", headingStack: ["## A"], lineGroup: 0 },
      { start: 20, end: 30, text: "同じ文", headingStack: ["## A"], lineGroup: 1 },
    ];
    expect(
      resolveAnchorInBlocks(dup, {
        heading_path: ["## A"],
        snippet: "2. 同じ文",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("keeps exact matching in charge of occurrence", () => {
    // When the snippet matches literally, the fallback must not run at all and
    // occurrence must still select the nth match.
    const dup: AnchorBlock[] = [
      { start: 1, end: 10, text: "- 生き残った記号付きの行", headingStack: [], lineGroup: 0 },
      { start: 20, end: 30, text: "- 生き残った記号付きの行", headingStack: [], lineGroup: 1 },
    ];
    expect(
      resolveAnchorInBlocks(dup, {
        heading_path: [],
        snippet: "- 生き残った記号付きの行",
        occurrence: 1,
      })
    ).toEqual({ from: 20, to: 20 + "- 生き残った記号付きの行".length });
  });

  it("authoring counts only exact matches for occurrence", () => {
    // computeAnchorInBlocks sees ProseMirror block text, which never carries a
    // marker; counting stripped matches would inflate occurrence past what the
    // exact-match resolve path counts back.
    const dup: AnchorBlock[] = [
      { start: 1, end: 10, text: "2. マーカー付きの行", headingStack: [], lineGroup: 0 },
      { start: 20, end: 30, text: "マーカー付きの行", headingStack: [], lineGroup: 1 },
    ];
    const anchor = computeAnchorInBlocks(dup, 1, "マーカー付きの行");
    // Block 0's text contains "マーカー付きの行" literally, so it counts.
    expect(anchor.occurrence).toBe(1);
    expect(resolveAnchorInBlocks(dup, anchor)).toEqual({
      from: 20,
      to: 20 + "マーカー付きの行".length,
    });
  });
});

// #163 / #164: the frontend must anchor at Markdown-*line* granularity, not
// ProseMirror-*textblock* granularity, or occurrence disagrees with the
// backend's per-line scan (internal/reviewstore/comments.go ResolveAnchor).
// A fenced code block is one PM textblock spanning N Markdown lines (#163);
// a table row is N PM textblocks (one per cell) spanning one Markdown line
// (#164). `lineGroup` on AnchorBlock closes that gap: units from the same
// Markdown line share a `lineGroup`, and occurrence counts groups, not units.
describe("extractAnchorBlocks / occurrence at Markdown-line granularity (#163 / #164)", () => {
  let editor: Editor | null = null;

  // Table extensions mirror the production editor (TiptapEditor.tsx) so the
  // node type names ("table" / "tableRow" / "tableCell") match what
  // extractAnchorBlocks checks against.
  function makeEditor(content: string | JSONContent): Editor {
    editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
      ],
      content,
    });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function codeBlockDoc(lines: string[]) {
    return {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: lines.length ? [{ type: "text", text: lines.join("\n") }] : [],
        },
      ],
    };
  }

  function tableDoc(rows: string[][]) {
    return {
      type: "doc",
      content: [
        {
          type: "table",
          content: rows.map((cells) => ({
            type: "tableRow",
            content: cells.map((cell) => ({
              type: "tableCell",
              content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : [] }],
            })),
          })),
        },
      ],
    };
  }

  // A1: a 3-line code block becomes 3 units, none carrying a literal newline,
  // each with a distinct lineGroup.
  it("A1: splits a fenced code block into one unit per line", () => {
    const ed = makeEditor(codeBlockDoc(["const a = 1;", "const b = 2;", "return a + b;"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.text)).toEqual([
      "const a = 1;",
      "const b = 2;",
      "return a + b;",
    ]);
    for (const b of blocks) expect(b.text).not.toContain("\n");
    const groups = blocks.map((b) => b.lineGroup);
    expect(new Set(groups).size).toBe(3);
  });

  // A2: each line unit's start/end must address exactly that line's text in
  // the live document (position math check).
  it("A2: each code-block line unit's start/end addresses that line's text", () => {
    const ed = makeEditor(codeBlockDoc(["const a = 1;", "const b = 2;", "return a + b;"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    for (const b of blocks) {
      expect(ed.state.doc.textBetween(b.start, b.end)).toBe(b.text);
    }
  });

  // A3: a 2x2 table — same row shares lineGroup, different rows differ.
  it("A3: table cells in the same row share a lineGroup; different rows differ", () => {
    const ed = makeEditor(
      tableDoc([
        ["a", "b"],
        ["c", "d"],
      ])
    );
    const blocks = extractAnchorBlocks(ed.state.doc);
    const byText = (t: string) => blocks.find((b) => b.text === t)!;
    expect(byText("a").lineGroup).toBe(byText("b").lineGroup);
    expect(byText("c").lineGroup).toBe(byText("d").lineGroup);
    expect(byText("a").lineGroup).not.toBe(byText("c").lineGroup);
  });

  // A4: plain paragraphs/headings/list items keep one unit per textblock and
  // every lineGroup distinct — unchanged from pre-#163 behavior.
  it("A4: plain textblocks keep one unit per block with distinct lineGroups (back-compat)", () => {
    const ed = makeEditor(
      "<h2>Section</h2><p>alpha</p><ul><li><p>item one</p></li><li><p>item two</p></li></ul>"
    );
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks.map((b) => b.text)).toEqual(["Section", "alpha", "item one", "item two"]);
    expect(new Set(blocks.map((b) => b.lineGroup)).size).toBe(blocks.length);
  });

  // A5: a blank line inside a code block still consumes its own unit /
  // lineGroup, so line numbering does not drift.
  it("A5: a blank code-block line still consumes a unit and lineGroup", () => {
    const ed = makeEditor(codeBlockDoc(["first", "", "third"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.text)).toEqual(["first", "", "third"]);
    expect(new Set(blocks.map((b) => b.lineGroup)).size).toBe(3);
  });

  // B1: "| x | x |" — a 1-row table with two identical cells. Anchoring from
  // the second cell must not see the first cell's match as a distinct
  // occurrence: they share a lineGroup.
  it("B1: computeAnchorInBlocks does not count a same-lineGroup match as a separate occurrence", () => {
    const ed = makeEditor(tableDoc([["x", "x"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const secondCellIndex = blocks.map((b) => b.text).lastIndexOf("x");
    const anchor = computeAnchorInBlocks(blocks, secondCellIndex, "x");
    expect(anchor.occurrence).toBe(0);
  });

  // B2: the same string in two different table rows *does* count as two
  // occurrences (different lineGroups).
  it("B2: computeAnchorInBlocks counts matches in a different lineGroup as separate occurrences", () => {
    const ed = makeEditor(tableDoc([["x"], ["x"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const secondRowIndex = blocks.map((b) => b.text).lastIndexOf("x");
    const anchor = computeAnchorInBlocks(blocks, secondRowIndex, "x");
    expect(anchor.occurrence).toBe(1);
  });

  // B3: resolving the B1 anchor must not orphan — it resolves to the first
  // cell in the row that matches (the documented same-row/same-text limit).
  it("B3: resolveAnchorInBlocks resolves the B1 anchor to the row's first matching cell", () => {
    const ed = makeEditor(tableDoc([["x", "x"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const first = blocks[0];
    const r = resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "x", occurrence: 0 });
    expect(r).not.toBeNull();
    expect(r).toEqual({ from: first.start, to: first.start + 1 });
  });

  // B4: a repeated line inside a single code block — occurrence 1 resolves
  // to the second occurrence of that line (distinct lineGroups, unchanged
  // per-unit counting).
  it("B4: resolves the second occurrence of a repeated code-block line", () => {
    const ed = makeEditor(codeBlockDoc(["dup", "other", "dup"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const r = resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "dup", occurrence: 1 });
    const secondDup = blocks[2];
    expect(r).toEqual({ from: secondDup.start, to: secondDup.start + "dup".length });
  });

  // B5: three plain paragraphs sharing the same text — occurrence 0/1/2 map
  // to each block in order, matching pre-#163 behavior.
  it("B5: plain-paragraph occurrence counting is unchanged (back-compat)", () => {
    const ed = makeEditor("<p>dup</p><p>dup</p><p>dup</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    for (let i = 0; i < 3; i++) {
      const r = resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "dup", occurrence: i });
      expect(r).toEqual({ from: blocks[i].start, to: blocks[i].start + "dup".length });
    }
  });

  // C1: selecting a code block's first two lines yields two anchors, neither
  // carrying a literal newline (the #163 repro case).
  it("C1: selecting two code-block lines yields two newline-free anchors", () => {
    const ed = makeEditor(codeBlockDoc(["line one", "line two", "line three"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    for (const a of anchors) expect(a.snippet).not.toContain("\n");
    expect(anchors.map((a) => a.snippet)).toEqual(["line one", "line two"]);
  });

  // C2: selecting the whole 3-line code block yields three anchors.
  it("C2: selecting an entire code block yields one anchor per line", () => {
    const ed = makeEditor(codeBlockDoc(["line one", "line two", "line three"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[2].start + blocks[2].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(3);
    expect(anchors.map((a) => a.snippet)).toEqual(["line one", "line two", "line three"]);
  });

  // C3: a selection spanning from a preceding paragraph's line end into a
  // code block's first line only yields the code-block side (the paragraph
  // side trims to empty and is skipped, per #162's A3 rule) — the surviving
  // anchor is newline-free.
  it("C3: a selection crossing into a code block only yields the non-empty code-block side", () => {
    const ed = new Editor({
      extensions: [StarterKit.configure({ link: false })],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "intro" }] },
          {
            type: "codeBlock",
            content: [{ type: "text", text: "line one\nline two" }],
          },
        ],
      },
    });
    try {
      const blocks = extractAnchorBlocks(ed.state.doc);
      const paragraphEnd = blocks[0].start + blocks[0].text.length;
      const firstLine = blocks.find((b) => b.text === "line one")!;
      const to = firstLine.start + "line".length; // partway into the first line only
      const anchors = computeAnchorsFromSelection(ed.state.doc, paragraphEnd, to);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].snippet).toBe("line");
      for (const a of anchors) expect(a.snippet).not.toContain("\n");
    } finally {
      ed.destroy();
    }
  });

  // C4: selecting two cells in the same table row yields two anchors, both
  // occurrence 0 (same lineGroup).
  it("C4: selecting two same-row cells yields two anchors both at occurrence 0", () => {
    const ed = makeEditor(tableDoc([["a", "b"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.snippet)).toEqual(["a", "b"]);
    expect(anchors.every((a) => a.occurrence === 0)).toBe(true);
  });

  // C5: selecting across two paragraphs still yields two anchors (#162
  // behavior preserved by this change).
  it("C5: selecting across two paragraphs still yields two anchors (#162 preserved)", () => {
    const ed = makeEditor("<p>first para</p><p>second para</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.snippet)).toEqual(["first para", "second para"]);
  });

  // A document with no headings stores anchors whose heading_path can be null
  // (#262); the resolve path must read it as "unscoped", not throw.
  it("treats a null heading_path as unscoped instead of throwing", () => {
    const headingless = [
      {
        start: 1,
        end: 14,
        text: "スケジュールを確定させる",
        headingStack: [],
        lineGroup: 1,
      },
    ];
    const r = resolveAnchorInBlocks(headingless, {
      heading_path: null,
      snippet: "スケジュール",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 1, to: 1 + "スケジュール".length });
  });


  it("blockIndexAtPos locates the block holding a position", () => {
    expect(blockIndexAtPos(blocks, 25)).toBe(2);
    expect(blockIndexAtPos(blocks, 60)).toBe(4);
    expect(blockIndexAtPos(blocks, 999)).toBe(-1);
  });

  it("returns null for an empty snippet", () => {
    expect(
      resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "", occurrence: 0 })
    ).toBeNull();
  });

  it("returns null when the snippet only appears under a non-matching heading", () => {
    expect(
      resolveAnchorInBlocks(blocks, {
        heading_path: ["## 存在しない見出し"],
        snippet: "24 時間",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("computeAnchorAtBlock returns null for a missing or empty block", () => {
    expect(computeAnchorAtBlock(blocks, 99)).toBeNull();
    const blank: AnchorBlock[] = [
      { start: 1, end: 3, text: "   ", headingStack: [], lineGroup: 0 },
    ];
    expect(computeAnchorAtBlock(blank, 0)).toBeNull();
  });
});

// The ProseMirror adapters (extractAnchorBlocks / resolveAnchorInDoc /
// computeAnchorsFromSelection) run against a real headless TipTap editor,
// since their whole job is walking the live document tree.
describe("pmAnchor ProseMirror adapters", () => {
  let editor: Editor | null = null;

  function makeEditor(content: string): Editor {
    editor = new Editor({
      extensions: [StarterKit.configure({ link: false })],
      content,
    });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  const CONTENT =
    "<h1>認証</h1>" +
    "<h2>トークンの期限</h2>" +
    "<p>アクセストークン: 24 時間</p>" +
    "<h2>エラー</h2>" +
    "<p>24 時間 という別の出現</p>";

  it("extractAnchorBlocks flattens blocks with their heading stacks", () => {
    const ed = makeEditor(CONTENT);
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks.map((b) => b.text)).toEqual([
      "認証",
      "トークンの期限",
      "アクセストークン: 24 時間",
      "エラー",
      "24 時間 という別の出現",
    ]);
    expect(blocks[2].headingStack).toEqual(["# 認証", "## トークンの期限"]);
    // Sibling h2 replaces the previous h2 on the stack (pop-then-push).
    expect(blocks[4].headingStack).toEqual(["# 認証", "## エラー"]);
  });

  it("extractAnchorBlocks descends into list items", () => {
    const ed = makeEditor("<h2>List</h2><ul><li><p>item one</p></li><li><p>item two</p></li></ul>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain("item one");
    expect(texts).toContain("item two");
    const item = blocks.find((b) => b.text === "item one")!;
    expect(item.headingStack).toEqual(["## List"]);
  });

  it("resolveAnchorInDoc resolves a stored anchor to a live range", () => {
    const ed = makeEditor(CONTENT);
    const range = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## エラー"],
      snippet: "24 時間",
      occurrence: 0,
    });
    expect(range).not.toBeNull();
    expect(ed.state.doc.textBetween(range!.from, range!.to)).toBe("24 時間");
  });

  it("resolveAnchorInDoc returns null for text no longer present", () => {
    const ed = makeEditor(CONTENT);
    expect(
      resolveAnchorInDoc(ed.state.doc, {
        heading_path: [],
        snippet: "消えたテキスト",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("computeAnchorsFromSelection round-trips a single-block selection through resolveAnchorInDoc", () => {
    const ed = makeEditor(CONTENT);
    // Locate "24 時間" in the トークンの期限 paragraph and anchor that selection.
    const target = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## トークンの期限"],
      snippet: "24 時間",
      occurrence: 0,
    })!;
    const anchors = computeAnchorsFromSelection(ed.state.doc, target.from, target.to);
    expect(anchors).toEqual([
      { heading_path: ["# 認証", "## トークンの期限"], snippet: "24 時間", occurrence: 0 },
    ]);
    expect(resolveAnchorInDoc(ed.state.doc, anchors[0])).toEqual(target);
  });

  // A1: single paragraph, partial selection — must match the pre-fix
  // single-block behavior (issue #162, case A1).
  it("A1: anchors a partial selection within a single paragraph", () => {
    const ed = makeEditor("<p>alpha beta gamma</p>");
    const target = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "beta",
      occurrence: 0,
    })!;
    const anchors = computeAnchorsFromSelection(ed.state.doc, target.from, target.to);
    expect(anchors).toEqual([{ heading_path: [], snippet: "beta", occurrence: 0 }]);
  });

  // A2: selection starts mid-paragraph-1 and ends mid-paragraph-2 — one anchor
  // per touched block, each clamped to its own overlap with the selection
  // (issue #162, case A2).
  it("A2: anchors both blocks when the selection spans paragraph middles", () => {
    const ed = makeEditor("<p>one two three</p><p>four five six</p>");
    const from = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "two",
      occurrence: 0,
    })!.from;
    const to = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "five",
      occurrence: 0,
    })!.to;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].snippet).toBe("two three");
    expect(anchors[1].snippet).toBe("four five");
  });

  // A3 (the bug's repro case): selection starts at the end of paragraph 1
  // (line-end) and ends mid paragraph 2. Paragraph 1's overlap trims to an
  // empty snippet and must be skipped rather than yielding no anchors at all.
  it("A3: skips an empty leading block when the selection starts at a paragraph's line end", () => {
    const ed = makeEditor("<p>alpha bravo</p><p>charlie delta</p>");
    const from = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "bravo",
      occurrence: 0,
    })!.to; // end of paragraph 1's text — nothing left to select in block 1
    const to = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "charlie",
      occurrence: 0,
    })!.to;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toEqual([{ heading_path: [], snippet: "charlie", occurrence: 0 }]);
  });

  // A4: selection starts mid paragraph 1 and ends at paragraph 2's line head
  // (0 characters selected there) — only paragraph 1 yields an anchor.
  it("A4: skips an empty trailing block when the selection ends at a paragraph's line head", () => {
    const ed = makeEditor("<p>alpha bravo</p><p>charlie delta</p>");
    const from = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "bravo",
      occurrence: 0,
    })!.from;
    const to = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "charlie",
      occurrence: 0,
    })!.from; // paragraph 2's line head — 0 chars selected there
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toEqual([{ heading_path: [], snippet: "bravo", occurrence: 0 }]);
  });

  // A5: select three whole paragraphs — one anchor per block, each covering
  // the full paragraph text.
  it("A5: anchors every block when the whole selection spans three paragraphs", () => {
    const ed = makeEditor("<p>first</p><p>second</p><p>third</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[2].start + blocks[2].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors.map((a) => a.snippet)).toEqual(["first", "second", "third"]);
  });

  // A6: selecting only whitespace trims every touched block to an empty
  // snippet — the result is an empty array, not a thrown error.
  it("A6: returns an empty array for a whitespace-only selection", () => {
    const ed = makeEditor("<p>a b</p>");
    // Position 2..3 is the single space between "a" and "b".
    const anchors = computeAnchorsFromSelection(ed.state.doc, 2, 3);
    expect(anchors).toEqual([]);
  });

  // A7: three paragraphs share the same text; selecting the 2nd and 3rd must
  // report their true occurrence among all earlier same-text blocks (1 and 2
  // respectively), not occurrence 0 for both.
  it("A7: computes occurrence relative to all preceding blocks, not just the selection", () => {
    const ed = makeEditor("<p>dup</p><p>dup</p><p>dup</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[1].start;
    const to = blocks[2].start + blocks[2].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].occurrence).toBe(1);
    expect(anchors[1].occurrence).toBe(2);
  });

  // A8: selecting a heading plus the paragraph directly under it must anchor
  // both blocks, and the paragraph's heading_path must include that heading.
  it("A8: anchors a heading and the paragraph beneath it, carrying the heading in heading_path", () => {
    const ed = makeEditor("<h2>Section</h2><p>body text</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors[1].heading_path).toContain("## Section");
  });

  // A9: selecting two list items yields one anchor per item.
  it("A9: anchors each selected list item separately", () => {
    const ed = makeEditor(
      "<h2>List</h2><ul><li><p>item one</p></li><li><p>item two</p></li></ul>"
    );
    const blocks = extractAnchorBlocks(ed.state.doc);
    const itemOne = blocks.find((b) => b.text === "item one")!;
    const itemTwo = blocks.find((b) => b.text === "item two")!;
    const anchors = computeAnchorsFromSelection(
      ed.state.doc,
      itemOne.start,
      itemTwo.start + itemTwo.text.length
    );
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.snippet)).toEqual(["item one", "item two"]);
  });
});

// #168: snippets written by AI clients keep the raw line's block-level markers
// (the backend matches Markdown lines, which have them), but ProseMirror block
// text does not. Measured on a real file: 8 of 9 backend-resolvable comments
// were unresolvable in the editor for exactly this reason — 7 ordered-list
// markers and 1 blockquote marker.
describe("resolveAnchorInBlocks with block-level markers (#168)", () => {
  const blocks: AnchorBlock[] = [
    {
      start: 1,
      end: 20,
      text: "同じ移行を他の人が再現できる状態にした",
      headingStack: ["### 実績"],
      lineGroup: 0,
    },
    {
      start: 30,
      end: 60,
      text: "⚠️ レビューで挙げた 6 件を削除した",
      headingStack: ["### 実績"],
      lineGroup: 1,
    },
    { start: 70, end: 90, text: "特になし。", headingStack: ["### 課題"], lineGroup: 2 },
  ];

  it("resolves a snippet carrying an ordered-list marker", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["### 実績"],
      snippet: "4. 同じ移行を他の人が再現できる状態にした",
      occurrence: 0,
    });
    // The range must cover the block text only — the "4. " is not in the doc.
    expect(r).toEqual({ from: 1, to: 1 + "同じ移行を他の人が再現できる状態にした".length });
  });

  it("resolves a snippet carrying a blockquote marker", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: ["### 実績"],
      snippet: "> ⚠️ レビューで挙げた 6 件を削除した",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 30, to: 30 + "⚠️ レビューで挙げた 6 件を削除した".length });
  });

  it("resolves a blockquote marker written without a space", () => {
    // CommonMark accepts ">text" and ">>text"; the backend matches the raw
    // line, so the editor has to strip these forms too.
    for (const snippet of [">特になし。", ">>特になし。", "> > 特になし。"]) {
      expect(resolveAnchorInBlocks(blocks, { heading_path: [], snippet, occurrence: 0 })).toEqual(
        { from: 70, to: 70 + "特になし。".length }
      );
    }
  });

  it("leaves prose that merely starts with a hyphen or digit alone", () => {
    // "-text" / "1.text" / "#text" are not list items or headings, so nothing
    // may be stripped — otherwise the fallback would match the wrong block.
    const prose: AnchorBlock[] = [
      { start: 1, end: 10, text: "-5 度まで下がった", headingStack: [], lineGroup: 0 },
    ];
    expect(stripBlockMarkers("-5 度まで下がった")).toBe("-5 度まで下がった");
    expect(
      resolveAnchorInBlocks(prose, {
        heading_path: [],
        snippet: "-5 度まで下がった",
        occurrence: 0,
      })
    ).toEqual({ from: 1, to: 1 + "-5 度まで下がった".length });
  });

  it("resolves nested markers such as '> - '", () => {
    const r = resolveAnchorInBlocks(blocks, {
      heading_path: [],
      snippet: "> - 特になし。",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 70, to: 70 + "特になし。".length });
  });

  it("prefers an exact match over the stripped form", () => {
    // A block whose text genuinely starts with "1. " must win against a later
    // block matching only after stripping, so real content is never skipped.
    const withLiteral: AnchorBlock[] = [
      { start: 1, end: 10, text: "1. リテラルな行", headingStack: [], lineGroup: 0 },
      { start: 20, end: 30, text: "リテラルな行", headingStack: [], lineGroup: 1 },
    ];
    const r = resolveAnchorInBlocks(withLiteral, {
      heading_path: [],
      snippet: "1. リテラルな行",
      occurrence: 0,
    });
    expect(r).toEqual({ from: 1, to: 1 + "1. リテラルな行".length });
  });

  it("still returns null when the text is genuinely gone", () => {
    expect(
      resolveAnchorInBlocks(blocks, {
        heading_path: [],
        snippet: "1. 本文から消えた行",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("refuses to guess when the stripped form is ambiguous", () => {
    // "1. 同じ文" and "2. 同じ文" both strip to "同じ文". The occurrence on a
    // marker-prefixed snippet was counted against raw Markdown lines, where
    // "2. 同じ文" appears once — so occurrence 0 means the *second* item. The
    // stripped set numbers them differently, so committing to an index here
    // would point at a confidently wrong line. Orphan is the honest answer.
    const dup: AnchorBlock[] = [
      { start: 1, end: 10, text: "同じ文", headingStack: ["## A"], lineGroup: 0 },
      { start: 20, end: 30, text: "同じ文", headingStack: ["## A"], lineGroup: 1 },
    ];
    expect(
      resolveAnchorInBlocks(dup, {
        heading_path: ["## A"],
        snippet: "2. 同じ文",
        occurrence: 0,
      })
    ).toBeNull();
  });

  it("keeps exact matching in charge of occurrence", () => {
    // When the snippet matches literally, the fallback must not run at all and
    // occurrence must still select the nth match.
    const dup: AnchorBlock[] = [
      { start: 1, end: 10, text: "- 生き残った記号付きの行", headingStack: [], lineGroup: 0 },
      { start: 20, end: 30, text: "- 生き残った記号付きの行", headingStack: [], lineGroup: 1 },
    ];
    expect(
      resolveAnchorInBlocks(dup, {
        heading_path: [],
        snippet: "- 生き残った記号付きの行",
        occurrence: 1,
      })
    ).toEqual({ from: 20, to: 20 + "- 生き残った記号付きの行".length });
  });

  it("authoring counts only exact matches for occurrence", () => {
    // computeAnchorInBlocks sees ProseMirror block text, which never carries a
    // marker; counting stripped matches would inflate occurrence past what the
    // exact-match resolve path counts back.
    const dup: AnchorBlock[] = [
      { start: 1, end: 10, text: "2. マーカー付きの行", headingStack: [], lineGroup: 0 },
      { start: 20, end: 30, text: "マーカー付きの行", headingStack: [], lineGroup: 1 },
    ];
    const anchor = computeAnchorInBlocks(dup, 1, "マーカー付きの行");
    // Block 0's text contains "マーカー付きの行" literally, so it counts.
    expect(anchor.occurrence).toBe(1);
    expect(resolveAnchorInBlocks(dup, anchor)).toEqual({
      from: 20,
      to: 20 + "マーカー付きの行".length,
    });
  });
});

// #163 / #164: the frontend must anchor at Markdown-*line* granularity, not
// ProseMirror-*textblock* granularity, or occurrence disagrees with the
// backend's per-line scan (internal/reviewstore/comments.go ResolveAnchor).
// A fenced code block is one PM textblock spanning N Markdown lines (#163);
// a table row is N PM textblocks (one per cell) spanning one Markdown line
// (#164). `lineGroup` on AnchorBlock closes that gap: units from the same
// Markdown line share a `lineGroup`, and occurrence counts groups, not units.
describe("extractAnchorBlocks / occurrence at Markdown-line granularity (#163 / #164)", () => {
  let editor: Editor | null = null;

  // Table extensions mirror the production editor (TiptapEditor.tsx) so the
  // node type names ("table" / "tableRow" / "tableCell") match what
  // extractAnchorBlocks checks against.
  function makeEditor(content: string | JSONContent): Editor {
    editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
      ],
      content,
    });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function codeBlockDoc(lines: string[]) {
    return {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: lines.length ? [{ type: "text", text: lines.join("\n") }] : [],
        },
      ],
    };
  }

  function tableDoc(rows: string[][]) {
    return {
      type: "doc",
      content: [
        {
          type: "table",
          content: rows.map((cells) => ({
            type: "tableRow",
            content: cells.map((cell) => ({
              type: "tableCell",
              content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : [] }],
            })),
          })),
        },
      ],
    };
  }

  // A1: a 3-line code block becomes 3 units, none carrying a literal newline,
  // each with a distinct lineGroup.
  it("A1: splits a fenced code block into one unit per line", () => {
    const ed = makeEditor(codeBlockDoc(["const a = 1;", "const b = 2;", "return a + b;"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.text)).toEqual([
      "const a = 1;",
      "const b = 2;",
      "return a + b;",
    ]);
    for (const b of blocks) expect(b.text).not.toContain("\n");
    const groups = blocks.map((b) => b.lineGroup);
    expect(new Set(groups).size).toBe(3);
  });

  // A2: each line unit's start/end must address exactly that line's text in
  // the live document (position math check).
  it("A2: each code-block line unit's start/end addresses that line's text", () => {
    const ed = makeEditor(codeBlockDoc(["const a = 1;", "const b = 2;", "return a + b;"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    for (const b of blocks) {
      expect(ed.state.doc.textBetween(b.start, b.end)).toBe(b.text);
    }
  });

  // A3: a 2x2 table — same row shares lineGroup, different rows differ.
  it("A3: table cells in the same row share a lineGroup; different rows differ", () => {
    const ed = makeEditor(
      tableDoc([
        ["a", "b"],
        ["c", "d"],
      ])
    );
    const blocks = extractAnchorBlocks(ed.state.doc);
    const byText = (t: string) => blocks.find((b) => b.text === t)!;
    expect(byText("a").lineGroup).toBe(byText("b").lineGroup);
    expect(byText("c").lineGroup).toBe(byText("d").lineGroup);
    expect(byText("a").lineGroup).not.toBe(byText("c").lineGroup);
  });

  // A4: plain paragraphs/headings/list items keep one unit per textblock and
  // every lineGroup distinct — unchanged from pre-#163 behavior.
  it("A4: plain textblocks keep one unit per block with distinct lineGroups (back-compat)", () => {
    const ed = makeEditor(
      "<h2>Section</h2><p>alpha</p><ul><li><p>item one</p></li><li><p>item two</p></li></ul>"
    );
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks.map((b) => b.text)).toEqual(["Section", "alpha", "item one", "item two"]);
    expect(new Set(blocks.map((b) => b.lineGroup)).size).toBe(blocks.length);
  });

  // A5: a blank line inside a code block still consumes its own unit /
  // lineGroup, so line numbering does not drift.
  it("A5: a blank code-block line still consumes a unit and lineGroup", () => {
    const ed = makeEditor(codeBlockDoc(["first", "", "third"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.text)).toEqual(["first", "", "third"]);
    expect(new Set(blocks.map((b) => b.lineGroup)).size).toBe(3);
  });

  // B1: "| x | x |" — a 1-row table with two identical cells. Anchoring from
  // the second cell must not see the first cell's match as a distinct
  // occurrence: they share a lineGroup.
  it("B1: computeAnchorInBlocks does not count a same-lineGroup match as a separate occurrence", () => {
    const ed = makeEditor(tableDoc([["x", "x"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const secondCellIndex = blocks.map((b) => b.text).lastIndexOf("x");
    const anchor = computeAnchorInBlocks(blocks, secondCellIndex, "x");
    expect(anchor.occurrence).toBe(0);
  });

  // B2: the same string in two different table rows *does* count as two
  // occurrences (different lineGroups).
  it("B2: computeAnchorInBlocks counts matches in a different lineGroup as separate occurrences", () => {
    const ed = makeEditor(tableDoc([["x"], ["x"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const secondRowIndex = blocks.map((b) => b.text).lastIndexOf("x");
    const anchor = computeAnchorInBlocks(blocks, secondRowIndex, "x");
    expect(anchor.occurrence).toBe(1);
  });

  // B3: resolving the B1 anchor must not orphan — it resolves to the first
  // cell in the row that matches (the documented same-row/same-text limit).
  it("B3: resolveAnchorInBlocks resolves the B1 anchor to the row's first matching cell", () => {
    const ed = makeEditor(tableDoc([["x", "x"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const first = blocks[0];
    const r = resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "x", occurrence: 0 });
    expect(r).not.toBeNull();
    expect(r).toEqual({ from: first.start, to: first.start + 1 });
  });

  // B4: a repeated line inside a single code block — occurrence 1 resolves
  // to the second occurrence of that line (distinct lineGroups, unchanged
  // per-unit counting).
  it("B4: resolves the second occurrence of a repeated code-block line", () => {
    const ed = makeEditor(codeBlockDoc(["dup", "other", "dup"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const r = resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "dup", occurrence: 1 });
    const secondDup = blocks[2];
    expect(r).toEqual({ from: secondDup.start, to: secondDup.start + "dup".length });
  });

  // B5: three plain paragraphs sharing the same text — occurrence 0/1/2 map
  // to each block in order, matching pre-#163 behavior.
  it("B5: plain-paragraph occurrence counting is unchanged (back-compat)", () => {
    const ed = makeEditor("<p>dup</p><p>dup</p><p>dup</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    for (let i = 0; i < 3; i++) {
      const r = resolveAnchorInBlocks(blocks, { heading_path: [], snippet: "dup", occurrence: i });
      expect(r).toEqual({ from: blocks[i].start, to: blocks[i].start + "dup".length });
    }
  });

  // C1: selecting a code block's first two lines yields two anchors, neither
  // carrying a literal newline (the #163 repro case).
  it("C1: selecting two code-block lines yields two newline-free anchors", () => {
    const ed = makeEditor(codeBlockDoc(["line one", "line two", "line three"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    for (const a of anchors) expect(a.snippet).not.toContain("\n");
    expect(anchors.map((a) => a.snippet)).toEqual(["line one", "line two"]);
  });

  // C2: selecting the whole 3-line code block yields three anchors.
  it("C2: selecting an entire code block yields one anchor per line", () => {
    const ed = makeEditor(codeBlockDoc(["line one", "line two", "line three"]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[2].start + blocks[2].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(3);
    expect(anchors.map((a) => a.snippet)).toEqual(["line one", "line two", "line three"]);
  });

  // C3: a selection spanning from a preceding paragraph's line end into a
  // code block's first line only yields the code-block side (the paragraph
  // side trims to empty and is skipped, per #162's A3 rule) — the surviving
  // anchor is newline-free.
  it("C3: a selection crossing into a code block only yields the non-empty code-block side", () => {
    const ed = new Editor({
      extensions: [StarterKit.configure({ link: false })],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "intro" }] },
          {
            type: "codeBlock",
            content: [{ type: "text", text: "line one\nline two" }],
          },
        ],
      },
    });
    try {
      const blocks = extractAnchorBlocks(ed.state.doc);
      const paragraphEnd = blocks[0].start + blocks[0].text.length;
      const firstLine = blocks.find((b) => b.text === "line one")!;
      const to = firstLine.start + "line".length; // partway into the first line only
      const anchors = computeAnchorsFromSelection(ed.state.doc, paragraphEnd, to);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].snippet).toBe("line");
      for (const a of anchors) expect(a.snippet).not.toContain("\n");
    } finally {
      ed.destroy();
    }
  });

  // C4: selecting two cells in the same table row yields two anchors, both
  // occurrence 0 (same lineGroup).
  it("C4: selecting two same-row cells yields two anchors both at occurrence 0", () => {
    const ed = makeEditor(tableDoc([["a", "b"]]));
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.snippet)).toEqual(["a", "b"]);
    expect(anchors.every((a) => a.occurrence === 0)).toBe(true);
  });

  // C5: selecting across two paragraphs still yields two anchors (#162
  // behavior preserved by this change).
  it("C5: selecting across two paragraphs still yields two anchors (#162 preserved)", () => {
    const ed = makeEditor("<p>first para</p><p>second para</p>");
    const blocks = extractAnchorBlocks(ed.state.doc);
    const from = blocks[0].start;
    const to = blocks[1].start + blocks[1].text.length;
    const anchors = computeAnchorsFromSelection(ed.state.doc, from, to);
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => a.snippet)).toEqual(["first para", "second para"]);
  });
});
