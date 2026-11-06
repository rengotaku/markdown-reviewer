import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalCommentBadges } from "./GlobalCommentBadges";

const noop = () => {};

describe("GlobalCommentBadges", () => {
  it("always shows the globe, without a count when there are no global comments", () => {
    render(
      <GlobalCommentBadges
        globalCount={0}
        orphanCount={0}
        onOpen={noop}
        onAddGlobal={noop}
      />
    );
    const globe = screen.getByTestId("global-comment-badge");
    expect(globe).toHaveAccessibleName(/ファイル全体にコメントを追加/);
    expect(globe).toHaveTextContent(/^$/);
    expect(screen.queryByTestId("orphan-comment-badge")).toBeNull();
  });

  it("puts the global count on the globe", () => {
    render(
      <GlobalCommentBadges
        globalCount={2}
        orphanCount={0}
        onOpen={noop}
        onAddGlobal={noop}
      />
    );
    const globe = screen.getByTestId("global-comment-badge");
    expect(globe).toHaveTextContent(/^2$/);
    expect(globe).toHaveAccessibleName("ファイル全体へのコメント（2 件）");
  });

  it("shows the orphan button only while it has a count", () => {
    render(
      <GlobalCommentBadges
        globalCount={0}
        orphanCount={3}
        onOpen={noop}
        onAddGlobal={noop}
      />
    );
    const orphan = screen.getByTestId("orphan-comment-badge");
    expect(orphan).toHaveTextContent(/^3$/);
    expect(orphan).toHaveAccessibleName("位置不明のコメント（3 件）");
  });

  it("hides the orphan button when showOrphan is false", () => {
    render(
      <GlobalCommentBadges
        globalCount={0}
        orphanCount={3}
        showOrphan={false}
        onOpen={noop}
        onAddGlobal={noop}
      />
    );
    expect(screen.queryByTestId("orphan-comment-badge")).toBeNull();
  });

  it("carries the warning mark only once, from the icon (#318)", () => {
    render(
      <GlobalCommentBadges
        globalCount={0}
        orphanCount={3}
        onOpen={noop}
        onAddGlobal={noop}
      />
    );
    const badge = screen.getByTestId("orphan-comment-badge");
    expect(badge.textContent).not.toContain("⚠");
    expect(badge.querySelectorAll("svg")).toHaveLength(1);
  });

  it("opens the list when there are global comments, the composer when there are none", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onAddGlobal = vi.fn();
    const { rerender } = render(
      <GlobalCommentBadges
        globalCount={1}
        orphanCount={1}
        onOpen={onOpen}
        onAddGlobal={onAddGlobal}
      />
    );
    await user.click(screen.getByTestId("global-comment-badge"));
    expect(onOpen).toHaveBeenCalledWith("global");
    await user.click(screen.getByTestId("orphan-comment-badge"));
    expect(onOpen).toHaveBeenCalledWith("orphan");
    expect(onAddGlobal).not.toHaveBeenCalled();

    rerender(
      <GlobalCommentBadges
        globalCount={0}
        orphanCount={0}
        onOpen={onOpen}
        onAddGlobal={onAddGlobal}
      />
    );
    await user.click(screen.getByTestId("global-comment-badge"));
    expect(onAddGlobal).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
