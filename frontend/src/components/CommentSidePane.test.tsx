import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentSidePane } from "./CommentSidePane";
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

/** A comment with no live anchor — the pane keeps these fully operable in its
 *  pinned section, so this is the fixture for reply / edit / resolve tests. */
const pinned = (id: string, overrides: Partial<CommentJSON> = {}): CommentJSON =>
  comment(id, { scope: "global", context: null, anchor: undefined, ...overrides });

/** The list shows unresolved comments by default (#253); resolved fixtures
 *  need the filter switched before they appear. */
async function showAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("comment-filter-all"));
  // Switching the filter can be what first brings a pinned (global/orphan)
  // comment into `visible` — it renders the pinned section (and its toggle)
  // for the first time collapsed (#304), same as at initial render.
  const toggle = screen.queryByTestId("comment-pinned-toggle");
  if (toggle && toggle.getAttribute("aria-expanded") === "false") {
    fireEvent.click(toggle);
  }
}

/**
 * `keepPinnedCollapsed`: the pinned section (全体・位置不明) always starts
 * collapsed (#304). Every test in this file except the ones about that
 * collapsed state itself uses `pinned()` purely as a fixture for exercising
 * the full reply/edit/resolve/detail row (CommentRow) — none of them are
 * about the collapse, so the default here expands it once up front rather
 * than making each of those tests click through the toggle first.
 */
