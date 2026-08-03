import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CommentHighlight, type HighlightComment } from "./CommentHighlight";

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
