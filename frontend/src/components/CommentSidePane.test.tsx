import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { useState } from "react";
import { render, screen, within, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentDetailDialog, CommentSidePane } from "./CommentSidePane";
import type { CommentJSON } from "@/api";

// #304 removed the plain list layout: every anchored comment now renders
// through the paragraph-aligned rail (commentRailLayout.ts), which measures
// the pane's own box via getBoundingClientRect. jsdom never lays anything
// out, so that always reads 0×0 — without this stub only a single card would
// ever be `visible` (see the layout's own "isFirstVisible" shrink-to-fit
// branch), silently dropping every fixture after the first regardless of
// what the test is actually about. A generously tall pane keeps this file's
// many action tests (reply/edit/resolve/detail) about those actions, not
// about rail placement arithmetic (which commentRailLayout.test.ts already
// covers on its own).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 300,
    bottom: 4000,
    width: 300,
    height: 4000,
    x: 0,
    y: 0,
    toJSON() {},
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const comment = (id: string, overrides: Partial<CommentJSON> = {}): CommentJSON => ({
  id,
  scope: "inline",
  author: "alice",
  date: "2026-05-20",
  body: `body of ${id}`,
  status: "open",
  anchor: { heading_path: ["## Sec"], snippet: "text", occurrence: 0 },
  context: { heading_path: ["## Sec"], line_range: [3, 3] },
  orphan: false,
  ...overrides,
});

/** A comment with no live anchor (#309: rendered at the top of the document
 *  body, not in this pane — used here only to assert it stays out of the
 *  rail). */
const pinned = (id: string, overrides: Partial<CommentJSON> = {}): CommentJSON =>
  comment(id, { scope: "global", context: null, anchor: undefined, ...overrides });

function renderPane(props: Partial<React.ComponentProps<typeof CommentSidePane>> = {}) {
  const handlers = {
    onRefresh: vi.fn(),
    onAddComment: vi.fn(),
    onAddGlobal: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
    onJump: vi.fn(),
    onSelect: vi.fn(),
  };
  // #306: an anchored comment absent from `anchorTops` is now excluded from
  // the rail (no more 0-fallback) — most tests in this file exercise a
  // CommentCard's actions (reply/edit/resolve/detail) and don't care where in
  // the rail it lands, so give every anchored fixture a synthetic
  // measurement here unless the test supplies its own `anchorTops` (the rail
  // (#298)/(#306) describe blocks below always do, to control layout
  // directly).
  const comments = props.comments ?? [];
  const defaultAnchorTops = Object.fromEntries(
    comments
      .filter((c) => c.scope !== "global" && !c.orphan)
      .map((c, i) => [c.id, i * 10])
  );
  render(
    <CommentSidePane
      root="works"
      filePath="doc.md"
      comments={[]}
      reviewActive
      canAddComment
      {...handlers}
      anchorTops={defaultAnchorTops}
      {...props}
    />
  );
  return handlers;
}

/** #364: the "対象: ..." label now renders only in the detail dialog. */
function renderDetail(c: CommentJSON) {
  render(
    <CommentDetailDialog
      comment={c}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onResolveToggle={vi.fn()}
      onReply={vi.fn()}
      onEdit={vi.fn()}
      onEditReply={vi.fn()}
      onDeleteReply={vi.fn()}
      onJump={vi.fn()}
      onCopyLink={vi.fn()}
    />
  );
}

