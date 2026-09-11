import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalCommentBadges } from "./GlobalCommentBadges";

describe("GlobalCommentBadges", () => {
  it("renders nothing when both counts are zero", () => {
    const { container } = render(
      <GlobalCommentBadges globalCount={0} orphanCount={0} onOpen={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the global badge when only global comments exist", () => {
    render(<GlobalCommentBadges globalCount={2} orphanCount={0} onOpen={vi.fn()} />);
    expect(screen.getByTestId("global-comment-badge")).toHaveTextContent("全体 2");
    expect(screen.queryByTestId("orphan-comment-badge")).toBeNull();
  });

  it("shows only the orphan badge when only orphan comments exist", () => {
    render(<GlobalCommentBadges globalCount={0} orphanCount={3} onOpen={vi.fn()} />);
    expect(screen.getByTestId("orphan-comment-badge")).toHaveTextContent("位置不明 3");
    expect(screen.queryByTestId("global-comment-badge")).toBeNull();
  });

  it("shows both badges when both counts are non-zero", () => {
    render(<GlobalCommentBadges globalCount={1} orphanCount={1} onOpen={vi.fn()} />);
    expect(screen.getByTestId("global-comment-badge")).toBeInTheDocument();
    expect(screen.getByTestId("orphan-comment-badge")).toBeInTheDocument();
  });

  it("calls onOpen with the pressed badge's kind", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<GlobalCommentBadges globalCount={1} orphanCount={1} onOpen={onOpen} />);
    await user.click(screen.getByTestId("global-comment-badge"));
    expect(onOpen).toHaveBeenCalledWith("global");
    await user.click(screen.getByTestId("orphan-comment-badge"));
    expect(onOpen).toHaveBeenCalledWith("orphan");
  });
});
