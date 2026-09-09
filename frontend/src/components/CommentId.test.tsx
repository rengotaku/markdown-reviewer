import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommentThreadPopover } from "./CommentThreadPopover";
import { CommentHoverPreview } from "./CommentHoverPreview";
import type { CommentJSON } from "@/api";

const comment: CommentJSON = {
  id: "c-007",
  scope: "inline",
  author: "alice",
  date: "2026-09-09",
  body: "この節の主題を変えたい",
  status: "open",
  anchor: { heading_path: ["## Sec"], snippet: "text", occurrence: 0 },
  context: { heading_path: ["## Sec"], line_range: [3, 3] },
  orphan: false,
};

/** The id is the handle the AI uses in its reports ("c-007 を反映した"), so it
 *  has to be readable on every surface a person reads comments on (#286). */
describe("comment id on the reading surfaces", () => {
  it("names the thread in the popover, with and without a context line", () => {
    const { unmount } = render(
      <CommentThreadPopover
        comment={comment}
        contextLabel="## Sec · L3"
        editDisabledReason={null}
        deleteDisabledReason={null}
        deleting={false}
        maxHeight={480}
        draft=""
        onDraftChange={vi.fn()}
        onReply={vi.fn()}
        onResolveToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByTestId("comment-id")).toHaveTextContent("c-007");
    expect(screen.getByTestId("comment-thread-context")).toBeInTheDocument();
    unmount();

    render(
      <CommentThreadPopover
        comment={comment}
        contextLabel={null}
        editDisabledReason={null}
        deleteDisabledReason={null}
        deleting={false}
        maxHeight={480}
        draft=""
        onDraftChange={vi.fn()}
        onReply={vi.fn()}
        onResolveToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByTestId("comment-id")).toHaveTextContent("c-007");
    expect(screen.queryByTestId("comment-thread-context")).not.toBeInTheDocument();
  });

  it("keeps the author line intact in the hover preview", () => {
    render(<CommentHoverPreview comment={comment} />);
    expect(screen.getByTestId("comment-id")).toHaveTextContent("c-007");
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });
});