describe("CommentSidePane", () => {
  it("shows each comment's id so a person can match it to what the AI reported (#286)", async () => {
    renderPane({ comments: [comment("c-001"), comment("c-002")] });
    // The rail measures its own box via rAF (commentRailLayout.ts) before it
    // can place a second card — the very first render still has last frame's
    // (here: none) measurement.
    const rows = await waitFor(() => {
      const items = screen.getAllByTestId("comment-item");
      expect(items).toHaveLength(2);
      return items;
    });
    expect(within(rows[0]).getByTestId("comment-id")).toHaveTextContent("c-001");
    expect(within(rows[1]).getByTestId("comment-id")).toHaveTextContent("c-002");
  });

  it("shows a not-under-review message but keeps the add toolbar clickable to prompt ingest", async () => {
    const user = userEvent.setup();
    const handlers = renderPane({ reviewActive: false });
    expect(screen.getByText(/まだレビュー対象ではありません/)).toBeInTheDocument();
    // The buttons stay enabled so the click reaches the parent, which shows the
    // "取り込む" prompt instead of silently doing nothing.
    expect(screen.getByTestId("editor-add-comment")).not.toBeDisabled();
    expect(screen.getByTestId("editor-add-global-comment")).not.toBeDisabled();
    await user.click(screen.getByTestId("editor-add-comment"));
    expect(handlers.onAddComment).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("editor-add-global-comment"));
    expect(handlers.onAddGlobal).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when under review with no comments", () => {
    renderPane();
    expect(screen.getByText(/コメントはまだありません/)).toBeInTheDocument();
    expect(screen.getByText("Comments (0/0)")).toBeInTheDocument();
  });

  it("renders each comment with body, context, scope badge", async () => {
    renderPane({
      comments: [
        comment("c1", { body: "first" }),
        comment("c2", { scope: "block", body: "second" }),
      ],
    });
    expect(screen.getByText("Comments (2/2)")).toBeInTheDocument();
    // The rail measures its own box via rAF before it can place a second
    // card (see the file's first test).
    await waitFor(() => expect(screen.getAllByTestId("comment-item")).toHaveLength(2));
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-inline")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-block")).toBeInTheDocument();
  });

  it("shows short bodies in full with no toggle", () => {
    renderPane({ comments: [comment("c1", { body: "short" })] });
    expect(screen.getByTestId("comment-body")).toHaveTextContent("short");
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  // #147: CollapsibleText switched from character-slicing the plain-text
  // preview to always rendering the full Markdown source and CSS-clamping
  // the container's height instead (truncating the raw source would break
  // mid-syntax, e.g. a table or fence). These two tests were updated in
  // place to match that intentional behavior change — the toggle's
  // data-testid/label contract (comment-body-toggle, 続きを表示/折りたたむ)
  // is unchanged, only the "is the text sliced" assertion is gone. The
  // `data-collapsed` attribute is a test hook for the CSS-clamp state.
  it("keeps the full body rendered (no source slicing) and toggles the clamp state", async () => {
    const user = userEvent.setup();
    const long = "あ".repeat(250);
    renderPane({ comments: [comment("c1", { body: long })] });

    const body = screen.getByTestId("comment-body");
    // Full source is always present in the DOM — only visually clamped.
    expect(body.textContent).toContain("あ".repeat(250));
    expect(body).toHaveAttribute("data-collapsed", "true");

    const toggle = screen.getByTestId("comment-body-toggle");
    expect(toggle).toHaveTextContent("続きを表示");

    await user.click(toggle);
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("comment-body-toggle")).toHaveTextContent("折りたたむ");

    await user.click(screen.getByTestId("comment-body-toggle"));
    expect(screen.getByTestId("comment-body-toggle")).toHaveTextContent("続きを表示");
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "true");
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("comment-pane-refresh"));
    expect(h.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("filters the list by status via the toggle", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        comment("c1", { status: "open" }),
        comment("c2", { status: "resolved" }),
      ],
    });
    // 未解決 by default (#253)
    expect(screen.getAllByTestId("comment-item")).toHaveLength(1);
    await user.click(screen.getByTestId("comment-filter-all"));
    await waitFor(() => expect(screen.getAllByTestId("comment-item")).toHaveLength(2));
    await user.click(screen.getByTestId("comment-filter-resolved"));
    let items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-comment-id", "c2");
    await user.click(screen.getByTestId("comment-filter-open"));
    items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-comment-id", "c1");
  });

  it("selects an anchored comment when its row is clicked", async () => {
    // The row is the whole target now: the editor scrolls to the comment and
    // opens its thread beside the text (#253).
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-item"));
    expect(h.onSelect).toHaveBeenCalledWith("c1");
  });

  it("marks the row whose thread is open", async () => {
    renderPane({ comments: [comment("c1"), comment("c2")], selectedId: "c2" });
    const [first, second] = await waitFor(() => {
      const items = screen.getAllByTestId("comment-item");
      expect(items).toHaveLength(2);
      return items;
    });
    expect(first).toHaveAttribute("data-selected", "false");
    expect(second).toHaveAttribute("data-selected", "true");
  });

  it("copying a link from a row does not open its thread", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    await user.click(screen.getByTestId("comment-copy-link"));
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  // #316: global-scope and orphan comments no longer get a card in this
  // pane's rail — they surface only via the badge row above it.
  it("never renders global or orphan comments as rail cards; only the anchored one appears", () => {
    renderPane({
      comments: [
        comment("c1"),
        pinned("g1"),
        comment("o1", { orphan: true, context: null }),
      ],
    });
    expect(screen.queryByTestId("comment-pinned-section")).toBeNull();
    const items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByTestId("comment-id")).toHaveTextContent("c1");
  });

  describe("global/orphan badges (#316)", () => {
    it("shows only the global badge when there are global comments and no orphans", () => {
      renderPane({ comments: [pinned("g1"), pinned("g2")] });
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent("全体 2");
      expect(screen.queryByTestId("orphan-comment-badge")).toBeNull();
    });

    // #328: the server resolves anchors against the raw markdown lines and the
    // editor against the rendered document, so the server can report
    // `orphan: false` for a comment the editor cannot place. Before the fix
    // such a comment stayed in the anchored set with no measurement — no
    // card, no badge, no above/below count — while the header kept counting
    // it, so it simply disappeared.
    it("counts a caller-unresolvable comment as 位置不明 even though the server says it is anchored", async () => {
      const user = userEvent.setup();
      renderPane({
        anchorTops: { c1: 10 },
        unresolvedIds: new Set(["u1"]),
        comments: [
          comment("c1"),
          comment("u1", { orphan: false, body: "表の行にアンカーしたコメント" }),
        ],
      });
      expect(screen.getByTestId("orphan-comment-badge")).toHaveTextContent("位置不明 1");
      // and it stays out of the rail — it has no position to be placed at
      const rail = screen.getByTestId("comment-rail-aligned");
      expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
      expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");
      // the thread is reachable from the badge, so the comment is readable
      await user.click(screen.getByTestId("orphan-comment-badge"));
      expect(screen.getByText("表の行にアンカーしたコメント")).toBeInTheDocument();
    });

    it("adds up: rail + 全体 + 位置不明 covers every comment the header counts", () => {
      renderPane({
        anchorTops: { c1: 10 },
        unresolvedIds: new Set(["u1"]),
        comments: [
          comment("c1"),
          comment("u1"),
          pinned("g1"),
          comment("o1", { orphan: true, context: null }),
        ],
      });
      expect(screen.getByTestId("comment-filter-all")).toHaveTextContent("すべて 4");
      const rail = screen.getByTestId("comment-rail-aligned");
      expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent("全体 1");
      // o1 (server orphan) + u1 (caller could not resolve it)
      expect(screen.getByTestId("orphan-comment-badge")).toHaveTextContent("位置不明 2");
    });

    it("renders no badges when there are no global or orphan comments", () => {
      renderPane({ comments: [comment("c1")] });
      expect(screen.queryByTestId("global-comment-badges")).toBeNull();
    });

    it("opens the dialog with the comment body when a badge is pressed", async () => {
      const user = userEvent.setup();
      renderPane({ comments: [pinned("g1", { body: "global body" })] });
      await user.click(screen.getByTestId("global-comment-badge"));
      expect(screen.getByTestId("global-comments-dialog")).toBeInTheDocument();
      expect(screen.getByText("global body")).toBeInTheDocument();
    });

    describe("a comment_id link to a comment with no live anchor (#226)", () => {
      const noop = () => {};
      const paneWith = (
        comments: CommentJSON[],
        selectedId: string | null,
        unresolvedIds: ReadonlySet<string> = new Set()
      ) => (
        <CommentSidePane
          root="works"
          filePath="doc.md"
          comments={comments}
          reviewActive
          canAddComment
          onRefresh={noop}
          onAddComment={noop}
          onAddGlobal={noop}
          onDelete={noop}
          onResolveToggle={noop}
          onReply={noop}
          onEdit={noop}
          onEditReply={noop}
          onDeleteReply={noop}
          onJump={noop}
          onSelect={noop}
          selectedId={selectedId}
          unresolvedIds={unresolvedIds}
        />
      );
      const selectedRow = () =>
        within(screen.getByTestId("global-comments-dialog"))
          .getAllByTestId("comment-item")
          .find((el) => el.dataset.selected === "true");

      it("opens the dialog on the global tab with the row marked", () => {
        const comments = [
          pinned("g1"),
          pinned("g2"),
          comment("o1", { orphan: true, context: null }),
        ];
        const { rerender } = render(paneWith(comments, null));
        expect(screen.queryByTestId("global-comments-dialog")).toBeNull();
        rerender(paneWith(comments, "g2"));
        expect(screen.getByTestId("global-comments-tab-global")).toHaveAttribute(
          "aria-selected",
          "true"
        );
        expect(selectedRow()?.dataset.commentId).toBe("g2");
        // Marked in words too, not by the background colour alone.
        expect(
          within(selectedRow()!).getByTestId("comment-linked-badge")
        ).toHaveTextContent("リンク先");
        expect(screen.getAllByTestId("comment-linked-badge")).toHaveLength(1);
      });

      it("opens once the caller finds an anchored comment unresolvable after the selection", () => {
        // The server says anchored (orphan: false); the editor can't place it,
        // and says so a frame after the link selected it.
        const comments = [comment("u1")];
        const { rerender } = render(paneWith(comments, null));
        rerender(paneWith(comments, "u1"));
        expect(screen.queryByTestId("global-comments-dialog")).toBeNull();
        rerender(paneWith(comments, "u1", new Set(["u1"])));
        expect(selectedRow()?.dataset.commentId).toBe("u1");
      });

      it("opens the orphan tab for an orphan comment", () => {
        const comments = [pinned("g1"), comment("o1", { orphan: true, context: null })];
        const { rerender } = render(paneWith(comments, null));
        rerender(paneWith(comments, "o1"));
        expect(screen.getByTestId("global-comments-tab-orphan")).toHaveAttribute(
          "aria-selected",
          "true"
        );
        expect(selectedRow()?.dataset.commentId).toBe("o1");
      });

      it("widens the status filter so a resolved global comment is there to mark", () => {
        const comments = [pinned("g1", { status: "resolved" })];
        const { rerender } = render(paneWith(comments, null));
        rerender(paneWith(comments, "g1"));
        expect(selectedRow()?.dataset.commentId).toBe("g1");
      });

      it("leaves the dialog closed for an anchored comment", () => {
        const comments = [comment("c1"), pinned("g1")];
        const { rerender } = render(paneWith(comments, null));
        rerender(paneWith(comments, "c1"));
        expect(screen.queryByTestId("global-comments-dialog")).toBeNull();
      });
    });

    it("shows tabs only when both global and orphan comments exist", async () => {
      const user = userEvent.setup();
      renderPane({
        comments: [pinned("g1"), comment("o1", { orphan: true, context: null })],
      });
      await user.click(screen.getByTestId("global-comment-badge"));
      expect(screen.getByTestId("global-comments-tab-global")).toBeInTheDocument();
      expect(screen.getByTestId("global-comments-tab-orphan")).toBeInTheDocument();
    });

    it("replying inside the dialog calls onReply with the id and body", async () => {
      const user = userEvent.setup();
      const h = renderPane({ comments: [pinned("g1")] });
      await user.click(screen.getByTestId("global-comment-badge"));
      await user.click(screen.getByTestId("comment-reply-toggle"));
      await user.type(screen.getByTestId("comment-reply-input"), "hello");
      await user.click(screen.getByTestId("comment-reply-submit"));
      expect(h.onReply).toHaveBeenCalledWith("g1", "hello");
    });

    it("follows the status filter: switching to resolved only counts resolved global/orphan comments", async () => {
      const user = userEvent.setup();
      renderPane({
        comments: [
          pinned("g1", { status: "open" }),
          pinned("g2", { status: "resolved" }),
        ],
      });
      // Default filter is 未解決 (open).
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent("全体 1");
      await user.click(screen.getByTestId("comment-filter-resolved"));
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent("全体 1");
      await user.click(screen.getByTestId("comment-filter-all"));
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent("全体 2");
    });
  });

  it("invokes the add-comment callbacks from the toolbar", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("editor-add-comment"));
    await user.click(screen.getByTestId("editor-add-global-comment"));
    expect(h.onAddComment).toHaveBeenCalled();
    expect(h.onAddGlobal).toHaveBeenCalled();
  });

  it("labels a multi-anchor (cross-section) comment with its heading names", () => {
    renderDetail(
      comment("c1", {
        scope: "cross_section",
        anchor: undefined,
        // #162 made buildCommentJSON resolve a context from `anchors` too,
        // so a real cross_section response now carries one. The heading
        // list must still win — that is what the scope is about.
        context: { heading_path: ["# 認証", "## トークン"], line_range: [3, 20] },
        anchors: [
          { heading_path: ["# 認証", "## トークン"], snippet: "s1", occurrence: 0 },
          { heading_path: ["# 認証", "## エラー"], snippet: "s2", occurrence: 0 },
        ],
      })
    );
    expect(screen.getByTestId("comment-detail-context-c1")).toHaveTextContent(
      "対象: ## トークン ・ ## エラー"
    );
  });

  it("keeps the heading + line range for a multi-line inline comment that also carries anchors", () => {
    // #162: an inline comment spanning several blocks stores the trailing
    // blocks in `anchors`, but its resolved `context.line_range` already
    // covers all of them — so the label must stay "見出し (L74–L80)" rather
    // than degrading to a list of repeated heading names.
    renderDetail(
      comment("c1", {
        scope: "inline",
        anchor: { heading_path: ["## 実績"], snippet: "s1", occurrence: 0 },
        anchors: [{ heading_path: ["## 実績"], snippet: "s2", occurrence: 0 }],
        context: { heading_path: ["## 実績"], line_range: [74, 80] },
      })
    );
    expect(screen.getByTestId("comment-detail-context-c1")).toHaveTextContent(
      "対象: ## 実績 (L74–80)"
    );
  });

  it("falls back to the anchor snippet when no live context is resolved", () => {
    renderDetail(
      comment("c1", {
        context: null,
        anchor: { heading_path: [], snippet: "生スニペット", occurrence: 0 },
      })
    );
    expect(screen.getByTestId("comment-detail-context-c1")).toHaveTextContent(
      "対象: 生スニペット"
    );
  });

  // --- #147: Markdown rendering + header redesign (pre-designed spec A/B,
  // see issue brief). Do not delete/rename/loosen these assertions. ---

  it("B1: renders a bold comment body as <strong>, with no literal ** left", () => {
    renderPane({ comments: [comment("c1", { body: "**強調**" })] });
    const body = screen.getByTestId("comment-body");
    expect(body.querySelector("strong")).not.toBeNull();
    expect(body.textContent).not.toContain("**");
  });

  it("B2: renders a GFM table inside the comment body", () => {
    const tableBody = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    renderPane({ comments: [comment("c1", { body: tableBody })] });
    const body = screen.getByTestId("comment-body");
    expect(body.querySelector("table")).not.toBeNull();
  });

  it("B4: keeps a table intact (not truncated mid-syntax) in a long, collapsed body, and the toggle still works", async () => {
    const user = userEvent.setup();
    const tableMd = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
    const padding = "x".repeat(220);
    renderPane({ comments: [comment("c1", { body: `${padding}\n\n${tableMd}` })] });

    const body = screen.getByTestId("comment-body");
    expect(body).toHaveAttribute("data-collapsed", "true");
    expect(body.querySelector("table")).not.toBeNull();

    const toggle = screen.getByTestId("comment-body-toggle");
    expect(toggle).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("comment-body-toggle")).toHaveTextContent("折りたたむ");
  });

  it("B5: shows no toggle for a body at/under the preview limit (regression guard)", () => {
    renderPane({ comments: [comment("c1", { body: "x".repeat(200) })] });
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  // #330: a source under BODY_PREVIEW_LIMIT that still wraps taller than the
  // rail card's clamp must collapse too. jsdom lays nothing out, so stub the
  // two measurements useClampOverflow reads: the body's scrollHeight and the
  // px height of the probe it sizes to the clamp (`3em`).
  function stubRenderedHeight(bodyScrollHeight: number) {
    const clampPx = 42;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const h = this.style.height === "3em" ? clampPx : 4000;
      return {
        top: 0,
        left: 0,
        right: 300,
        bottom: h,
        width: 300,
        height: h,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
      this: HTMLElement
    ) {
      return this.dataset.testid === "comment-body" ? bodyScrollHeight : 0;
    });
    // setup.ts's no-op observer never calls back; a real one fires once on
    // observe(), which is when the hook takes its first measurement.
    class ImmediateResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe() {
        this.cb([], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    // setup.ts defines the global writable but not configurable, so assign
    // (vi.stubGlobal would redefine it) and put the original back after.
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      ImmediateResizeObserver as unknown as typeof ResizeObserver;
    onTestFinished(() => {
      globalThis.ResizeObserver = original;
    });
  }

  it("#330: collapses a short source whose rendered body is taller than the card's clamp", async () => {
    stubRenderedHeight(140);
    renderPane({ comments: [comment("c1", { body: "あ".repeat(130) })] });
    await waitFor(() =>
      expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "true")
    );
    expect(screen.getByTestId("comment-body-toggle")).toHaveTextContent("続きを表示");
  });

  it("#330: leaves a short source that fits within the clamp uncollapsed, with no toggle", async () => {
    stubRenderedHeight(40);
    renderPane({ comments: [comment("c1", { body: "あ".repeat(20) })] });
    // Let the ResizeObserver/effect measurement run before asserting absence.
    await act(async () => {});
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  it("#148: a long source that renders within the clamp gets no toggle", async () => {
    stubRenderedHeight(40);
    const body = `[短い表示名](https://example.com/${"a".repeat(300)})`;
    renderPane({ comments: [comment("c1", { body })] });
    await act(async () => {});
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  it("#148: links below the clamp leave the tab order while collapsed, and return on expand", async () => {
    const user = userEvent.setup();
    stubRenderedHeight(400);
    // Clamp edge at 42px: the first link sits inside it, the second below.
    const rect = (top: number, height: number) =>
      ({
        top,
        left: 0,
        right: 300,
        bottom: top + height,
        width: 300,
        height,
        x: 0,
        y: top,
        toJSON() {},
      }) as DOMRect;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.style.height === "3em") return rect(0, 42);
      if (this.dataset.testid === "comment-body") return rect(0, 42);
      if (this.textContent === "見えるリンク") return rect(10, 16);
      if (this.textContent === "隠れるリンク") return rect(120, 16);
      return rect(0, 4000);
    });
    const body =
      "[見えるリンク](https://a.example)\n\n本文\n\n本文\n\n[隠れるリンク](https://b.example)";
    renderPane({ comments: [comment("c1", { body })] });
    await waitFor(() =>
      expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "true")
    );
    expect(screen.getByText("見えるリンク")).not.toHaveAttribute("tabindex");
    expect(screen.getByText("見えるリンク")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByText("隠れるリンク")).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("隠れるリンク")).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByTestId("comment-body-toggle"));
    expect(screen.getByText("隠れるリンク")).not.toHaveAttribute("tabindex");
    expect(screen.getByText("隠れるリンク")).not.toHaveAttribute("aria-hidden");
  });

  it("#330: a rail card's body is clamped from first paint, before any measurement lands", () => {
    // setup.ts's no-op ResizeObserver never calls back — the state a card is
    // in when the rail's own card observer reports its height first. If the
    // body were unclamped here, that full height would place (or drop) the
    // card, and a dropped card never re-measures.
    renderPane({ comments: [comment("c1", { body: "あ".repeat(130) })] });
    const body = screen.getByTestId("comment-body");
    expect(getComputedStyle(body).maxHeight).toBe("3em");
    // Not known to overflow yet: no fade/toggle claim.
    expect(body).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  it("#330: pressing a card's 続きを表示 (click or keyboard) expands it without selecting the card", async () => {
    // Selecting would drop the toggle (the selected card shows its body in
    // full), pulling the pressed button out from under the pointer/focus.
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1", { body: "あ".repeat(250) })] });

    await user.click(screen.getByTestId("comment-body-toggle"));
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "false");

    screen.getByTestId("comment-body-toggle").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("comment-body-toggle")).toHaveFocus();

    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it("#330: the selected card shows its body in full with no toggle, even past the preview limit", async () => {
    stubRenderedHeight(400);
    renderPane({
      comments: [comment("c1", { body: "あ".repeat(250) })],
      selectedId: "c1",
    });
    await act(async () => {});
    expect(screen.getByTestId("comment-body")).toHaveAttribute("data-collapsed", "false");
    expect(screen.queryByTestId("comment-body-toggle")).toBeNull();
  });

  it("ケース 1: リンクコピー: 一覧行", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderPane({
      root: "code",
      filePath: "foo.md",
      comments: [comment("c-001")],
    });

    const copyBtn = screen.getByTestId("comment-copy-link");
    await user.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const copiedUrl = writeTextMock.mock.calls[0][0];
    expect(copiedUrl).toContain("/code/foo.md");
    expect(copiedUrl).toContain("comment_id=c-001");

    vi.unstubAllGlobals();
  });
});

