import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { SummaryItem } from "@/api";
import { AgentSummaryButton } from "./AgentSummaryButton";

const make = (id: string, text: string): SummaryItem => ({
  id,
  sent_at: "2026-10-29T01:00:00Z",
  done_at: "2026-10-29T01:02:05Z",
  agent_id: "claude",
  session_name: "unit-a",
  text,
});

const newest = make(
  "s-2",
  "## 二回目\n\nc-001 と c-009 を直した\n\n<img src=x onerror=alert(1)>\n\n- 項目"
);
const older = make("s-1", "一回目の返信");

function setup(over: Partial<React.ComponentProps<typeof AgentSummaryButton>> = {}) {
  const props = {
    summaries: [newest, older],
    lastSeenId: "s-1",
    busySince: null,
    commentIds: new Set(["c-001"]),
    onOpen: vi.fn(),
    onShowComment: vi.fn(),
    ...over,
  };
  render(<AgentSummaryButton {...props} />);
  return props;
}

describe("AgentSummaryButton", () => {
  it("renders nothing without summaries", () => {
    const { container } = render(
      <AgentSummaryButton
        summaries={[]}
        lastSeenId={null}
        busySince={null}
        commentIds={new Set()}
        onOpen={vi.fn()}
        onShowComment={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the unread count as a badge", () => {
    setup();
    expect(screen.getByTestId("agent-summary-badge")).toHaveTextContent("1");
    expect(
      screen.getByRole("button", { name: "作業の要約（未読 1 件）" })
    ).toBeInTheDocument();
  });

  it("has no badge when everything was read", () => {
    setup({ lastSeenId: "s-2" });
    expect(screen.queryByTestId("agent-summary-badge")).toBeNull();
  });

  it("opens the list, marks read, and keeps the unread chip for this visit", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("agent-summary-button"));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    const rows = screen.getAllByTestId("agent-summary-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("二回目");
    expect(rows[0]).toHaveTextContent("→");
    expect(rows[0]).toHaveTextContent("（2:05）");
    expect(within(rows[0]).getByTestId("agent-summary-unread-chip")).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId("agent-summary-unread-chip")).toBeNull();
  });

  it("puts a working row first while busy", () => {
    setup({ busySince: Date.now() });
    fireEvent.click(screen.getByTestId("agent-summary-button"));
    expect(screen.getByTestId("agent-summary-working")).toBeInTheDocument();
  });

  it("goes list -> detail -> list via the back button and Escape", () => {
    setup();
    fireEvent.click(screen.getByTestId("agent-summary-button"));
    fireEvent.click(screen.getAllByTestId("agent-summary-row")[0]);
    expect(screen.getByTestId("agent-summary-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-summary-list")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "← 一覧" }));
    expect(screen.getByTestId("agent-summary-list")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId("agent-summary-row")[0]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByTestId("agent-summary-list")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-summary-detail")).toBeNull();
  });

  it("renders Markdown but never raw HTML", () => {
    setup();
    fireEvent.click(screen.getByTestId("agent-summary-button"));
    fireEvent.click(screen.getAllByTestId("agent-summary-row")[0]);
    const body = screen.getByTestId("agent-summary-body");
    expect(body.querySelector("h2")).toHaveTextContent("二回目");
    expect(body.querySelector("li")).toHaveTextContent("項目");
    expect(body.querySelector("img")).toBeNull();
    expect(body.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("lists only existing comment ids as chips and jumps on click", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("agent-summary-button"));
    fireEvent.click(screen.getAllByTestId("agent-summary-row")[0]);
    const chips = screen.getAllByTestId("agent-summary-comment-chip");
    expect(chips.map((c) => c.textContent)).toEqual(["c-001"]);
    fireEvent.click(chips[0]);
    expect(props.onShowComment).toHaveBeenCalledWith("c-001");
  });
});
