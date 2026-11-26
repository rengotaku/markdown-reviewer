import { describe, it, expect, vi, afterEach, onTestFinished } from "vitest";
import { render, screen, within, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentSidePane } from "./CommentSidePane";
import type { CommentJSON } from "@/api";

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
  // The reader shows the selected comment, so most tests (which look at one
  // comment's body, replies and actions) start with the first anchored one
  // selected; pass `selectedId: null` for an empty reader.
  const firstAnchored = (props.comments ?? []).find(
    (c) => c.scope !== "global" && !c.orphan
  );
  render(
    <CommentSidePane
      root="works"
      filePath="doc.md"
      comments={[]}
      reviewActive
      canAddComment
      selectedId={firstAnchored?.id ?? null}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

/** #394: the status filter is three icon toggles; press one. */
async function chooseStatus(
  user: ReturnType<typeof userEvent.setup>,
  value: "all" | "open" | "resolved"
) {
  await user.click(screen.getByTestId(`comment-filter-${value}`));
}

describe("CommentSidePane", () => {
  it("shows each comment's id so a person can match it to what the AI reported (#286)", async () => {
    renderPane({ comments: [comment("c-001"), comment("c-002")] });
    const rows = screen.getAllByTestId("comment-item");
    expect(rows).toHaveLength(2);
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
    expect(screen.getByTestId("global-comment-badge")).not.toBeDisabled();
    await user.click(screen.getByTestId("editor-add-comment"));
    expect(handlers.onAddComment).toHaveBeenCalledTimes(1);
    // #394: with no global comments the globe goes straight to the composer.
    await user.click(screen.getByTestId("global-comment-badge"));
    expect(handlers.onAddGlobal).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when under review with no comments", () => {
    renderPane();
    expect(screen.getByText(/コメントはまだありません/)).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();
  });

  it("renders each comment with body, context, scope badge", async () => {
    renderPane({
      comments: [
        comment("c1", { body: "first" }),
        comment("c2", { scope: "block", body: "second" }),
      ],
    });
    // #390: the title carries no open/total count.
    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.queryByText(/Comments \(/)).toBeNull();
    expect(screen.getAllByTestId("comment-item")).toHaveLength(2);
    const [first, second] = screen.getAllByTestId("comment-item");
    expect(within(first).getByTestId("comment-row-body")).toHaveTextContent("first");
    expect(within(second).getByTestId("comment-row-body")).toHaveTextContent("second");
    // The selected one (c1) is in the reader, with its scope badge.
    expect(screen.getByTestId("comment-scope-inline")).toBeInTheDocument();
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
  it("calls onRefresh when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("comment-pane-refresh"));
    expect(h.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("filters the list by status via icon toggles that carry the counts (#394)", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [
        comment("c1", { status: "open" }),
        comment("c2", { status: "resolved" }),
      ],
    });
    // 未解決 by default (#253)
    expect(screen.getAllByTestId("comment-item")).toHaveLength(1);
    expect(screen.getByTestId("comment-filter-open")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // All three counts stay visible; the icon's meaning is in the name/tooltip.
    expect(screen.getByTestId("comment-filter-all")).toHaveTextContent(/^2$/);
    expect(screen.getByTestId("comment-filter-all")).toHaveAccessibleName(
      "すべて（2 件）を表示"
    );
    expect(screen.getByTestId("comment-filter-open")).toHaveAccessibleName(
      "未解決（1 件）を表示"
    );
    expect(screen.getByTestId("comment-filter-resolved")).toHaveAccessibleName(
      "解決済み（1 件）を表示"
    );
    await user.hover(screen.getByTestId("comment-filter-all"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("すべて（2 件）を表示");
    await user.unhover(screen.getByTestId("comment-filter-all"));
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    // Keyboard users get the same description on focus, and Space switches.
    await user.click(screen.getByTestId("comment-filter-open"));
    await user.tab();
    expect(screen.getByTestId("comment-filter-resolved")).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "解決済み（1 件）を表示"
    );
    await user.keyboard(" ");
    expect(screen.getByTestId("comment-filter-resolved")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await chooseStatus(user, "all");
    await waitFor(() => expect(screen.getAllByTestId("comment-item")).toHaveLength(2));
    await chooseStatus(user, "resolved");
    let items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-comment-id", "c2");
    await chooseStatus(user, "open");
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
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent(/^2$/);
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
        unresolvedIds: new Set(["u1"]),
        comments: [
          comment("c1"),
          comment("u1", { orphan: false, body: "表の行にアンカーしたコメント" }),
        ],
      });
      expect(screen.getByTestId("orphan-comment-badge")).toHaveTextContent(/^1$/);
      // and it stays out of the rail — it has no position to be placed at
      const rail = screen.getByTestId("comment-list");
      expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
      expect(within(rail).getByTestId("comment-id")).toHaveTextContent("c1");
      // the thread is reachable from the badge, so the comment is readable
      await user.click(screen.getByTestId("orphan-comment-badge"));
      expect(screen.getByText("表の行にアンカーしたコメント")).toBeInTheDocument();
    });

    it("adds up: rail + 全体 + 位置不明 covers every comment the header counts", async () => {
      const user = userEvent.setup();
      renderPane({
        unresolvedIds: new Set(["u1"]),
        comments: [
          comment("c1"),
          comment("u1"),
          pinned("g1"),
          comment("o1", { orphan: true, context: null }),
        ],
      });
      await chooseStatus(user, "all");
      expect(screen.getByTestId("comment-filter-all")).toHaveTextContent(/^4$/);
      const rail = screen.getByTestId("comment-list");
      expect(within(rail).getAllByTestId("comment-item")).toHaveLength(1);
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent(/^1$/);
      // o1 (server orphan) + u1 (caller could not resolve it)
      expect(screen.getByTestId("orphan-comment-badge")).toHaveTextContent(/^2$/);
    });

    it("puts the badges in the status row; the orphan badge has no 位置不明 text, only a tooltip and accessible name (#390)", async () => {
      const user = userEvent.setup();
      renderPane({
        comments: [pinned("g1"), comment("o1", { orphan: true, context: null })],
      });
      const row = screen.getByTestId("comment-add-toolbar");
      expect(within(row).getByTestId("comment-status-filter")).toBeInTheDocument();
      expect(within(row).getByTestId("global-comment-badge")).toHaveTextContent(/^1$/);
      const orphan = within(row).getByTestId("orphan-comment-badge");
      expect(orphan).not.toHaveTextContent("位置不明");
      expect(orphan).toHaveAccessibleName(/位置不明/);
      await user.hover(orphan);
      expect(await screen.findByRole("tooltip")).toHaveTextContent("位置不明");
      // Still opens the same dialog.
      await user.click(orphan);
      expect(screen.getByTestId("global-comments-dialog")).toBeInTheDocument();
    });

    it("keeps only the countless globe when there are no global or orphan comments (#394)", () => {
      renderPane({ comments: [comment("c1")] });
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent(/^$/);
      expect(screen.queryByTestId("orphan-comment-badge")).toBeNull();
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

      it("stays closed when only another comment's verdict changes after the reader closed it (#413)", async () => {
        const user = userEvent.setup();
        const comments = [comment("u1"), comment("u2")];
        const { rerender } = render(paneWith(comments, null));
        rerender(paneWith(comments, "u1"));
        rerender(paneWith(comments, "u1", new Set(["u1"])));
        expect(screen.getByTestId("global-comments-dialog")).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() =>
          expect(screen.queryByTestId("global-comments-dialog")).toBeNull()
        );

        rerender(paneWith(comments, "u1", new Set(["u1", "u2"])));
        expect(screen.queryByTestId("global-comments-dialog")).toBeNull();
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
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent(/^1$/);
      await chooseStatus(user, "resolved");
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent(/^1$/);
      await chooseStatus(user, "all");
      expect(screen.getByTestId("global-comment-badge")).toHaveTextContent(/^2$/);
    });
  });

  it("invokes the add-comment callbacks from the toolbar", async () => {
    const user = userEvent.setup();
    const h = renderPane();
    await user.click(screen.getByTestId("editor-add-comment"));
    await user.click(screen.getByTestId("global-comment-badge"));
    expect(h.onAddComment).toHaveBeenCalled();
    expect(h.onAddGlobal).toHaveBeenCalled();
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
    });
    expect(screen.getByTestId("comment-reader-context")).toHaveTextContent(
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
    });
    expect(screen.getByTestId("comment-reader-context")).toHaveTextContent(
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
    });
    expect(screen.getByTestId("comment-reader-context")).toHaveTextContent(
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

describe("CommentSidePane list (#298)", () => {
  it("12. keeps global/orphan comments out of the list entirely — they render at the top of the document body, not in this pane (#309)", () => {
    renderPane({
      comments: [
        comment("c1"),
        pinned("g1"),
        comment("o1", { orphan: true, context: null }),
      ],
    });
    expect(screen.queryByTestId("comment-pinned-section")).toBeNull();
    const list = screen.getByTestId("comment-list");
    expect(within(list).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(list).getByTestId("comment-id")).toHaveTextContent("c1");
  });

  it("renders anchored comments inside the list container", () => {
    renderPane({ comments: [comment("c1"), comment("c2")] });
    expect(screen.getByTestId("comment-list")).toBeInTheDocument();
  });
});

describe("CommentSidePane resolved comments in the list (#326)", () => {
  it("a resolved comment is listed under the resolved filter", async () => {
    const user = userEvent.setup();
    renderPane({ comments: [comment("r1", { status: "resolved" })] });
    await chooseStatus(user, "resolved");
    const list = screen.getByTestId("comment-list");
    expect(within(list).getAllByTestId("comment-item")).toHaveLength(1);
    expect(within(list).getByTestId("comment-id")).toHaveTextContent("r1");
  });
});

describe("CommentSidePane list rows (#411)", () => {
  it("1. a row is one line: state dot, id, the body's first line; no reply / resolve / edit / delete / copy buttons", () => {
    renderPane({
      comments: [comment("c1", { body: "一行目\n二行目" })],
      selectedId: null,
    });
    const row = screen.getByTestId("comment-item");
    expect(within(row).getByTestId("comment-state-dot")).toBeInTheDocument();
    expect(within(row).getByTestId("comment-id")).toHaveTextContent("c1");
    expect(within(row).getByTestId("comment-row-body")).toHaveTextContent(/^一行目$/);
    for (const id of [
      "comment-reply-toggle",
      "comment-resolve-toggle",
      "comment-edit",
      "comment-delete",
      "comment-copy-link",
      "comment-open-detail",
    ]) {
      expect(within(row).queryByTestId(id)).toBeNull();
    }
  });

  it("2. a row shows a badge for new AI replies, and none otherwise", () => {
    renderPane({
      comments: [comment("c1"), comment("c2")],
      selectedId: null,
      agentNewReplies: new Map([["c1", 2]]),
    });
    const [first, second] = screen.getAllByTestId("comment-item");
    expect(within(first).getByTestId("comment-new-ai-replies")).toHaveTextContent(
      "新着 2"
    );
    expect(within(second).queryByTestId("comment-new-ai-replies")).toBeNull();
  });
});

describe("CommentSidePane reader (#411)", () => {
  it("1. with nothing selected the reader says to pick a comment", () => {
    renderPane({ comments: [comment("c1")], selectedId: null });
    expect(screen.getByTestId("comment-reader")).toHaveTextContent(
      "一覧からコメントを選ぶと、ここに全文が出ます"
    );
    expect(screen.queryByTestId("comment-body")).toBeNull();
  });

  it("2. the selected comment's id, scope, target, body and every reply are shown in full", () => {
    renderPane({
      comments: [
        comment("c1", {
          body: "あ".repeat(250),
          replies: [
            { author: "ai", date: "2026-05-21", body: "first reply" },
            { author: "reviewer", date: "2026-05-22", body: "second reply" },
            { author: "ai", date: "2026-05-23", body: "third reply" },
          ],
        }),
        comment("c2"),
      ],
      selectedId: "c1",
    });
    const reader = screen.getByTestId("comment-reader");
    expect(within(reader).getByTestId("comment-id")).toHaveTextContent("c1");
    expect(within(reader).getByTestId("comment-scope-inline")).toBeInTheDocument();
    expect(within(reader).getByTestId("comment-reader-context")).toHaveTextContent(
      "対象:"
    );
    expect(within(reader).getByTestId("comment-body").textContent).toContain(
      "あ".repeat(250)
    );
    expect(within(reader).queryByTestId("comment-body-toggle")).toBeNull();
    expect(within(reader).getByText("third reply")).toBeInTheDocument();
    expect(within(reader).getByText("first reply")).toBeInTheDocument();
  });

  it("3. only the reader scrolls: it has its own overflow box", () => {
    renderPane({ comments: [comment("c1")], selectedId: "c1" });
    expect(getComputedStyle(screen.getByTestId("comment-reader-scroll")).overflow).toBe(
      "auto"
    );
  });

  it("4. the reader carries reply / resolve / edit / delete / copy-link, and the comment's author bar", async () => {
    const user = userEvent.setup();
    const h = renderPane({
      comments: [
        comment("c1", {
          author: "kishira",
          replies: [{ author: "ai", date: "2026-05-21", body: "reply body" }],
        }),
      ],
      selectedId: "c1",
    });
    const reader = screen.getByTestId("comment-reader");
    const main = within(reader).getByTestId("comment-main-header");
    expect(within(main).getByRole("img", { name: "kishira" })).toBeInTheDocument();
    expect(within(main).getByTestId("comment-edit")).toBeInTheDocument();
    expect(within(main).getByTestId("comment-delete")).toBeInTheDocument();
    expect(
      within(within(reader).getByTestId("comment-reply-header")).getByRole("img", {
        name: "ai",
      })
    ).toBeInTheDocument();
    expect(reader.textContent).not.toContain("2026-05-2");
    expect(within(reader).getByTestId("comment-copy-link")).toBeInTheDocument();

    await user.click(within(reader).getByTestId("comment-reply-toggle"));
    await user.type(within(reader).getByTestId("comment-reply-input"), "返信本文");
    await user.click(within(reader).getByTestId("comment-reply-submit"));
    expect(h.onReply).toHaveBeenCalledWith("c1", "返信本文");

    await user.click(within(reader).getByTestId("comment-resolve-toggle"));
    expect(h.onResolveToggle).toHaveBeenCalledWith("c1", "resolved");
  });

  it("5. an ai-authored comment's edit/delete stay disabled (comment and reply)", () => {
    renderPane({
      comments: [
        comment("c1", {
          author: "ai",
          replies: [{ author: "ai", date: "2026-05-20", body: "ai reply" }],
        }),
      ],
      selectedId: "c1",
    });
    const reader = screen.getByTestId("comment-reader");
    expect(within(reader).getByTestId("comment-edit")).toBeDisabled();
    expect(within(reader).getByTestId("comment-delete")).toBeDisabled();
    expect(within(reader).getByTestId("comment-reply-edit")).toBeDisabled();
    expect(within(reader).getByTestId("comment-reply-delete")).toBeDisabled();
  });

  it("6. a badge-only author stays readable by screen readers (#364)", () => {
    renderPane({
      comments: [
        comment("c1", {
          author: "kishira",
          replies: [{ author: "ai", date: "2026-05-21", body: "only reply" }],
        }),
      ],
    });
    const reader = screen.getByTestId("comment-reader");
    expect(within(reader).getByRole("img", { name: "kishira" })).toBeInTheDocument();
    expect(within(reader).getByRole("img", { name: "ai" })).toBeInTheDocument();
  });

  it("7. moving the selection shows the other comment in the reader", () => {
    const comments = [comment("c1", { body: "one" }), comment("c2", { body: "two" })];
    const common = {
      root: "works",
      filePath: "doc.md",
      comments,
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
    };
    const { rerender } = render(<CommentSidePane {...common} selectedId="c1" />);
    expect(screen.getByTestId("comment-body")).toHaveTextContent("one");
    rerender(<CommentSidePane {...common} selectedId="c2" />);
    expect(screen.getByTestId("comment-body")).toHaveTextContent("two");
    expect(screen.getByTestId("comment-reader")).toHaveAttribute("data-comment-id", "c2");
  });

  it("8. 本文へ移動 calls onJump with the comment id", async () => {
    const user = userEvent.setup();
    const h = renderPane({ comments: [comment("c1")], selectedId: "c1" });
    const jump = screen.getByTestId("comment-reader-jump");
    expect(jump).toBeEnabled();
    await user.click(jump);
    expect(h.onJump).toHaveBeenCalledWith("c1");
  });

  it("9. 本文へ移動 is disabled for a comment the editor cannot place", () => {
    renderPane({
      comments: [comment("u1"), comment("c1")],
      selectedId: "u1",
      unresolvedIds: new Set(["u1"]),
    });
    expect(screen.getByTestId("comment-reader-jump")).toBeDisabled();
  });

  it("10. a comment with no list row can still be read: the status filter hiding it does not empty the reader", async () => {
    const user = userEvent.setup();
    renderPane({
      comments: [comment("c1"), comment("r1", { status: "resolved" })],
      selectedId: "r1",
    });
    expect(screen.getByTestId("comment-reader")).toHaveAttribute("data-comment-id", "r1");
    await chooseStatus(user, "all");
    expect(screen.getByTestId("comment-reader")).toHaveAttribute("data-comment-id", "r1");
  });
});

describe("CommentSidePane reader stays when the list is empty (#411)", () => {
  it("(a) a resolved-only file opened on a resolved comment shows it despite the empty 未解決 list", () => {
    renderPane({
      comments: [comment("r1", { status: "resolved", body: "解決済みの本文" })],
      selectedId: "r1",
    });
    expect(screen.queryByTestId("comment-item")).toBeNull();
    expect(screen.getByText("未解決のコメントはありません。")).toBeInTheDocument();
    expect(screen.getByTestId("comment-reader")).toHaveAttribute("data-comment-id", "r1");
    expect(screen.getByTestId("comment-body")).toHaveTextContent("解決済みの本文");
    expect(screen.getByTestId("comment-pane-splitter")).toBeInTheDocument();
  });

  it("(b) resolving the last open comment keeps it in the reader", () => {
    const common = {
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
      selectedId: "c1",
    };
    const { rerender } = render(
      <CommentSidePane {...common} comments={[comment("c1")]} />
    );
    expect(screen.getAllByTestId("comment-item")).toHaveLength(1);
    rerender(
      <CommentSidePane {...common} comments={[comment("c1", { status: "resolved" })]} />
    );
    expect(screen.queryByTestId("comment-item")).toBeNull();
    expect(screen.getByTestId("comment-reader")).toHaveAttribute("data-comment-id", "c1");
  });
});

describe("CommentSidePane reader scroll (#411)", () => {
  const common = {
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
  };

  it("returns to the top when another comment is selected", () => {
    const comments = [comment("c1"), comment("c2")];
    const { rerender } = render(
      <CommentSidePane {...common} comments={comments} selectedId="c1" />
    );
    screen.getByTestId("comment-reader-scroll").scrollTop = 300;
    rerender(<CommentSidePane {...common} comments={comments} selectedId="c2" />);
    expect(screen.getByTestId("comment-reader-scroll").scrollTop).toBe(0);
  });

  it("keeps the reading position when the same comment is refetched", () => {
    const { rerender } = render(
      <CommentSidePane {...common} comments={[comment("c1")]} selectedId="c1" />
    );
    screen.getByTestId("comment-reader-scroll").scrollTop = 300;
    rerender(
      <CommentSidePane
        {...common}
        comments={[comment("c1", { body: "更新された本文" })]}
        selectedId="c1"
      />
    );
    expect(screen.getByTestId("comment-reader-scroll").scrollTop).toBe(300);
  });
});

describe("CommentSidePane splitter (#411)", () => {
  it("is a horizontal separator that resizes the list by dragging, within a minimum", () => {
    renderPane({ comments: [comment("c1")], selectedId: null });
    const splitter = screen.getByTestId("comment-pane-splitter");
    expect(splitter).toHaveAttribute("role", "separator");
    expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
    const listBox = screen.getByTestId("comment-list").parentElement as HTMLElement;
    const before = parseInt(getComputedStyle(listBox).height, 10);

    fireEvent.pointerDown(splitter, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(splitter, { clientY: 360, pointerId: 1 });
    fireEvent.pointerUp(splitter, { clientY: 360, pointerId: 1 });
    expect(parseInt(getComputedStyle(listBox).height, 10)).toBe(before + 60);

    // Dragged far up: the list stops at its minimum instead of collapsing.
    fireEvent.pointerDown(splitter, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(splitter, { clientY: -5000, pointerId: 1 });
    fireEvent.pointerUp(splitter, { clientY: -5000, pointerId: 1 });
    expect(parseInt(getComputedStyle(listBox).height, 10)).toBeGreaterThan(0);
  });

  it("holds the list inside the pane when the pane shrinks, and restores the dragged height when it grows", () => {
    let notify: ((height: number) => void) | null = null;
    const original = globalThis.ResizeObserver;
    class CapturingResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        notify = (height) =>
          cb(
            [{ contentRect: { height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      CapturingResizeObserver as unknown as typeof ResizeObserver;
    onTestFinished(() => {
      globalThis.ResizeObserver = original;
    });
    renderPane({ comments: [comment("c1")], selectedId: null });
    const splitter = screen.getByTestId("comment-pane-splitter");
    const listBox = screen.getByTestId("comment-list").parentElement as HTMLElement;
    const listPx = () => parseInt(getComputedStyle(listBox).height, 10);

    // Dragged tall in a roomy pane.
    act(() => notify!(1000));
    fireEvent.pointerDown(splitter, { clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(splitter, { clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(splitter, { clientY: 500, pointerId: 1 });
    expect(listPx()).toBeGreaterThan(400);

    // The pane shrinks: splitter and the reader's minimum (120) stay inside.
    act(() => notify!(300));
    expect(listPx()).toBeLessThanOrEqual(300 - 6 - 120);

    // A pane too short for both minimums: the list gives way entirely.
    act(() => notify!(100));
    expect(listPx()).toBeLessThanOrEqual(Math.max(0, 100 - 6 - 120));

    // Roomy again: back to the dragged height.
    act(() => notify!(1000));
    expect(listPx()).toBeGreaterThan(400);
  });
});

describe("CommentSidePane list (#333)", () => {
  it("lists every anchored card in document order", () => {
    renderPane({
      comments: [comment("c1"), comment("c2"), comment("c3"), pinned("g1")],
    });
    const list = screen.getByTestId("comment-list");
    expect(
      within(list)
        .getAllByTestId("comment-id")
        .map((el) => el.textContent)
    ).toEqual(["c1", "c2", "c3"]);
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
    });
    const items = within(screen.getByTestId("comment-list")).getAllByTestId(
      "comment-item"
    );
    await user.click(items[1]);
    expect(h.onSelect).toHaveBeenCalledWith("c2");
  });

  it("scrolls the selected row into view only when the caller asks (revealSelectedSeq), every time it asks", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      // jsdom has no scrollIntoView of its own; don't leave the stub behind.
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    });
    const common = {
      root: "works",
      filePath: "doc.md",
      comments: [comment("c1"), comment("c2")],
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
    };
    const { rerender } = render(<CommentSidePane {...common} selectedId="c1" />);
    // Mounting with a selection, and a selection that changes by itself (a
    // click on a row), leave the list where it is.
    rerender(<CommentSidePane {...common} selectedId="c2" />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<CommentSidePane {...common} selectedId="c2" revealSelectedSeq={1} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toHaveAttribute("data-comment-id", "c2");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    // Same comment asked for again.
    rerender(<CommentSidePane {...common} selectedId="c2" revealSelectedSeq={2} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when the selected comment has no row (hidden by the status filter)", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    });
    renderPane({
      comments: [comment("c1"), comment("r1", { status: "resolved" })],
      selectedId: "r1",
      revealSelectedSeq: 1,
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("CommentSidePane drafts survive the reader switching comments (#334)", () => {
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
  });

  /** The reader holds the selected comment's forms. */
  function selectedCard(): HTMLElement {
    return screen.getByTestId("comment-reader");
  }

  async function startReply(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.click(within(selectedCard()).getByTestId("comment-reply-toggle"));
    await user.type(screen.getByTestId("comment-reply-input"), text);
  }

  it("keeps a half-written reply in the reader while the status filter changes", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1")], selectedId: "c1" };
    render(<CommentSidePane {...props} />);
    await startReply(user, "書きかけ");

    await chooseStatus(user, "resolved");
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("書きかけ");
    await chooseStatus(user, "open");
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("書きかけ");
  });

  it("keeps a half-written reply when another comment is selected and the first is selected again (#411)", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1"), comment("c2")] };
    const { rerender } = render(<CommentSidePane {...props} selectedId="c1" />);
    await startReply(user, "書きかけ");

    rerender(<CommentSidePane {...props} selectedId="c2" />);
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
    rerender(<CommentSidePane {...props} selectedId="c1" />);
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("書きかけ");
  });

  it("keeps a half-written edit when another comment is selected and the first is selected again (#411)", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1"), comment("c2")] };
    const { rerender } = render(<CommentSidePane {...props} selectedId="c1" />);
    await user.click(screen.getByTestId("comment-edit"));
    await user.type(screen.getByTestId("comment-edit-input"), " 追記");

    rerender(<CommentSidePane {...props} selectedId="c2" />);
    rerender(<CommentSidePane {...props} selectedId="c1" />);
    expect(screen.getByTestId("comment-edit-input")).toHaveValue("body of c1 追記");
  });

  it("clears the draft once the reply is sent", async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), comments: [comment("c1")], selectedId: "c1" };
    render(<CommentSidePane {...props} />);
    await startReply(user, "送信する");
    await user.click(screen.getByTestId("comment-reply-submit"));
    expect(props.onReply).toHaveBeenCalledWith("c1", "送信する");

    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
    await user.click(screen.getByTestId("comment-reply-toggle"));
    expect(screen.getByTestId("comment-reply-input")).toHaveValue("");
  });

  it("drops a deleted comment's draft so a new comment reusing its id starts clean", async () => {
    // reviewstore numbers a new comment max+1, so deleting the highest id and
    // adding again hands the same id to a different comment.
    const user = userEvent.setup();
    const props = { ...baseProps(), selectedId: "c1" };
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
    const props = { ...baseProps(), selectedId: "c1" };
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

  it("does not carry a draft over to a same-id comment in another file", async () => {
    const user = userEvent.setup();
    const props = {
      ...baseProps(),
      comments: [comment("c1")],
      selectedId: "c1",
    };
    const { rerender } = render(<CommentSidePane {...props} />);
    await startReply(user, "doc.md 向け");

    rerender(<CommentSidePane {...props} filePath="other.md" />);
    expect(screen.queryByTestId("comment-reply-input")).toBeNull();
  });
});

describe("CommentSidePane sent to AI (#366)", () => {
  // The reader shows the selected comment, so the state is read there.
  it("marks a sent comment as being answered", () => {
    renderPane({
      comments: [comment("c1"), comment("c2")],
      selectedId: "c1",
      agentReplying: true,
      agentSentIds: new Set(["c1"]),
    });
    const reader = screen.getByTestId("comment-reader");
    expect(within(reader).getByTestId("comment-awaiting-ai")).toBeInTheDocument();
    expect(within(reader).queryByTestId("comment-unsent-to-ai")).toBeNull();
  });

  it("marks a comment written after the send as not yet sent", () => {
    renderPane({
      comments: [comment("c1"), comment("c2")],
      selectedId: "c2",
      agentReplying: true,
      agentSentIds: new Set(["c1"]),
    });
    const reader = screen.getByTestId("comment-reader");
    expect(within(reader).getByTestId("comment-unsent-to-ai")).toBeInTheDocument();
    expect(within(reader).queryByTestId("comment-awaiting-ai")).toBeNull();
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
      selectedId: "c1",
      agentReplying: true,
      agentSentIds: new Set(["c1", "c2"]),
    });
    expect(screen.queryByTestId("comment-awaiting-ai")).toBeNull();
  });

  it("keeps showing it on a comment the AI has not answered yet (#372)", () => {
    renderPane({
      comments: [
        comment("c2", {
          replies: [
            { author: "ai", body: "反映しました" },
            { author: "alice", body: "まだ違う" },
          ],
        }),
      ],
      selectedId: "c2",
      agentReplying: true,
      agentSentIds: new Set(["c2"]),
    });
    expect(screen.getByTestId("comment-awaiting-ai")).toBeInTheDocument();
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
});