// #298: the pane's paragraph-aligned rail layout — the only layout the pane
// renders since #304 removed the plain list mode (and the toggle between the
// two).
describe("CommentSidePane rail (#298)", () => {
  it("12. keeps global/orphan comments out of the rail entirely — they render at the top of the document body, not in this pane (#309)", () => {
    renderPane({
      anchorTops: { c1: 10 },
      comments: [
        comment("c1"),
        pinned("g1"),
        comment("o1", { orphan: true, context: null }),
      ],
    });
    expect(screen.queryByTestId("comment-pinned-section")).toBeNull();
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");
  });

  it("puts the rail back at scrollTop 0 when the browser scrolls it to show a caret (#378)", () => {
    renderPane({ anchorTops: { c1: 10 }, comments: [comment("c1")] });
    const rail = screen.getByTestId("comment-rail-aligned");
    rail.scrollTop = 40;
    fireEvent.scroll(rail);
    expect(rail.scrollTop).toBe(0);
  });

  it("renders anchored comments inside the aligned rail container", () => {
    renderPane({
      anchorTops: { c1: 10, c2: 20 },
      comments: [comment("c1"), comment("c2")],
    });
    expect(screen.getByTestId("comment-rail-aligned")).toBeInTheDocument();
  });

  it("a card past the pane's bottom stays mounted but hidden, with no 上に / 下に N 件 count (#338)", async () => {
    // The pane stub is 4000px tall from top 0, so c2's anchor at 100_000 sits
    // far below it. It used to be dropped behind 下に 1 件; now every card is
    // placed and the body is scrolled to reach it.
    renderPane({
      anchorTops: { c1: 0, c2: 100_000 },
      comments: [comment("c1"), comment("c2")],
    });
    const rail = screen.getByTestId("comment-rail-aligned");
    await waitFor(() => {
      const cards = within(rail).getAllByTestId("comment-rail-card");
      expect(cards.map((c) => c.dataset.commentId)).toEqual(["c1", "c2"]);
      expect(cards[0]).toBeVisible();
      expect(cards[1]).not.toBeVisible();
    });
    expect(screen.queryByTestId("comment-rail-below")).toBeNull();
    expect(screen.queryByTestId("comment-rail-above")).toBeNull();
  });

  it("reports how far the rail reaches past the document's end, and 0 once nothing overhangs (#338)", async () => {
    const onRailOverhangChange = vi.fn();
    const props = {
      anchorTops: { c1: 400 },
      comments: [comment("c1")],
      onRailOverhangChange,
    };
    const { rerender } = render(
      <CommentSidePane
        root="works"
        filePath="doc.md"
        reviewActive
        canAddComment
        onRefresh={vi.fn()}
        onAddComment={vi.fn()}
        onAddGlobal={vi.fn()}
        onDelete={vi.fn()}
        onResolveToggle={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onEditReply={vi.fn()}
        onDeleteReply={vi.fn()}
        onJump={vi.fn()}
        onSelect={vi.fn()}
        docBox={{ top: 0, bottom: 420, scrollTop: 0 }}
        {...props}
      />
    );
    // The card starts at the document's last line (400) and runs past its end
    // (420) by its own height (no ResizeObserver in jsdom, so the 96px
    // placeholder) plus the gap: 400 + 96 + 8 - 420 = 84.
    await waitFor(() => expect(onRailOverhangChange).toHaveBeenLastCalledWith(84));
    rerender(
      <CommentSidePane
        root="works"
        filePath="doc.md"
        reviewActive
        canAddComment
        onRefresh={vi.fn()}
        onAddComment={vi.fn()}
        onAddGlobal={vi.fn()}
        onDelete={vi.fn()}
        onResolveToggle={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onEditReply={vi.fn()}
        onDeleteReply={vi.fn()}
        onJump={vi.fn()}
        onSelect={vi.fn()}
        docBox={{ top: 0, bottom: 2000, scrollTop: 0 }}
        {...props}
      />
    );
    await waitFor(() => expect(onRailOverhangChange).toHaveBeenLastCalledWith(0));
  });
});

describe("CommentSidePane rail anchor measurement (#306)", () => {
  // #306 case 1: an anchored comment with no entry in `anchorTops` yet (the
  // caller hasn't measured its decoration's DOM position this render pass)
  // must not fall back to viewport top 0 — that used to plant its card at
  // the rail's very top, in front of whichever paragraph the reader is
  // actually looking at, and it stayed there because nothing re-triggers a
  // measurement on its own. Case 1 requires it simply stays out of the rail
  // until a real measurement lands.
  it("1. an anchored comment missing from anchorTops is not drawn in the rail (no 0-fallback)", async () => {
    renderPane({
      // c1 has a real measurement; c2 does not (key entirely absent, not
      // just falsy) — the exact shape recomputeAnchorTops produces before
      // its first successful pass over c2's decoration.
      anchorTops: { c1: 10 },
      comments: [comment("c1"), comment("c2")],
    });
    // The rail's own box is measured asynchronously (rAF, in
    // AlignedCommentRail's scheduleMeasurePane) against this file's 4000px
    // getBoundingClientRect stub. Flushing that rAF here rules out a false
    // pass: at the pre-measurement paneHeight===0, a second card overflows
    // the (zero-height) pane and is dropped to `belowCount` regardless of
    // whether the 0-fallback bug is fixed — that path would pass this
    // assertion even with the bug present. A 4000px pane comfortably fits
    // both c1 and a wrongly-defaulted c2, so this only stays green once c2
    // is genuinely excluded for having no anchorTops entry.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const rail = screen.getByTestId("comment-rail-aligned");
    const items = within(rail).getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");
  });

  // #326: a resolved comment used to be the one exception to case 1 — it kept
  // a `?? 0` fallback, on the reasoning that it paints no decoration and so
  // could never be measured. The caller now measures resolved comments from
  // their anchors instead, so the exception is gone and a missing entry means
  // the same "not measured yet" it means for an open comment. Without the
  // fix, every resolved card lands at viewport top 0 — stacked on each other
  // at the rail's head, detached from the paragraphs they point at.
  it("3. a resolved comment missing from anchorTops is not drawn at the rail's top either (#326)", async () => {
    const user = userEvent.setup();
    renderPane({
      anchorTops: { c1: 10 },
      comments: [comment("c1"), comment("r1", { status: "resolved" })],
    });
    // The pane defaults to 未解決 (#253); r1 is only reachable via すべて.
    await user.click(screen.getByTestId("comment-filter-all"));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");
  });

  // #326 positive control: once the caller *does* measure a resolved comment,
  // its card sits at that measurement like any other — the removal above is
  // not "resolved comments never render".
  it("4. a resolved comment with a measurement is drawn in the rail (#326)", async () => {
    const user = userEvent.setup();
    renderPane({
      anchorTops: { r1: 10 },
      comments: [comment("r1", { status: "resolved" })],
    });
    await user.click(screen.getByTestId("comment-filter-resolved"));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("r1");
  });

  // #306 case 2: this must not be confused with case 1. A comment with no
  // anchor at all (global scope, or orphaned) is a different, permanent
  // state — it never renders in this pane at all (#309: moved to the top of
  // the document body), regardless of anchorTops.
  it("2. a comment with no anchor (global/orphan) never renders in this pane, regardless of anchorTops", () => {
    renderPane({
      // Neither g1 nor o1 ever gets an anchorTops entry — there's no
      // decoration to measure — while c1 does.
      anchorTops: { c1: 10 },
      comments: [
        comment("c1"),
        pinned("g1"),
        comment("o1", { orphan: true, context: null }),
      ],
    });
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");
    expect(screen.queryByTestId("comment-pinned-section")).toBeNull();
  });
});

describe("CommentSidePane rail card selection (#308)", () => {
  // #304 stripped the popover (CommentThreadPopover) without moving its
  // actions into the rail card, so an anchored comment could be read but
  // never replied to or resolved from the UI. These cases restore that only
  // for the selected card — an unselected card must stay exactly as low as
  // before (#298's whole point), so cases 1-2 pin down the "still nothing
  // extra" side before 3-6 pin down what selection adds.

  it("1. a non-selected card offers reply / resolve / detail in its header, but no reply input, edit, or delete (#364)", () => {
    renderPane({ comments: [comment("c1")] });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByTestId("comment-reply-toggle")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-resolve-toggle")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-open-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
    expect(screen.queryByTestId("comment-edit")).toBeNull();
    expect(screen.queryByTestId("comment-delete")).toBeNull();
  });

  it("2. a non-selected card previews its latest two replies and counts the rest (#364)", () => {
    renderPane({
      comments: [
        comment("c1", {
          replies: [
            { author: "ai", date: "2026-05-20", body: "first reply" },
            { author: "reviewer", date: "2026-05-21", body: "second\nreply" },
            { author: "ai", date: "2026-05-22", body: "third reply" },
          ],
        }),
      ],
    });
    const rows = screen.getAllByTestId("comment-reply-preview-row");
    expect(rows.map((r) => r.textContent)).toEqual(["Rsecond reply", "AIthird reply"]);
    expect(screen.getByTestId("comment-reply-rest")).toHaveTextContent("ほか 1 件");
    expect(screen.queryByText("first reply")).toBeNull();
    expect(screen.queryByTestId("comment-reply-body")).toBeNull();
  });

  it("2a. a badge-only author stays readable by screen readers (#364)", () => {
    renderPane({
      comments: [
        comment("c1", {
          author: "kishira",
          replies: [{ author: "ai", date: "2026-05-21", body: "only reply" }],
        }),
      ],
    });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByRole("img", { name: "kishira" })).toBeInTheDocument();
    expect(within(item).getByRole("img", { name: "ai" })).toBeInTheDocument();
  });

  it("2d. a selected card's comment sits under the same bar as its replies, with no dates in the pane (#364)", () => {
    renderPane({
      comments: [
        comment("c1", {
          author: "kishira",
          date: "2026-05-20T10:00:00+09:00",
          replies: [
            { author: "ai", date: "2026-05-21T10:00:00+09:00", body: "reply body" },
          ],
        }),
      ],
      selectedId: "c1",
    });
    const item = screen.getByTestId("comment-item");
    const main = within(item).getByTestId("comment-main-header");
    expect(within(main).getByRole("img", { name: "kishira" })).toBeInTheDocument();
    expect(within(main).getByTestId("comment-edit")).toBeInTheDocument();
    expect(within(main).getByTestId("comment-delete")).toBeInTheDocument();
    expect(
      within(within(item).getByTestId("comment-reply-header")).getByRole("img", {
        name: "ai",
      })
    ).toBeInTheDocument();
    expect(item.textContent).not.toContain("2026-05-2");
  });

  it("2e. the ∨ / ∧ toggle opens a closed card and closes the open one (#364)", async () => {
    const user = userEvent.setup();
    const onDeselect = vi.fn();
    const h = renderPane({
      comments: [comment("c1"), comment("c2")],
      selectedId: "c1",
      onDeselect,
    });
    const [open, closed] = screen.getAllByTestId("comment-item");
    const openToggle = within(open).getByTestId("comment-toggle");
    const closedToggle = within(closed).getByTestId("comment-toggle");
    expect(openToggle).toHaveAttribute("aria-expanded", "true");
    expect(closedToggle).toHaveAttribute("aria-expanded", "false");

    await user.click(openToggle);
    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(h.onSelect).not.toHaveBeenCalled();

    await user.click(closedToggle);
    expect(h.onSelect).toHaveBeenCalledWith("c2");
  });

  it("2b. with two or fewer replies the preview shows them all and no rest count (#364)", () => {
    renderPane({
      comments: [
        comment("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "only reply" }],
        }),
      ],
    });
    expect(screen.getAllByTestId("comment-reply-preview-row")).toHaveLength(1);
    expect(screen.queryByTestId("comment-reply-rest")).toBeNull();
  });

  it("2c. a non-selected card's header buttons act without needing the card opened first (#364)", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")] });
    const item = screen.getByTestId("comment-item");

    await user.click(within(item).getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
    expect(h.onSelect).not.toHaveBeenCalled();

    await user.click(within(item).getByTestId("comment-reply-toggle"));
    expect(h.onSelect).toHaveBeenCalledWith("c1");
  });

  it("3. selecting a card reveals its operation row (reply, resolve, edit, delete, open detail)", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [comment("c1")], selectedId: "c1" });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByTestId("comment-reply-toggle")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-resolve-toggle")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-edit")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-delete")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-open-detail")).toBeInTheDocument();
    await user.click(within(item).getByTestId("comment-reply-toggle"));
    expect(within(item).getByTestId("comment-reply-input")).toBeInTheDocument();
  });

  it("4. selecting a card with replies renders the reply bodies, not just the count", () => {
    renderPane({
      comments: [
        comment("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "reply body" }],
        }),
      ],
      selectedId: "c1",
    });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByText("reply body")).toBeInTheDocument();
    expect(within(item).queryByTestId("comment-reply-count")).toBeNull();
  });

  it("5. moving selection to another card closes the previous card's operation row and reply body", async () => {
    const { rerender } = render(
      <CommentSidePane
        root="works"
        filePath="doc.md"
        comments={[comment("c1"), comment("c2")]}
        reviewActive
        canAddComment
        onRefresh={vi.fn()}
        onAddComment={vi.fn()}
        onAddGlobal={vi.fn()}
        onDelete={vi.fn()}
        onResolveToggle={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onEditReply={vi.fn()}
        onDeleteReply={vi.fn()}
        onJump={vi.fn()}
        onSelect={vi.fn()}
        selectedId="c1"
        anchorTops={{ c1: 0, c2: 10 }}
      />
    );
    const [first] = await waitFor(() => {
      const items = screen.getAllByTestId("comment-item");
      expect(items).toHaveLength(2);
      return items;
    });
    expect(within(first).getByTestId("comment-resolve-toggle")).toBeInTheDocument();

    rerender(
      <CommentSidePane
        root="works"
        filePath="doc.md"
        comments={[comment("c1"), comment("c2")]}
        reviewActive
        canAddComment
        onRefresh={vi.fn()}
        onAddComment={vi.fn()}
        onAddGlobal={vi.fn()}
        onDelete={vi.fn()}
        onResolveToggle={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onEditReply={vi.fn()}
        onDeleteReply={vi.fn()}
        onJump={vi.fn()}
        onSelect={vi.fn()}
        selectedId="c2"
        anchorTops={{ c1: 0, c2: 10 }}
      />
    );
    const [firstAfter, secondAfter] = await waitFor(() => {
      const items = screen.getAllByTestId("comment-item");
      expect(items).toHaveLength(2);
      return items;
    });
    expect(within(firstAfter).queryByTestId("comment-edit")).toBeNull();
    expect(within(secondAfter).getByTestId("comment-edit")).toBeInTheDocument();
  });

  it("6. replying and resolving from a selected card call onReply / onResolveToggle", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")], selectedId: "c1" });
    const item = screen.getByTestId("comment-item");
    await user.click(within(item).getByTestId("comment-reply-toggle"));
    await user.type(within(item).getByTestId("comment-reply-input"), "返信本文");
    await user.click(within(item).getByTestId("comment-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "返信本文");

    await user.click(within(item).getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("7. an ai-authored selected card's edit/delete stay disabled (comment and reply)", () => {
    renderPane({
      comments: [
        comment("c1", {
          author: "ai",
          replies: [{ author: "ai", date: "2026-05-20", body: "ai reply" }],
        }),
      ],
      selectedId: "c1",
    });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByTestId("comment-edit")).toBeDisabled();
    expect(within(item).getByTestId("comment-delete")).toBeDisabled();
    expect(within(item).getByTestId("comment-reply-edit")).toBeDisabled();
    expect(within(item).getByTestId("comment-reply-delete")).toBeDisabled();
  });
});

// #312: a non-selected card's context row (comment-context-*) is one of the
// remaining contributors to the ~138px height that pushed neighbouring cards
// down the rail (#298's anchor-aligned placement only holds when a card is
// shorter than the anchor spacing above it). Moving the context row behind
// selection — same treatment #304 already gave the operation row and full
// reply bodies — keeps it available on demand without costing every
// non-selected card its height.
describe("CommentSidePane rail card compact height (#312)", () => {
  it("1. a non-selected card renders no context row (comment-context-*)", () => {
    renderPane({ comments: [comment("c1")] });
    expect(screen.queryByTestId("comment-context-c1")).toBeNull();
  });

  it("2. a selected card renders no context row either; it lives in the detail dialog (#364)", () => {
    renderPane({ comments: [comment("c1")], selectedId: "c1" });
    expect(screen.queryByTestId("comment-context-c1")).toBeNull();
  });

  it("3. a non-selected card still shows the comment id and body (nothing else was removed)", () => {
    renderPane({ comments: [comment("c1", { body: "body of c1" })] });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByTestId("comment-id")).toHaveTextContent("c1");
    expect(within(item).getByTestId("comment-body")).toHaveTextContent("body of c1");
  });

  it("4. a selected card keeps #308's operation row and full reply bodies", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        comment("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "reply body" }],
        }),
      ],
      selectedId: "c1",
    });
    const item = screen.getByTestId("comment-item");
    expect(within(item).getByTestId("comment-reply-toggle")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-resolve-toggle")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-edit")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-delete")).toBeInTheDocument();
    expect(within(item).getByTestId("comment-open-detail")).toBeInTheDocument();
    expect(within(item).getByText("reply body")).toBeInTheDocument();
    expect(within(item).queryByTestId("comment-reply-count")).toBeNull();

    await user.click(within(item).getByTestId("comment-reply-toggle"));
    expect(within(item).getByTestId("comment-reply-input")).toBeInTheDocument();
  });
});

