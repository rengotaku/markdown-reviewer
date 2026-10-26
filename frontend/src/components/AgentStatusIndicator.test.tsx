import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentStatusIndicator } from "./AgentStatusIndicator";

describe("AgentStatusIndicator", () => {
  it("renders nothing until the state is known", () => {
    const { container } = render(
      <AgentStatusIndicator status={null} busySince={null} newReplyCount={0} onShowReplies={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [{ state: "none" as const }, "AI 未接続"],
    [{ state: "idle" as const, agent_id: "claude", session_name: "s" }, "Claude 待機中"],
    [{ state: "background" as const, agent_id: "claude" }, "Claude 裏で処理中"],
  ])("labels %o", (status, text) => {
    render(<AgentStatusIndicator status={status} busySince={null} newReplyCount={0} onShowReplies={vi.fn()} />);
    expect(screen.getByTestId("editor-agent-status")).toHaveTextContent(text);
  });

  it("shows elapsed time while busy, even with new replies", () => {
    render(
      <AgentStatusIndicator
        status={{ state: "busy", agent_id: "claude" }}
        busySince={Date.now() - 42_000}
        newReplyCount={2}
        onShowReplies={vi.fn()}
      />
    );
    expect(screen.getByTestId("editor-agent-status")).toHaveTextContent(/Claude 返信中 0:4[23]/);
    expect(screen.queryByTestId("editor-agent-new-replies")).toBeNull();
  });

  it("offers the new replies once the turn is over", () => {
    const onShow = vi.fn();
    render(
      <AgentStatusIndicator
        status={{ state: "idle", agent_id: "claude" }}
        busySince={null}
        newReplyCount={2}
        onShowReplies={onShow}
      />
    );
    const link = screen.getByTestId("editor-agent-new-replies");
    expect(link).toHaveTextContent("Claude の返信 2 件");
    fireEvent.click(link);
    expect(onShow).toHaveBeenCalledOnce();
  });
});
