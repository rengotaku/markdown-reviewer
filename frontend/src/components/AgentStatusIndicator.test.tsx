import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentStatusIndicator } from "./AgentStatusIndicator";

describe("AgentStatusIndicator", () => {
  it("renders nothing until the state is known", () => {
    const { container } = render(
      <AgentStatusIndicator
        status={null}
        busySince={null}
        newReplyCount={0}
        onShowReplies={vi.fn()}
      />
    );
    // #379: the empty slot holds the dot's place so the header doesn't shift.
    expect(screen.getByTestId("editor-agent-status-placeholder")).toBeEmptyDOMElement();
    expect(screen.queryByTestId("editor-agent-status")).toBeNull();
    expect(container.childElementCount).toBe(1);
  });

  it.each([
    [{ state: "none" as const }, "AI 未接続"],
    [{ state: "idle" as const, agent_id: "claude", session_name: "s" }, "Claude 待機中"],
    [{ state: "background" as const, agent_id: "claude" }, "Claude 裏で処理中"],
  ])("labels %o", (status, text) => {
    render(
      <AgentStatusIndicator
        status={status}
        busySince={null}
        newReplyCount={0}
        onShowReplies={vi.fn()}
      />
    );
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
    const indicator = screen.getByTestId("editor-agent-status");
    expect(indicator).toHaveTextContent("Claude 返信中");
    // The ticking timer stays out of the live region's announcement; it shows
    // in the tooltip (#376).
    expect(indicator).not.toHaveTextContent(/0:4[23]/);
    expect(screen.queryByTestId("editor-agent-new-replies")).toBeNull();
  });

  it("shows how many comments the send handed over (#366)", () => {
    render(
      <AgentStatusIndicator
        status={{ state: "busy", agent_id: "claude" }}
        busySince={Date.now()}
        newReplyCount={0}
        sentCount={5}
        onShowReplies={vi.fn()}
      />
    );
    expect(screen.getByTestId("editor-agent-sent-count")).toHaveTextContent(
      "· 送信 5 件"
    );
  });

  it("leaves the count out when the busy period came from elsewhere", () => {
    render(
      <AgentStatusIndicator
        status={{ state: "busy", agent_id: "claude" }}
        busySince={Date.now()}
        newReplyCount={0}
        onShowReplies={vi.fn()}
      />
    );
    expect(screen.queryByTestId("editor-agent-sent-count")).toBeNull();
  });

  it("shows the words in the tooltip, not beside the dot (#376)", async () => {
    render(
      <AgentStatusIndicator
        status={{ state: "busy", agent_id: "claude", session_name: "s" }}
        busySince={Date.now() - 42_000}
        newReplyCount={0}
        sentCount={3}
        onShowReplies={vi.fn()}
      />
    );
    const indicator = screen.getByTestId("editor-agent-status");
    fireEvent.mouseOver(indicator);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/Claude 返信中 0:4[23] · 送信 3 件/);
    expect(tip).toHaveTextContent("送信先: s");
  });

  // The tooltip itself opens on :focus-visible, which jsdom can't evaluate;
  // that part is checked in a real browser.
  it("can be reached from the keyboard", async () => {
    render(
      <AgentStatusIndicator
        status={{ state: "idle", agent_id: "claude", session_name: "s" }}
        busySince={null}
        newReplyCount={0}
        onShowReplies={vi.fn()}
      />
    );
    const indicator = screen.getByTestId("editor-agent-status");
    expect(indicator).toHaveAttribute("tabindex", "0");
    await userEvent.setup().tab();
    expect(indicator).toHaveFocus();
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
    expect(link).toHaveAccessibleName("Claude の返信 2 件");
    fireEvent.click(link);
    expect(onShow).toHaveBeenCalledOnce();
  });
});