describe("CommentSidePane list mode (#333)", () => {
  it("renders no mode switch when the caller doesn't track a mode, and stays aligned", () => {
    renderPane({ comments: [comment("c1")] });
    expect(screen.queryByTestId("comment-rail-mode")).toBeNull();
    expect(screen.getByTestId("comment-rail-aligned")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-list")).toBeNull();
  });

  it("switching the mode reports the chosen mode to the caller", async () => {
    const user = userEvent.setup();
    const onRailModeChange = vi.fn();
    renderPane({ comments: [comment("c1")], railMode: "aligned", onRailModeChange });
    await user.click(screen.getByTestId("comment-rail-mode-list"));
    expect(onRailModeChange).toHaveBeenCalledWith("list");
  });

  it("lists every anchored card in document order, even ones the aligned rail could not fit or place", () => {
    // Anchors far apart / unmeasured: the aligned rail would push most of
    // these to 上に / 下に N 件 (or drop c3, which has no measurement at all).
    // The list shows all of them, with no overflow counts.
    renderPane({
      comments: [comment("c1"), comment("c2"), comment("c3"), pinned("g1")],
      anchorTops: { c1: 0, c2: 100_000 },
      railMode: "list",
      onRailModeChange: vi.fn(),
    });
    const list = screen.getByTestId("comment-list");
    expect(
      within(list)
        .getAllByTestId("comment-id")
        .map((el) => el.textContent)
    ).toEqual(["c1", "c2", "c3"]);
    expect(screen.queryByTestId("comment-rail-aligned")).toBeNull();
    expect(screen.queryByTestId("comment-rail-below")).toBeNull();
    expect(screen.queryByTestId("comment-rail-above")).toBeNull();
  });

  it("orders the list by position in the document, not by when each comment was added", () => {
    // Added bottom-first: the API returns c-late (line 40) before c-early (line 2).
    renderPane({
      comments: [
        comment("c-late", {
          context: { heading_path: ["## Sec"], line_range: [40, 40] },
        }),
        comment("c-early", { context: { heading_path: ["## Sec"], line_range: [2, 5] } }),
        comment("c-mid", { context: { heading_path: ["## Sec"], line_range: [20, 20] } }),
      ],
      railMode: "list",
      onRailModeChange: vi.fn(),
    });
    const list = screen.getByTestId("comment-list");
    expect(
      within(list)
        .getAllByTestId("comment-id")
        .map((el) => el.textContent)
    ).toEqual(["c-early", "c-mid", "c-late"]);
  });

  it("clicking a listed card selects it", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [comment("c1"), comment("c2")],
      railMode: "list",
      onRailModeChange: vi.fn(),
    });
    const items = within(screen.getByTestId("comment-list")).getAllByTestId(
      "comment-item"
    );
    await user.click(items[1]);
    expect(h.onSelect).toHaveBeenCalledWith("c2");
  });

  it("scrolls the selected card into view when the selection changes", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      // jsdom has no scrollIntoView of its own; don't leave the stub behind.
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    });
    renderPane({
      comments: [comment("c1"), comment("c2")],
      railMode: "list",
      onRailModeChange: vi.fn(),
      selectedId: "c2",
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toHaveAttribute("data-comment-id", "c2");
  });
});

