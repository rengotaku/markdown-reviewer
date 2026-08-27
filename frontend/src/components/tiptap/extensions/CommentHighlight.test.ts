import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  CommentHighlight,
  commentIdsInRange,
  type HighlightComment,
} from "./CommentHighlight";
import { resolveAnchorInDoc } from "@/utils/pmAnchor";

// Exercises the decoration plugin against a real (headless) editor: comments
// live outside the document, so highlights must appear as inline decorations
// in the rendered DOM without ever dirtying the doc.

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ link: false }), CommentHighlight],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const marks = (ed: Editor) =>
  Array.from(ed.view.dom.querySelectorAll(".comment-mark"));

const flashMarks = (ed: Editor) =>
  Array.from(ed.view.dom.querySelectorAll(".comment-flash"));

describe("CommentHighlight", () => {
  it("paints an inline decoration for a resolvable anchor", () => {
    const ed = makeEditor("<h2>認証</h2><p>アクセストークン: 24 時間</p>");
    const c: HighlightComment = {
      id: "c1",
      status: "open",
      anchor: { heading_path: ["## 認証"], snippet: "24 時間", occurrence: 0 },
    };
    ed.commands.setCommentHighlights([c]);
    const m = marks(ed);
    expect(m).toHaveLength(1);
    expect(m[0].getAttribute("data-comment-id")).toBe("c1");
    expect(m[0].textContent).toBe("24 時間");
    expect(m[0].classList.contains("comment-mark--resolved")).toBe(false);
  });

  it("paints no decoration for resolved comments", () => {
    const ed = makeEditor("<p>some target text</p>");
    ed.commands.setCommentHighlights([
      {
        id: "c1",
        status: "resolved",
        anchor: { heading_path: [], snippet: "target", occurrence: 0 },
      },
    ]);
    expect(marks(ed)).toHaveLength(0);
  });

  it("restores the highlight when a comment is reopened", () => {
    const ed = makeEditor("<p>some target text</p>");
    const anchor = { heading_path: [], snippet: "target", occurrence: 0 };
    // Resolved: no highlight.
    ed.commands.setCommentHighlights([{ id: "c1", status: "resolved", anchor }]);
    expect(marks(ed)).toHaveLength(0);
    // Reopened: highlight returns on the next push.
    ed.commands.setCommentHighlights([{ id: "c1", status: "open", anchor }]);
    const m = marks(ed);
    expect(m).toHaveLength(1);
    expect(m[0].getAttribute("data-comment-id")).toBe("c1");
  });

  it("paints one decoration per anchor for multi-anchor (cross-section) comments", () => {
    const ed = makeEditor("<h2>A</h2><p>first target</p><h2>B</h2><p>second target</p>");
    ed.commands.setCommentHighlights([
      {
        id: "cx",
        status: "open",
        anchors: [
          { heading_path: ["## A"], snippet: "first", occurrence: 0 },
          { heading_path: ["## B"], snippet: "second", occurrence: 0 },
        ],
      },
    ]);
    const m = marks(ed);
    expect(m).toHaveLength(2);
    expect(m.every((el) => el.getAttribute("data-comment-id") === "cx")).toBe(true);
  });

  // B1 (issue #162 regression): a comment carrying both `anchor` and
  // `anchors` — the multi-line inline anchoring shape — must paint a
  // decoration for every one of them. Before the fix, buildDeco used
  // `c.anchor ? [c.anchor] : (c.anchors ?? [])`, so the presence of `anchor`
  // silently discarded `anchors` and only 1 of the 3 decorations appeared.
  it("B1: paints a decoration for anchor plus every entry in anchors combined", () => {
    const ed = makeEditor(
      "<h2>A</h2><p>alpha target</p><h2>B</h2><p>bravo target</p><h2>C</h2><p>charlie target</p>"
    );
    ed.commands.setCommentHighlights([
      {
        id: "multi",
        status: "open",
        anchor: { heading_path: ["## A"], snippet: "alpha", occurrence: 0 },
        anchors: [
          { heading_path: ["## B"], snippet: "bravo", occurrence: 0 },
          { heading_path: ["## C"], snippet: "charlie", occurrence: 0 },
        ],
      },
    ]);
    const m = marks(ed);
    expect(m).toHaveLength(3);
    expect(m.every((el) => el.getAttribute("data-comment-id") === "multi")).toBe(true);
    expect(m.map((el) => el.textContent).sort()).toEqual(["alpha", "bravo", "charlie"]);
  });

  // B3: when one of the combined anchor(s) no longer resolves (orphaned),
  // the resolvable ones still paint — the whole comment must not vanish.
  it("B3: paints only the anchors that still resolve when one is orphaned", () => {
    const ed = makeEditor("<h2>A</h2><p>alpha target</p><h2>B</h2><p>bravo target</p>");
    ed.commands.setCommentHighlights([
      {
        id: "partial",
        status: "open",
        anchor: { heading_path: ["## A"], snippet: "alpha", occurrence: 0 },
        anchors: [{ heading_path: [], snippet: "こんな文字列は無い", occurrence: 0 }],
      },
    ]);
    const m = marks(ed);
    expect(m).toHaveLength(1);
    expect(m[0].textContent).toBe("alpha");
  });

  it("skips orphaned anchors that no longer resolve", () => {
    const ed = makeEditor("<p>current body</p>");
    ed.commands.setCommentHighlights([
      {
        id: "gone",
        status: "open",
        anchor: { heading_path: [], snippet: "vanished text", occurrence: 0 },
      },
    ]);
    expect(marks(ed)).toHaveLength(0);
  });

  it("replaces the highlight set on subsequent calls", () => {
    const ed = makeEditor("<p>alpha beta</p>");
    ed.commands.setCommentHighlights([
      { id: "c1", status: "open", anchor: { heading_path: [], snippet: "alpha", occurrence: 0 } },
    ]);
    expect(marks(ed)).toHaveLength(1);
    ed.commands.setCommentHighlights([]);
    expect(marks(ed)).toHaveLength(0);
  });

  it("re-resolves highlights when the document changes", () => {
    const ed = makeEditor("<p>alpha beta</p>");
    ed.commands.setCommentHighlights([
      { id: "c1", status: "open", anchor: { heading_path: [], snippet: "beta", occurrence: 0 } },
    ]);
    expect(marks(ed)[0].textContent).toBe("beta");

    // Insert text at the head of the paragraph: the decoration must follow the
    // snippet to its new position rather than staying at the stale offset.
    ed.commands.insertContentAt(1, "prefix ");
    const m = marks(ed);
    expect(m).toHaveLength(1);
    expect(m[0].textContent).toBe("beta");
  });

  it("does not mark the document dirty (doc unchanged by highlights)", () => {
    const ed = makeEditor("<p>alpha beta</p>");
    const before = ed.state.doc.toJSON();
    ed.commands.setCommentHighlights([
      { id: "c1", status: "open", anchor: { heading_path: [], snippet: "alpha", occurrence: 0 } },
    ]);
    expect(ed.state.doc.toJSON()).toEqual(before);
  });
});

