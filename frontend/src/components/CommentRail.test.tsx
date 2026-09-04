import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommentRail } from "./CommentRail";
import type { CommentJSON } from "@/api";

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

function renderRail(props: Partial<React.ComponentProps<typeof CommentRail>> = {}) {
  const handlers = { onOpen: vi.fn(), onAddGlobal: vi.fn() };
  render(<CommentRail comments={[]} reviewActive {...handlers} {...props} />);
  return handlers;
}

function countOf(key: "all" | "open" | "resolved"): string {
  return screen.getByTestId(`comment-rail-count-${key}`).textContent ?? "";
}

describe("CommentRail", () => {
  it("counts every comment on the file, anchored and file-wide alike", () => {
    renderRail({
      comments: [
        comment("a"),
        comment("b", { status: "resolved" }),
        comment("c", { scope: "global", anchor: undefined, context: null }),
        comment("d", {
          scope: "global",
          anchor: undefined,
          context: null,
          status: "resolved",
        }),
        comment("e", { orphan: true }),
      ],
    });
    expect(countOf("all")).toContain("5");
    expect(countOf("open")).toContain("3");
    expect(countOf("resolved")).toContain("2");
  });

  it("names each count for assistive tech", () => {
    renderRail({ comments: [comment("a"), comment("b", { status: "resolved" })] });
    expect(screen.getByLabelText("すべて 2件")).toBeInTheDocument();
    expect(screen.getByLabelText("未解決 1件")).toBeInTheDocument();
    expect(screen.getByLabelText("解決済 1件")).toBeInTheDocument();
  });

  it("shows no counts on a file with no comments", () => {
    renderRail({ comments: [] });
    expect(screen.queryByTestId("comment-rail-counts")).not.toBeInTheDocument();
  });

  it("shows no counts on a file that is not under review", () => {
    renderRail({ comments: [comment("a")], reviewActive: false });
    expect(screen.queryByTestId("comment-rail-counts")).not.toBeInTheDocument();
  });

  it("opens the pane from the comment button", async () => {
    const user = userEvent.setup();
    const handlers = renderRail();
    await user.click(screen.getByTestId("editor-toggle-comments"));
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
  });

  it("asks for a file-wide comment composer anchored at its button", async () => {
    const user = userEvent.setup();
    const handlers = renderRail();
    await user.click(screen.getByTestId("rail-add-global-comment"));
    expect(handlers.onAddGlobal).toHaveBeenCalledTimes(1);
    expect(handlers.onAddGlobal.mock.calls[0][0]).toBeTruthy();
  });

  it("keeps the file-wide button usable before the file is under review", async () => {
    const user = userEvent.setup();
    const handlers = renderRail({ reviewActive: false });
    // Same contract as the pane's button: the click reaches the parent, which
    // ingests the file and then opens the composer.
    await user.click(screen.getByTestId("rail-add-global-comment"));
    expect(handlers.onAddGlobal).toHaveBeenCalledTimes(1);
  });
});