describe("CommentSidePane icon mode (#332)", () => {
  it("shows one count icon per line instead of cards, with a mode switch button for it", async () => {
    renderPane({
      comments: [comment("c1"), comment("c2"), comment("c3")],
      anchorTops: { c1: 100, c2: 100, c3: 400 },
      railMode: "icons",
      onRailModeChange: vi.fn(),
    });
    expect(screen.getByTestId("comment-rail-mode-icons")).toBeInTheDocument();
    expect(screen.queryAllByTestId("comment-item")).toHaveLength(0);
    // The rail measures its own box via rAF before it can place a second
    // entry (see the file's first test).
    const icons = await waitFor(() => {
      const els = screen.getAllByTestId("comment-rail-icon");
      expect(els.map((el) => el.dataset.commentIds)).toEqual(["c1 c2", "c3"]);
      return els;
    });
    expect(icons[0]).toHaveTextContent("2");
    expect(icons[0]).toHaveAccessibleName("コメント 2 件を開く");
  });

  it("clicking an icon selects its first comment", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [comment("c1"), comment("c2")],
      anchorTops: { c1: 100, c2: 100 },
      railMode: "icons",
      onRailModeChange: vi.fn(),
    });
    await user.click(screen.getByTestId("comment-rail-icon"));
    expect(h.onSelect).toHaveBeenCalledWith("c1");
  });

  it("opens only the selected comment as a full card; the rest of its line stays an icon", async () => {
    renderPane({
      comments: [comment("c1"), comment("c2"), comment("c3")],
      anchorTops: { c1: 100, c2: 100, c3: 400 },
      railMode: "icons",
      onRailModeChange: vi.fn(),
      selectedId: "c1",
    });
    const cards = screen.getAllByTestId("comment-item");
    expect(cards.map((el) => el.dataset.commentId)).toEqual(["c1"]);
    expect(cards[0]).toHaveAttribute("data-selected", "true");
    await waitFor(() =>
      expect(
        screen.getAllByTestId("comment-rail-icon").map((el) => el.dataset.commentIds)
      ).toEqual(["c2", "c3"])
    );
  });

  it("an icon below the pane stays mounted but hidden, with no 下に N 件 count (#338)", async () => {
    // c2+c3 share a line far below the pane: one icon, two comments.
    renderPane({
      comments: [comment("c1"), comment("c2"), comment("c3")],
      anchorTops: { c1: 0, c2: 100_000, c3: 100_000 },
      railMode: "icons",
      onRailModeChange: vi.fn(),
    });
    await waitFor(() => {
      const icons = screen.getAllByTestId("comment-rail-icon");
      expect(icons.map((el) => el.dataset.commentIds)).toEqual(["c1", "c2 c3"]);
      expect(icons[1]).not.toBeVisible();
    });
    expect(screen.queryByTestId("comment-rail-below")).toBeNull();
  });

  /** Every element reports this pane height (the rail measures its own box). */
  function stubPaneHeight(height: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 300,
      bottom: height,
      width: 300,
      height,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect);
  }

  const noopHandlers = () => ({
    onRefresh: vi.fn(),
    onAddComment: vi.fn(),
    onAddGlobal: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
    onJump: vi.fn(),
    onRailModeChange: vi.fn(),
  });

  it("a selected card pushed past the pane's bottom pushes the icon after it down too (#338)", async () => {
    // a icon 180..208, b's card (96px default) pushed to 216..312 — past the
    // pane's bottom (300). It used to drop to 下に 1 件 while c's icon stayed
    // at 228, out of document order. Now b stays placed and c stacks below it.
    stubPaneHeight(300);
    renderPane({
      comments: [comment("a"), comment("b"), comment("c")],
      anchorTops: { a: 180, b: 204, c: 228 },
      railMode: "icons",
      onRailModeChange: vi.fn(),
      selectedId: "b",
    });
    await waitFor(() => {
      const card = screen.getByTestId("comment-rail-card");
      expect(card).toHaveAttribute("data-comment-id", "b");
      expect(card).toBeVisible();
      const icons = screen.getAllByTestId("comment-rail-icon");
      expect(icons.map((el) => el.dataset.commentIds)).toEqual(["a", "c"]);
      expect(icons[1]).not.toBeVisible();
    });
    expect(screen.queryByTestId("comment-rail-below")).toBeNull();
  });

  it("re-selecting a comment opens its card even if it was taller the last time it was open", async () => {
    // The card's first measurement was 320px (e.g. reply form open); its real
    // height now is 150px. Re-selecting must mount it and measure afresh.
    stubPaneHeight(500);
    const reported = [320];
    class ReportingResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        // Only the card's own content box reports a height; other observers
        // (the body's overflow check) get a callback with nothing to read.
        if (
          (el.parentElement as HTMLElement | null)?.dataset.testid !== "comment-rail-card"
        ) {
          this.cb([], this as unknown as ResizeObserver);
          return;
        }
        const height = reported.shift() ?? 150;
        this.cb(
          [{ contentRect: { height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      ReportingResizeObserver as unknown as typeof ResizeObserver;
    onTestFinished(() => {
      globalThis.ResizeObserver = original;
    });

    const props = {
      root: "works",
      filePath: "doc.md",
      comments: [comment("c1"), comment("c2")],
      reviewActive: true,
      canAddComment: true,
      onSelect: vi.fn(),
      anchorTops: { c1: 250, c2: 250 },
      railMode: "icons" as const,
      ...noopHandlers(),
    };
    const { rerender } = render(<CommentSidePane {...props} selectedId="c2" />);
    // Let the rail measure its own box (rAF); until then its height reads 0
    // and nothing past the first entry is placed.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(reported).toEqual([]); // c2's card mounted and was measured at 320
    rerender(<CommentSidePane {...props} selectedId="c1" />);
    rerender(<CommentSidePane {...props} selectedId="c2" />);
    await waitFor(() => {
      const cards = screen.getAllByTestId("comment-rail-card");
      expect(cards.map((el) => el.dataset.commentId)).toEqual(["c2"]);
      expect(cards[0]).toBeVisible();
    });
  });

  it("opening an icon from the keyboard moves focus to the opened card", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [selectedId, setSelectedId] = useState<string | null>(null);
      return (
        <CommentSidePane
          root="works"
          filePath="doc.md"
          comments={[comment("c1"), comment("c2")]}
          reviewActive
          canAddComment
          anchorTops={{ c1: 100, c2: 400 }}
          railMode="icons"
          selectedId={selectedId}
          onSelect={setSelectedId}
          {...noopHandlers()}
        />
      );
    }
    render(<Harness />);
    const icon = await waitFor(() => {
      const els = screen.getAllByTestId("comment-rail-icon");
      expect(els).toHaveLength(2);
      return els[0];
    });
    icon.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      const card = screen.getByTestId("comment-item");
      expect(card).toHaveAttribute("data-comment-id", "c1");
      expect(card).toHaveFocus();
    });
  });
});