// #167 B1–B4: flashCommentRanges paints a transient highlight independent of
// the persistent comment-mark set — the jump-to-comment fix uses this to
// flash a *resolved* comment's target, which has no comment-mark decoration.
describe("CommentHighlight flash decorations (#167)", () => {
  it("B1: flashCommentRanges paints an is-flash decoration over a given range", () => {
    const ed = makeEditor("<p>alpha beta gamma</p>");
    const range = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "alpha",
      occurrence: 0,
    });
    expect(range).not.toBeNull();
    ed.commands.flashCommentRanges([range!]);
    const flashes = flashMarks(ed);
    expect(flashes).toHaveLength(1);
    expect(flashes[0].classList.contains("is-flash")).toBe(true);
    expect(flashes[0].textContent).toBe("alpha");
  });

  it("B2: clearCommentFlash removes the transient decoration", () => {
    const ed = makeEditor("<p>alpha beta gamma</p>");
    const range = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "alpha",
      occurrence: 0,
    });
    ed.commands.flashCommentRanges([range!]);
    expect(flashMarks(ed)).toHaveLength(1);

    ed.commands.clearCommentFlash();
    expect(flashMarks(ed)).toHaveLength(0);
  });

  it("B3: flashing does not resurrect a resolved comment's persistent highlight (#96/#97)", () => {
    const ed = makeEditor("<p>some target text</p>");
    ed.commands.setCommentHighlights([
      {
        id: "c1",
        status: "resolved",
        anchor: { heading_path: [], snippet: "target", occurrence: 0 },
      },
    ]);
    expect(marks(ed)).toHaveLength(0);

    const range = resolveAnchorInDoc(ed.state.doc, {
      heading_path: [],
      snippet: "target",
      occurrence: 0,
    });
    ed.commands.flashCommentRanges([range!]);

    // The persistent comment-mark set for the resolved comment stays empty …
    expect(marks(ed)).toHaveLength(0);
    // … while the transient flash decoration is painted separately.
    expect(flashMarks(ed)).toHaveLength(1);
  });

  it("B4: flashCommentRanges paints one decoration per range for multi-anchor comments", () => {
    const ed = makeEditor("<h2>A</h2><p>first target</p><h2>B</h2><p>second target</p>");
    const r1 = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## A"],
      snippet: "first",
      occurrence: 0,
    });
    const r2 = resolveAnchorInDoc(ed.state.doc, {
      heading_path: ["## B"],
      snippet: "second",
      occurrence: 0,
    });
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    ed.commands.flashCommentRanges([r1!, r2!]);
    expect(flashMarks(ed)).toHaveLength(2);
  });
});

