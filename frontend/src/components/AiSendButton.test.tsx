import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiSendButton } from "./AiSendButton";
import type { AgentStatusResponse } from "@/api";

function setup(
  status: AgentStatusResponse | null,
  extra: Partial<React.ComponentProps<typeof AiSendButton>> = {}
) {
  const onSend = vi.fn();
  const onShowReplies = vi.fn();
  render(
    <AiSendButton
      status={status}
      busySince={null}
      newReplyCount={0}
      onSend={onSend}
      onShowReplies={onShowReplies}
      {...extra}
    />
  );
  return { onSend, onShowReplies };
}

const send = () => screen.getByTestId("editor-copy-review-command");

describe("AiSendButton (#390)", () => {
  it("has no text; aria-label and tooltip carry 'AI へ送信' and the state", async () => {
    setup({ state: "idle", agent_id: "claude", session_name: "s" });
    expect(send()).toHaveAccessibleName("AI へ送信");
    expect(send()).toHaveTextContent("");
    fireEvent.mouseOver(send());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "AI へ送信（Claude 待機中）"
    );
  });

  it("ties the state and the copy fallback to the button as its description", () => {
    setup({ state: "none" });
    expect(send()).toHaveAccessibleDescription(
      "コマンドをコピー（送信先のセッションが見つかりません）"
    );
  });

  it("hides the new-reply badge while the state is unknown", () => {
    setup(null, { newReplyCount: 2, busySince: 1 });
    expect(screen.queryByTestId("editor-agent-new-replies")).not.toBeInTheDocument();
  });

  it("says a background AI can still be sent to", async () => {
    setup({ state: "background", agent_id: "claude" });
    fireEvent.mouseOver(send());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "AI へ送信（Claude 裏で処理中。送信できます）"
    );
  });

  it("draws no state dot", () => {
    setup({ state: "idle", agent_id: "claude" });
    expect(screen.queryByTestId("editor-agent-status-placeholder")).toBeNull();
    // The live region stays for screen readers, visually hidden.
    expect(screen.getByTestId("editor-agent-status")).toHaveTextContent("Claude 待機中");
  });

  it("swaps the send icon for a spinner while busy, with elapsed time and sent count in the tooltip", async () => {
    setup(
      { state: "busy", agent_id: "claude" },
      { busySince: Date.now() - 42_000, sentCount: 3 }
    );
    expect(screen.getByTestId("editor-send-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-send-icon")).toBeNull();
    // The ticking timer stays out of the live region.
    expect(screen.getByTestId("editor-agent-status")).not.toHaveTextContent(/0:4[23]/);
    expect(screen.getByTestId("editor-agent-sent-count")).toHaveTextContent("送信 3 件");
    fireEvent.mouseOver(send());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      /AI へ送信（Claude 返信中 0:4[23] · 送信 3 件。いま押すとコマンドのコピー）/
    );
  });

  it("shows a green count badge that is its own button: it moves to the replies, the send button sends", () => {
    const { onSend, onShowReplies } = setup(
      { state: "idle", agent_id: "claude" },
      { newReplyCount: 2 }
    );
    const badge = screen.getByTestId("editor-agent-new-replies");
    expect(badge).toHaveTextContent("2");
    expect(badge).toHaveAccessibleName("新しい返信 2 件（押すと最初の返信へ移動）");
    // Not nested inside the send button.
    expect(send().contains(badge)).toBe(false);

    fireEvent.click(badge);
    expect(onShowReplies).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledOnce();
    expect(onShowReplies).toHaveBeenCalledOnce();
  });

  it("is outlined and still copies the command when no session is found", async () => {
    const { onSend } = setup({ state: "none" });
    expect(send()).toHaveClass("MuiButton-outlined");
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledOnce();
    fireEvent.mouseOver(send());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "コマンドをコピー（送信先のセッションが見つかりません）"
    );
  });

  it("is filled when a session exists", () => {
    setup({ state: "idle", agent_id: "claude" });
    expect(send()).toHaveClass("MuiButton-contained");
  });
});