describe("CommentSidePane drafts survive the card unmounting (#334)", () => {
  const baseProps = () => ({
    root: "works",
    filePath: "doc.md",
    reviewActive: true,
    canAddComment: true,
    onRefresh: vi.fn(),
    onAddComment: vi.fn(),
    onAddGlobal: vi.fn(),
    onDelete: vi.fn(),
    onResolveToggle: vi.fn(),
    onReply: vi.fn(),
    onEdit: vi.fn(),
    onEditReply: vi.fn(),
    onDeleteReply: vi.fn(),
    onJump: vi.fn(),
    onSelect: vi.fn(),
    onRailModeChange: vi.fn(),
  });

  /** #364: every card has a reply button now, so aim at the selected one. */
  function selectedCard(): HTMLElement {
    const card = screen
      .getAllByTestId("comment-item")
      .find((el) => el.dataset.selected === "true");
    if (!card) throw new Error("no selected card");
    return card;
  }

  async function startReply(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(within(selectedCard()).getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), text);
  }

  it("keeps a half-written reply when switching between the aligned rail and the list", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1")], selectedId: "c1" };
    const { rerender } = render(
      <CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="aligned" />
    );
    await startReply(user, "書きかけ");

    rerender(<CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="list" />);
    expect(screen.getByTestId("comment-list")).toBeInTheDocument();
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("書きかけ");

    rerender(<CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="aligned" />);
    expect(screen.getByTestId("comment-rail-aligned")).toBeInTheDocument();
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("書きかけ");
  });

  it("keeps a half-written edit when switching between the aligned rail and the list", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1")], selectedId: "c1" };
    const { rerender } = render(
      <CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="aligned" />
    );
    await user.click(screen.getByTestId("comment-edit"));
    await user.type(screen.getByTestId("comment-edit-input"), " 追記");

    rerender(<CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="list" />);
    expect(screen.getByTestId("comment-edit-input")).toHaveValue("body of c1 追記");
  });

  it("keeps a half-written reply while scrolling moves the card out of the pane and back (#338)", async () => {
    const user = userEvent.setup();
    const props = {
      ...baseProps(),
      comments: [comment("c0"), comment("c1")],
      selectedId: "c1",
      railMode: "aligned" as const,
    };
    const { rerender } = render(
      <CommentSidePane {...props} anchorTops={{ c0: 0, c1: 200 }} />
    );
    await waitFor(() => expect(selectedCard()).toBeInTheDocument());
    await startReply(user, "スクロール前");

    // Scrolled: c1's paragraph is now far below the pane. The card leaves the
    // visible range but stays mounted, form and all.
    rerender(<CommentSidePane {...props} anchorTops={{ c0: 0, c1: 100_000 }} />);
    await waitFor(() =>
      expect(screen.getByTestId("comment-reply-input")).not.toBeVisible()
    );
    expect(screen.queryByTestId("comment-rail-below")).toBeNull();

    rerender(<CommentSidePane {...props} anchorTops={{ c0: 0, c1: 200 }} />);
    await waitFor(() => expect(screen.getByTestId("comment-reply-input")).toBeVisible());
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("スクロール前");
  });

  it("keeps a half-written reply when icon mode folds the card back into an icon", async () => {
    const user = userEvent.setup();
    const props = {
      ...baseProps(),
      comments: [comment("c1"), comment("c2")],
      anchorTops: { c1: 100, c2: 400 },
      railMode: "icons" as const,
    };
    const { rerender } = render(<CommentSidePane {...props} selectedId="c1" />);
    await startReply(user, "アイコン前");

    rerender(<CommentSidePane {...props} selectedId="c2" />);
    await waitFor(() =>
      expect(screen.getByTestId("comment-item")).toHaveAttribute("data-comment-id", "c2")
    );
    // The other card's draft is its own: c2 opens with no reply form.
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();

    rerender(<CommentSidePane {...props} selectedId="c1" />);
    await waitFor(() =>
      expect(screen.getByTestId("comment-reply-input")).toHaveValue("アイコン前")
    );
  });

  it("clears the draft once the reply is sent", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1")], selectedId: "c1" };
    const { rerender } = render(
      <CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="aligned" />
    );
    await startReply(user, "送信する");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(props.onReply).toHaveBeenCalledWith("c1", "送信する");

    rerender(<CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="list" />);
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
    await user.click(screen.getByTestId("comment-reply-toggle"));
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("");
  });

  it("drops a deleted comment's draft so a new comment reusing its id starts clean", async () => {
    // reviewstore numbers a new comment max+1, so deleting the highest id and
    // adding again hands the same id to a different comment.
    const user = userEvent.setup();
    const props = { ...baseProps(), selectedId: "c1", anchorTops: { c1: 10 } };
    const { rerender } = render(
      <CommentSidePane {...props} comments={[comment("c1")]} />
    );
    await user.click(screen.getByTestId("comment-edit"));
    await user.type(screen.getByTestId("comment-edit-input"), " 旧");
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "旧い返信");

    rerender(<CommentSidePane {...props} comments={[]} />);
    rerender(
      <CommentSidePane
        {...props}
        comments={[comment("c1", { body: "新しいコメント" })]}
      />
    );
    expect(screen.queryByTestId("comment-edit-input")).toBeNull();
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
  });

  it("drops the draft as soon as the comment is deleted from this pane", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), selectedId: "c1", anchorTops: { c1: 10 } };
    const { rerender } = render(
      <CommentSidePane {...props} comments={[comment("c1")]} />
    );
    await startReply(user, "旧い返信");
    await user.click(screen.getByTestId("comment-delete"));
    expect(props.onDelete).toHaveBeenCalledWith("c1");

    // The refetch skipped the moment c1 was missing: delete + add landed in one.
    rerender(
      <CommentSidePane
        {...props}
        comments={[comment("c1", { body: "新しいコメント" })]}
      />
    );
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
  });

  it("a restored form does not take focus away from where the reader is typing", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1")], selectedId: "c1" };
    const { rerender } = render(
      <>
        <input data-testid="outside" />
        <CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="aligned" />
      </>
    );
    await startReply(user, "書きかけ");
    expect(screen.getByTestId("comment-reply-input")).toHaveFocus();
    await user.click(screen.getByTestId("outside"));

    rerender(
      <>
        <input data-testid="outside" />
        <CommentSidePane {...props} anchorTops={{ c1: 10 }} railMode="list" />
      </>
    );
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("書きかけ");
    expect(screen.getByTestId("outside")).toHaveFocus();
  });

  it("does not carry a draft over to a same-id comment in another file", async () => {
    const user = userEvent.setup();
    const props = {
      ...baseProps(),
      comments: [comment("c1")],
      selectedId: "c1",
      anchorTops: { c1: 10 },
      railMode: "aligned" as const,
    };
    const { rerender } = render(<CommentSidePane {...props} />);
    await startReply(user, "doc.md 向け");

    rerender(<CommentSidePane {...props} filePath="other.md" />);
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
  });
});

