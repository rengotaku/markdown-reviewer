import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  resolveAnchorInBlocks,
  computeAnchorInBlocks,
  computeAnchorAtBlock,
  computeAnchorFromSelection,
  blockIndexAtPos,
  extractAnchorBlocks,
  resolveAnchorInDoc,
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
  { start: 1, end: 5, text: "認証", headingStack: ["# 認証"] },
  {
    start: 7,
    end: 18,
    text: "トークンの期限",
    headingStack: ["# 認証", "## トークンの期限"],
  },
  {
    start: 20,
    end: 40,
    text: "アクセストークン: 24 時間",
    headingStack: ["# 認証", "## トークンの期限"],
  },
  { start: 42, end: 48, text: "エラー", headingStack: ["# 認証", "## エラー"] },
  {
    start: 50,
    end: 70,
    text: "24 時間 という別の出現",
    headingStack: ["# 認証", "## エラー"],
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
      { start: 1, end: 5, text: "H", headingStack: ["## H"] },
      { start: 7, end: 10, text: "x y", headingStack: ["## H"] },
      { start: 12, end: 15, text: "x z", headingStack: ["## H"] },
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
    const blank: AnchorBlock[] = [{ start: 1, end: 3, text: "   ", headingStack: [] }];
    expect(computeAnchorAtBlock(blank, 0)).toBeNull();
  });
});

// The ProseMirror adapters (extractAnchorBlocks / resolveAnchorInDoc /
// computeAnchorFromSelection) run against a real headless TipTap editor, since
// their whole job is walking the live document tree.
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

  it("computeAnchorFromSelection round-trips through resolveAnchorInDoc", () => {
    const ed = makeEditor(CONTENT);
    // Locate "24 時間" in the トークンの期限 paragraph and anchor that selection.
    const target = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## トークンの期限"],
      snippet: "24 時間",
      occurrence: 0,
    })!;
    const anchor = computeAnchorFromSelection(ed.state.doc, target.from, target.to);
    expect(anchor).toEqual({
      heading_path: ["# 認証", "## トークンの期限"],
      snippet: "24 時間",
      occurrence: 0,
    });
    expect(resolveAnchorInDoc(ed.state.doc, anchor!)).toEqual(target);
  });

  it("computeAnchorFromSelection clamps a multi-block selection to the first block", () => {
    const ed = makeEditor(CONTENT);
    const start = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## トークンの期限"],
      snippet: "アクセストークン",
      occurrence: 0,
    })!;
    // Extend the selection well past the block's end: the snippet must stay
    // within the starting block (single markdown line).
    const anchor = computeAnchorFromSelection(ed.state.doc, start.from, start.from + 500);
    expect(anchor).not.toBeNull();
    expect(anchor!.snippet).toBe("アクセストークン: 24 時間");
  });

  it("computeAnchorFromSelection returns null for a whitespace-only selection", () => {
    const ed = makeEditor("<p>a b</p>");
    // Position 2..3 is the single space between "a" and "b".
    const anchor = computeAnchorFromSelection(ed.state.doc, 2, 3);
    expect(anchor).toBeNull();
  });
});