function renderPane(
  props: Partial<React.ComponentProps<typeof CommentSidePane>> = {},
  { keepPinnedCollapsed = false }: { keepPinnedCollapsed?: boolean } = {}
) {
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
  // CommentRow's actions (reply/edit/resolve/detail) and don't care where in
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
  if (!keepPinnedCollapsed) {
    const toggle = screen.queryByTestId("comment-pinned-toggle");
    if (toggle) fireEvent.click(toggle);
  }
  return handlers;
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

  it("renders each comment with body, context, scope badge", () => {
    renderPane({
      comments: [
        comment("c1", { body: "first" }),
        comment("c2", {
          scope: "global",
          anchor: undefined,
          context: null,
          body: "second",
        }),
      ],
    });
    expect(screen.getByText("Comments (2/2)")).toBeInTheDocument();
    expect(screen.getAllByTestId("comment-item")).toHaveLength(2);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-inline")).toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-global")).toBeInTheDocument();
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

  it("clamps long replies individually with their own toggle, without slicing the source", async () => {
    const user = userEvent.setup();
    const longReply = "り".repeat(250);
    renderPane({
      comments: [
        pinned("c1", {
          body: "short",
          replies: [
            { author: "ai", date: "2026-05-21", body: "短い返信" },
            { author: "ai", date: "2026-05-21", body: longReply },
          ],
        }),
      ],
    });

    // Short reply: no toggle. Long reply: clamped + one toggle, full text
    // still present in the DOM.
    const replyBodies = screen.getAllByTestId("comment-reply-body");
    expect(replyBodies).toHaveLength(2);
    expect(replyBodies[0]).toHaveTextContent("短い返信");
    expect(replyBodies[1].textContent).toContain("り".repeat(250));
    expect(replyBodies[1]).toHaveAttribute("data-collapsed", "true");

    const toggle = screen.getByTestId("comment-reply-body-toggle");
    await user.click(toggle);
    const expanded = screen.getAllByTestId("comment-reply-body")[1];
    expect(expanded.textContent).toContain("り".repeat(250));
    expect(expanded).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByTestId("comment-reply-body-toggle")).toHaveTextContent("折りたたむ");
  });

  it("marks resolved and orphan comments", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        pinned("c1", { status: "resolved" }),
        pinned("c2", { orphan: true, context: null }),
      ],
    });
    await showAll(user);
    expect(screen.getByText("Comments (1/2)")).toBeInTheDocument();
    expect(screen.getByTestId("comment-status-resolved")).toBeInTheDocument();
    expect(screen.getByTestId("comment-orphan")).toBeInTheDocument();
  });

  it("calls onDelete / onResolveToggle for a comment", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-delete"));
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("disables reply and edit for a resolved comment", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [pinned("c1", { status: "resolved" })] });
    await showAll(user);
    expect(screen.getByTestId("comment-reply-toggle")).toBeDisabled();
    expect(screen.getByTestId("comment-edit")).toBeDisabled();
    // reopen + delete stay enabled
    expect(screen.getByTestId("comment-resolve-toggle")).toBeEnabled();
    expect(screen.getByTestId("comment-delete")).toBeEnabled();
  });

  it("disables edit/delete for an AI-authored comment but keeps reply/resolve enabled", () => {
    renderPane({ comments: [pinned("c1", { author: "ai", status: "open" })] });
    expect(screen.getByTestId("comment-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-delete")).toBeDisabled();
    expect(screen.getByTestId("comment-reply-toggle")).toBeEnabled();
    expect(screen.getByTestId("comment-resolve-toggle")).toBeEnabled();
  });

  it("keeps edit/delete enabled for a human-authored comment", () => {
    renderPane({ comments: [pinned("c1", { author: "reviewer", status: "open" })] });
    expect(screen.getByTestId("comment-edit")).toBeEnabled();
    expect(screen.getByTestId("comment-delete")).toBeEnabled();
  });

  it("disables edit/delete for an AI-authored reply but keeps human replies editable", () => {
    renderPane({
      comments: [
        pinned("c1", {
          replies: [
            { author: "ai", date: "2026-05-20", body: "ai reply" },
            { author: "reviewer", date: "2026-05-21", body: "human reply" },
          ],
        }),
      ],
    });
    const editButtons = screen.getAllByTestId("comment-reply-edit");
    const deleteButtons = screen.getAllByTestId("comment-reply-delete");
    expect(editButtons[0]).toBeDisabled();
    expect(deleteButtons[0]).toBeDisabled();
    expect(editButtons[1]).toBeEnabled();
    expect(deleteButtons[1]).toBeEnabled();
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("comment-pane-refresh"));
    expect(h.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("reopens a resolved comment via the toggle", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { status: "resolved" })] });
    await showAll(user);
    await user.click(screen.getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
  });

  it("edits a comment body", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "old body" })] });
    await user.click(screen.getByTestId("comment-edit"));
    const input = screen.getByTestId("comment-edit-input");
    await user.clear(input);
    await user.type(input, "new body");
    await user.click(screen.getByTestId("comment-edit-submit"));
    expect(h.onEdit).toHaveBeenCalledWith("c1", "new body");
  });

  it("submits a reply", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "返信です");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "返信です");
  });

  it("edits an individual reply by its index", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [
        pinned("c1", {
          replies: [
            { author: "reviewer", date: "2026-05-20", body: "reply0" },
            { author: "reviewer", date: "2026-05-21", body: "reply1" },
          ],
        }),
      ],
    });
    // Each reply has its own edit button; operate on the second one (index 1).
    const editButtons = screen.getAllByTestId("comment-reply-edit");
    expect(editButtons).toHaveLength(2);
    await user.click(editButtons[1]);
    const input = screen.getByTestId("comment-reply-edit-input");
    await user.clear(input);
    await user.type(input, "reply1-edited");
    await user.click(screen.getByTestId("comment-reply-edit-submit"));
    expect(h.onEditReply).toHaveBeenCalledWith("c1", 1, "reply1-edited");
  });

  it("deletes an individual reply by its index", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [
        pinned("c1", {
          replies: [
            { author: "reviewer", date: "2026-05-20", body: "reply0" },
            { author: "reviewer", date: "2026-05-21", body: "reply1" },
          ],
        }),
      ],
    });
    const deleteButtons = screen.getAllByTestId("comment-reply-delete");
    await user.click(deleteButtons[0]);
    expect(h.onDeleteReply).toHaveBeenCalledWith("c1", 0);
  });

  it("disables per-reply edit/delete for a resolved comment", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        pinned("c1", {
          status: "resolved",
          replies: [{ author: "ai", date: "2026-05-20", body: "reply0" }],
        }),
      ],
    });
    await showAll(user);
    expect(screen.getByTestId("comment-reply-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-reply-delete")).toBeDisabled();
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
    await showAll(user);
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

  it("shows the original anchored target for an orphaned comment", () => {
    renderPane({
      comments: [
        comment("c1", {
          orphan: true,
          context: null,
          anchor: {
            heading_path: ["## 認証"],
            snippet: "アクセストークン: 24 時間",
            occurrence: 0,
          },
        }),
      ],
    });
    const ctx = screen.getByTestId("comment-context-c1");
    expect(ctx).toHaveTextContent("## 認証 › アクセストークン: 24 時間");
    expect(ctx).toHaveTextContent("現在の本文には見つかりません");
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

  it("puts global and orphan comments in their own section", () => {
    renderPane({
      comments: [
        comment("c1"),
        pinned("g1"),
        comment("o1", { orphan: true, context: null }),
      ],
    });
    const section = screen.getByTestId("comment-pinned-section");
    expect(within(section).getAllByTestId("comment-item")).toHaveLength(2);
    expect(screen.getByText("全体・位置不明 2")).toBeInTheDocument();
  });

  it("invokes the add-comment callbacks from the toolbar", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("editor-add-comment"));
    await user.click(screen.getByTestId("editor-add-global-comment"));
    expect(h.onAddComment).toHaveBeenCalled();
    expect(h.onAddGlobal).toHaveBeenCalled();
  });

  it("opens a centered detail dialog and replies / resolves from it", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "detail body" })] });
    expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("comment-open-detail"));
    const dialog = screen.getByTestId("comment-detail-dialog");
    expect(within(dialog).getByText("detail body")).toBeInTheDocument();

    await user.type(screen.getByTestId("comment-detail-reply-input"), "見ました");
    await user.click(screen.getByTestId("comment-detail-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "見ました");

    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("resolved comment's detail dialog hides the reply input", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [pinned("c1", { status: "resolved" })] });
    await showAll(user);
    await user.click(screen.getByTestId("comment-open-detail"));
    expect(screen.getByTestId("comment-detail-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-detail-reply-input")).not.toBeInTheDocument();
  });

  it("labels a multi-anchor (cross-section) comment with its heading names", () => {
    renderPane({
      comments: [
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
        }),
      ],
      // #312: the context row only renders on the selected card now.
      selectedId: "c1",
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent(
      "対象: ## トークン ・ ## エラー"
    );
  });

  it("keeps the heading + line range for a multi-line inline comment that also carries anchors", () => {
    // #162: an inline comment spanning several blocks stores the trailing
    // blocks in `anchors`, but its resolved `context.line_range` already
    // covers all of them — so the label must stay "見出し (L74–L80)" rather
    // than degrading to a list of repeated heading names.
    renderPane({
      comments: [
        comment("c1", {
          scope: "inline",
          anchor: { heading_path: ["## 実績"], snippet: "s1", occurrence: 0 },
          anchors: [{ heading_path: ["## 実績"], snippet: "s2", occurrence: 0 }],
          context: { heading_path: ["## 実績"], line_range: [74, 80] },
        }),
      ],
      // #312: the context row only renders on the selected card now.
      selectedId: "c1",
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent(
      "対象: ## 実績 (L74–80)"
    );
  });

  it("falls back to the anchor snippet when no live context is resolved", () => {
    renderPane({
      comments: [
        comment("c1", {
          context: null,
          anchor: { heading_path: [], snippet: "生スニペット", occurrence: 0 },
        }),
      ],
      // #312: the context row only renders on the selected card now.
      selectedId: "c1",
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent("対象: 生スニペット");
  });

  it("shows original targets for an orphan with multiple anchors, without heading", () => {
    renderPane({
      comments: [
        comment("c1", {
          orphan: true,
          context: null,
          anchor: undefined,
          anchors: [
            { heading_path: ["## A"], snippet: "s1", occurrence: 0 },
            { heading_path: [], snippet: "s2", occurrence: 0 },
          ],
        }),
      ],
    });
    const ctx = screen.getByTestId("comment-context-c1");
    expect(ctx).toHaveTextContent("## A › s1 / s2");
    expect(ctx).toHaveTextContent("現在の本文には見つかりません");
  });

  it("lists the leading anchor too when a multi-line inline comment goes orphan", () => {
    // #162: the first selected block lives in `anchor`, the rest in `anchors`.
    // Taking `anchors` alone would hide the block the selection started on.
    renderPane({
      comments: [
        comment("c1", {
          scope: "inline",
          orphan: true,
          context: null,
          anchor: { heading_path: ["## 実績"], snippet: "先頭ブロック", occurrence: 0 },
          anchors: [{ heading_path: ["## 実績"], snippet: "後続ブロック", occurrence: 0 }],
        }),
      ],
    });
    const ctx = screen.getByTestId("comment-context-c1");
    expect(ctx).toHaveTextContent("## 実績 › 先頭ブロック / ## 実績 › 後続ブロック");
    expect(ctx).toHaveTextContent("現在の本文には見つかりません");
  });

  it("shows 位置不明 for an orphan without any stored anchor", () => {
    renderPane({
      comments: [comment("c1", { orphan: true, context: null, anchor: undefined })],
    });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent("位置不明 (orphan)");
  });

  it("cancels an inline edit without calling onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "original" })] });
    await user.click(screen.getByTestId("comment-edit"));
    await user.type(screen.getByTestId("comment-edit-input"), " extra");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-edit-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("comment-body")).toHaveTextContent("original");
  });

  it("submitting an unchanged edit just closes the editor without onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "same body" })] });
    await user.click(screen.getByTestId("comment-edit"));
    await user.click(screen.getByTestId("comment-edit-submit"));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-edit-input")).not.toBeInTheDocument();
  });

  it("cancels a reply draft without calling onReply", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), "下書き");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(h.onReply).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-reply-input")).not.toBeInTheDocument();
  });

  it("detail dialog shows the full reply thread", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        pinned("c1", {
          replies: [
            { author: "ai", date: "2026-05-21", body: "一次回答" },
            { body: "追記" },
          ],
        }),
      ],
    });
    await user.click(screen.getByTestId("comment-open-detail"));
    const replies = screen.getAllByTestId("comment-detail-reply");
    expect(replies).toHaveLength(2);
    expect(replies[0]).toHaveTextContent("一次回答");
    expect(replies[1]).toHaveTextContent("追記");
  });

  it("edits the comment body from the detail dialog", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "old" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    const input = screen.getByTestId("comment-detail-edit-input");
    await user.clear(input);
    await user.type(input, "detail edited");
    await user.click(screen.getByTestId("comment-detail-edit-submit"));
    expect(h.onEdit).toHaveBeenCalledWith("c1", "detail edited");
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("detail edit submit with unchanged body closes without onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "keep me" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    await user.click(screen.getByTestId("comment-detail-edit-submit"));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("cancels a detail edit without calling onEdit", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { body: "old" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-edit"));
    await user.type(screen.getByTestId("comment-detail-edit-input"), " more");
    const dialog = screen.getByTestId("comment-detail-dialog");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("comment-detail-edit-input")).not.toBeInTheDocument();
  });

  it("deletes from the detail dialog and closes it", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-delete"));
    expect(h.onDelete).toHaveBeenCalledWith("c1");
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });


  it("closes the detail dialog via 閉じる", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [pinned("c1")] });
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() =>
      expect(screen.queryByTestId("comment-detail-dialog")).not.toBeInTheDocument()
    );
  });

  it("disables edit/delete in the detail dialog for an AI-authored comment", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [pinned("c1", { author: "ai", status: "open" })] });
    await user.click(screen.getByTestId("comment-open-detail"));
    expect(screen.getByTestId("comment-detail-edit")).toBeDisabled();
    expect(screen.getByTestId("comment-detail-delete")).toBeDisabled();
  });

  it("reopens a resolved comment from the detail dialog", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [pinned("c1", { status: "resolved" })] });
    await showAll(user);
    await user.click(screen.getByTestId("comment-open-detail"));
    await user.click(screen.getByTestId("comment-detail-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "open");
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

  it("B3: renders inline code in a reply body", () => {
    renderPane({
      comments: [
        pinned("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "`code`" }],
        }),
      ],
    });
    const replyBody = screen.getByTestId("comment-reply-body");
    expect(replyBody.querySelector("code")).not.toBeNull();
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

  it("B6: editing a human comment's body shows the raw Markdown source, not rendered text", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [pinned("c1", { author: "reviewer", body: "**強調** テキスト" })],
    });
    await user.click(screen.getByTestId("comment-edit"));
    const input = screen.getByTestId("comment-edit-input") as HTMLTextAreaElement;
    expect(input.value).toBe("**強調** テキスト");
  });

  it("B7: a comment row has a comment-header containing the author", () => {
    renderPane({ comments: [pinned("c1", { author: "alice" })] });
    const header = screen.getByTestId("comment-header");
    expect(header).toHaveTextContent("alice");
  });

  it("B8: a reply row has a comment-reply-header", () => {
    renderPane({
      comments: [
        pinned("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "reply" }],
        }),
      ],
    });
    expect(screen.getByTestId("comment-reply-header")).toBeInTheDocument();
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

  it("ケース 2: リンクコピー: 詳細ダイアログ", async () => {
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
      comments: [pinned("c-001")],
    });

    const openDetailBtn = screen.getByTestId("comment-open-detail");
    await user.click(openDetailBtn);

    const dialog = screen.getByTestId("comment-detail-dialog");
    const dialogCopyBtn = within(dialog).getByTestId("comment-detail-copy-link");
    await user.click(dialogCopyBtn);

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
  it("12. keeps global/orphan comments out of the rail, collapsed behind a toggle by default so the rail keeps the pane's height (#301 follow-up)", async () => {
    const user = userEvent.setup();
    renderPane(
      {
        anchorTops: { c1: 10 },
        comments: [
          comment("c1"),
          pinned("g1"),
          comment("o1", { orphan: true, context: null }),
        ],
      },
      { keepPinnedCollapsed: true }
    );
    const section = screen.getByTestId("comment-pinned-section");
    // Collapsed by default: no comment rows rendered inline (they'd otherwise
    // claim height from the flex layout, squeezing the rail below it — the
    // exact #301 failure mode this guards against), just the count in the
    // toggle header.
    expect(within(section).queryAllByTestId("comment-item")).toHaveLength(0);
    expect(within(section).getByTestId("comment-pinned-toggle")).toHaveTextContent(
      "全体・位置不明 2"
    );
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");

    // Expanding renders the pinned comments in an overlay, not as additional
    // flex-participating height on the section itself.
    await user.click(within(section).getByTestId("comment-pinned-toggle"));
    const overlay = screen.getByTestId("comment-pinned-overlay");
    expect(within(overlay).getAllByTestId("comment-item")).toHaveLength(2);
  });

  it("renders anchored comments inside the aligned rail container", () => {
    renderPane({
      anchorTops: { c1: 10, c2: 20 },
      comments: [comment("c1"), comment("c2")],
    });
    expect(screen.getByTestId("comment-rail-aligned")).toBeInTheDocument();
  });

  it("a card the rail can't fit is dropped and counted, and jumping from the count uses onJump", async () => {
    // Root cause of a CI-only flake (rengotaku/markdown-reviewer#305 PR CI):
    // this file's beforeEach stubs getBoundingClientRect to a *tall* pane
    // (4000px, so the earlier multi-card tests in this file can measure more
    // than one card at once — see the stub's own comment above). That stub
    // also applies to *this* test's rail container. The rail measures its
    // own box asynchronously (rAF, in AlignedCommentRail's
    // scheduleMeasurePane) — the very first paint still reflects the
    // pre-measurement state (paneHeight 0), so a `500`-anchored second card
    // doesn't fit yet and "below" renders. But once that rAF fires and
    // remeasures against the 4000px stub, `c2` *does* fit inside a 4000px
    // pane and the whole "below" section unmounts. Locally the click landed
    // before that remeasure; under CI's slower/differently-scheduled
    // event loop the remeasure won, and `await user.click(below)` clicked a
    // detached node — no handler fires, `onJump` is never called (reproduced
    // deterministically here by running this test in isolation, which
    // removes whatever incidental timing the full-suite run relies on: 5/5
    // isolated runs failed at this exact assertion before the fix below).
    //
    // The fix makes the "doesn't fit" outcome true regardless of *which*
    // pane height (the stale 0 or the remeasured 4000) is in effect: c2's
    // anchor sits far below either one, so `belowCount` stays 1 whichever
    // measurement wins the race — the flake is eliminated at the source
    // instead of being timed around.
    const user = userEvent.setup();
    const h = renderPane({
      anchorTops: { c1: 0, c2: 100_000 },
      comments: [comment("c1"), comment("c2")],
    });
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    // Re-queried from `screen` right before the click (rather than reusing
    // the `below` reference from the assertion above) so a re-render between
    // the two would still click the live node, not a detached one.
    await waitFor(() => {
      expect(screen.getByTestId("comment-rail-below")).toHaveTextContent("下に 1 件");
    });
    await user.click(screen.getByTestId("comment-rail-below"));
    await waitFor(() => expect(h.onJump).toHaveBeenCalledWith("c2"));
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

  // #306 case 2: this must not be confused with case 1. A comment with no
  // anchor at all (global scope, or orphaned) is a different, permanent
  // state — it belongs in the pinned section regardless of anchorTops, not
  // "waiting to be measured".
  it("2. a comment with no anchor (global/orphan) still renders in the pinned section, not the rail, regardless of anchorTops", () => {
    renderPane(
      {
        // Neither g1 nor o1 ever gets an anchorTops entry — there's no
        // decoration to measure — while c1 does.
        anchorTops: { c1: 10 },
        comments: [
          comment("c1"),
          pinned("g1"),
          comment("o1", { orphan: true, context: null }),
        ],
      },
      { keepPinnedCollapsed: true }
    );
    const rail = screen.getByTestId("comment-rail-aligned");
    expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");

    const section = screen.getByTestId("comment-pinned-section");
    expect(within(section).getByTestId("comment-pinned-toggle")).toHaveTextContent(
      "全体・位置不明 2"
    );
  });
});

describe("CommentSidePane rail card selection (#308)", () => {
  // #304 stripped the popover (CommentThreadPopover) without moving its
  // actions into the rail card, so an anchored comment could be read but
  // never replied to or resolved from the UI. These cases restore that only
  // for the selected card — an unselected card must stay exactly as low as
  // before (#298's whole point), so cases 1-2 pin down the "still nothing
  // extra" side before 3-6 pin down what selection adds.

  it("1. a non-selected card renders no operation row (no reply input, resolve toggle, edit, or delete)", () => {
    renderPane({ comments: [comment("c1")] });
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
    expect(screen.queryByTestId("comment-resolve-toggle")).toBeNull();
    expect(screen.queryByTestId("comment-edit")).toBeNull();
    expect(screen.queryByTestId("comment-delete")).toBeNull();
  });

  it("2. a non-selected card with replies shows only the reply count, not the reply bodies", () => {
    renderPane({
      comments: [
        comment("c1", {
          replies: [{ author: "reviewer", date: "2026-05-21", body: "reply body" }],
        }),
      ],
    });
    expect(screen.getByTestId("comment-reply-count")).toHaveTextContent("返信 1 件");
    expect(screen.queryByTestId("comment-reply-body")).toBeNull();
    expect(screen.queryByText("reply body")).toBeNull();
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
    expect(within(firstAfter).queryByTestId("comment-resolve-toggle")).toBeNull();
    expect(within(secondAfter).getByTestId("comment-resolve-toggle")).toBeInTheDocument();
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

  it("2. a selected card renders its context row", () => {
    renderPane({ comments: [comment("c1")], selectedId: "c1" });
    expect(screen.getByTestId("comment-context-c1")).toHaveTextContent("対象: ## Sec (L3)");
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