describe("commentIdsInRange (#238)", () => {
  it("returns the ids whose highlight overlaps the range", () => {
    const ed = makeEditor("<h2>認証</h2><p>アクセストークン: 24 時間</p>");
    ed.commands.setCommentHighlights([
      {
        id: "c1",
        status: "open",
        anchor: { heading_path: ["## 認証"], snippet: "24 時間", occurrence: 0 },
      },
    ]);
    const mark = marks(ed)[0];
    const pos = ed.view.posAtDOM(mark, 0);

    expect(commentIdsInRange(ed.state, pos, pos + 2)).toEqual(["c1"]);
    // The heading sits before the highlighted paragraph — no overlap there.
    expect(commentIdsInRange(ed.state, 1, 2)).toEqual([]);
  });

  it("orders overlapping comments innermost first", () => {
    const ed = makeEditor("<p>アクセストークンは 24 時間で失効する</p>");
    ed.commands.setCommentHighlights([
      {
        id: "outer",
        status: "open",
        anchor: {
          heading_path: [],
          snippet: "アクセストークンは 24 時間で失効する",
          occurrence: 0,
        },
      },
      {
        id: "inner",
        status: "open",
        anchor: { heading_path: [], snippet: "24 時間", occurrence: 0 },
      },
    ]);
    // Overlapping decorations are rendered as split spans whose merged
    // attributes keep only one id, so the position is taken from the doc
    // rather than the DOM: "24 時間" starts at 11 in "アクセストークンは 24 時間で失効する".
    expect(commentIdsInRange(ed.state, 11, 13)).toEqual(["inner", "outer"]);
  });

  it("lists a multi-anchor comment once", () => {
    const ed = makeEditor("<h2>A</h2><p>target</p><h2>B</h2><p>target</p>");
    ed.commands.setCommentHighlights([
      {
        id: "c-multi",
        status: "open",
        anchor: { heading_path: ["## A"], snippet: "target", occurrence: 0 },
        anchors: [{ heading_path: ["## B"], snippet: "target", occurrence: 0 }],
      },
    ]);
    expect(marks(ed)).toHaveLength(2);
    expect(commentIdsInRange(ed.state, 0, ed.state.doc.content.size)).toEqual([
      "c-multi",
    ]);
  });

  it("ignores resolved comments (they paint no highlight)", () => {
    const ed = makeEditor("<p>some target text</p>");
    ed.commands.setCommentHighlights([
      {
        id: "c1",
        status: "resolved",
        anchor: { heading_path: [], snippet: "target", occurrence: 0 },
      },
    ]);
    expect(commentIdsInRange(ed.state, 0, ed.state.doc.content.size)).toEqual([]);
  });
});