describe("CommentSidePane sent to AI (#366)", () => {
  const cardOf = (id: string) =>
    document.querySelector<HTMLElement>(
      `[data-testid="comment-item"][data-comment-id="${id}"]`
    )!;

  it("marks only the sent comments as being answered", () => {
    renderPane({
      comments: [comment("c1"), comment("c2")],
      agentReplying: true,
      agentSentIds: new Set(["c1"]),
    });
    expect(within(cardOf("c1")).getByTestId("comment-awaiting-ai")).toBeInTheDocument();
    expect(within(cardOf("c1")).queryByTestId("comment-unsent-to-ai")).toBeNull();
    expect(within(cardOf("c2")).getByTestId("comment-unsent-to-ai")).toBeInTheDocument();
    expect(within(cardOf("c2")).queryByTestId("comment-awaiting-ai")).toBeNull();
  });

  it("stops showing it on a comment the AI has answered (#372)", () => {
    renderPane({
      comments: [
        comment("c1", { replies: [{ author: "ai", body: "反映しました" }] }),
        comment("c2", {
          replies: [
            { author: "ai", body: "反映しました" },
            { author: "alice", body: "まだ違う" },
          ],
        }),
      ],
      agentReplying: true,
      agentSentIds: new Set(["c1", "c2"]),
    });
    expect(within(cardOf("c1")).queryByTestId("comment-awaiting-ai")).toBeNull();
    expect(within(cardOf("c2")).getByTestId("comment-awaiting-ai")).toBeInTheDocument();
  });

  it("shows neither once the AI is done", () => {
    renderPane({
      comments: [comment("c1"), comment("c2")],
      agentReplying: false,
      agentSentIds: new Set(["c1"]),
    });
    expect(screen.queryByTestId("comment-awaiting-ai")).toBeNull();
    expect(screen.queryByTestId("comment-unsent-to-ai")).toBeNull();
  });
});

describe("CommentSidePane opening a thread (#376)", () => {
  it("unfolds the last reply and leaves earlier ones folded", () => {
    const long = "あ".repeat(250);
    renderPane({
      comments: [
        comment("c1", {
          replies: [
            { author: "alice", body: long },
            { author: "ai", body: long },
          ],
        }),
      ],
      selectedId: "c1",
    });
    const bodies = screen.getAllByTestId("comment-reply-body");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveAttribute("data-collapsed", "true");
    expect(bodies[1]).toHaveAttribute("data-collapsed", "false");
  });

  it("closes the detail view once the comment is resolved", async () => {
    const user = userEvent.setup();
    const handlers = renderPane({ comments: [comment("c1")], selectedId: "c1" });
    await user.click(screen.getByRole("button", { name: "open comment detail" }));
    expect(screen.getByTestId("comment-detail-dialog")).toBeInTheDocument();

    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(handlers.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
    await waitFor(() => expect(screen.queryByTestId("comment-detail-dialog")).toBeNull());
  });

  it("keeps the detail view open when reopening", async () => {
    const user = userEvent.setup();
    const handlers = renderPane({
      comments: [comment("c1", { status: "resolved" })],
      selectedId: "c1",
    });
    await user.click(screen.getByTestId("comment-filter-all"));
    await user.click(screen.getByRole("button", { name: "open comment detail" }));
    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(handlers.onResolveToggle).toHaveBeenCalledWith("c1", "open");
    expect(screen.getByTestId("comment-detail-dialog")).toBeInTheDocument();
  });
});
