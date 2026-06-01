import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import { CommentSidePane } from "./CommentSidePane";
import type { CollectedComment } from "@/utils/collectComments";

// Replace the real comment collector with a stub so we don't need a full TipTap
// editor instance. CommentMark integration is covered by CommentMark.test.ts.
vi.mock("@/utils/collectComments", async () => {
  return {
    collectComments: (editor: unknown) => {
      const fake = editor as { __comments?: CollectedComment[] } | null;
      return fake?.__comments ?? [];
    },
  };
});

interface FakeEditor {
  __comments: CollectedComment[];
  view: { dom: HTMLElement };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  chain: ReturnType<typeof vi.fn>;
}

function makeFakeEditor(
  comments: CollectedComment[],
  dom?: HTMLElement
): FakeEditor {
  const root = dom ?? document.createElement("div");
  return {
    __comments: comments,
    view: { dom: root },
    on: vi.fn(),
    off: vi.fn(),
    chain: vi.fn(),
  };
}

function asEditor(e: FakeEditor): Editor {
  return e as unknown as Editor;
}

const sampleComment = (
  id: string,
  overrides: Partial<CollectedComment> = {}
): CollectedComment => ({
  id,
  author: "alice",
  date: "2026-05-20",
  target: "selected text",
  body: `body of ${id}`,
  scope: "inline",
  groupId: "",
  from: 1,
  to: 10,
  ...overrides,
});

describe("CommentSidePane", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an empty-state message when editor is null", () => {
    render(<CommentSidePane editor={null} onDelete={() => {}} />);

    expect(
      screen.getByText(
        "コメントはまだありません。テキストを選択して「コメント」を押すと追加できます。"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Comments (0)")).toBeInTheDocument();
    expect(screen.queryByTestId("comment-item")).not.toBeInTheDocument();
  });

  it("renders an empty-state message when editor has no comment marks", () => {
    const editor = makeFakeEditor([]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);

    expect(
      screen.getByText(
        "コメントはまだありません。テキストを選択して「コメント」を押すと追加できます。"
      )
    ).toBeInTheDocument();
  });

  it("renders each collected comment with its body, target, and date", () => {
    const editor = makeFakeEditor([
      sampleComment("c1", { body: "first body", target: "first target" }),
      sampleComment("c2", { body: "second body", target: "second target" }),
    ]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);

    expect(screen.getByText("Comments (2)")).toBeInTheDocument();
    const items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(2);
    expect(screen.getByText("first body")).toBeInTheDocument();
    expect(screen.getByText("second body")).toBeInTheDocument();
    expect(screen.getByText("対象: first target")).toBeInTheDocument();
    expect(screen.getByText("対象: second target")).toBeInTheDocument();
  });

  it("subscribes to editor update/transaction events and unsubscribes on unmount", () => {
    const editor = makeFakeEditor([sampleComment("c1")]);
    const { unmount } = render(
      <CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />
    );

    const events = editor.on.mock.calls.map((c) => c[0]);
    expect(events).toContain("update");
    expect(events).toContain("transaction");

    unmount();

    const offEvents = editor.off.mock.calls.map((c) => c[0]);
    expect(offEvents).toContain("update");
    expect(offEvents).toContain("transaction");
  });

  it("calls onDelete with the comment id when the delete button is clicked", () => {
    const onDelete = vi.fn();
    const editor = makeFakeEditor([sampleComment("c1"), sampleComment("c2")]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={onDelete} />);

    const buttons = screen.getAllByTestId("comment-delete");
    fireEvent.click(buttons[1]);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("c2");
  });

  it("flashes [data-comment-id] elements and removes the class after 1.6s", () => {
    vi.useFakeTimers();
    const dom = document.createElement("div");
    const markA = document.createElement("span");
    markA.setAttribute("data-comment-id", "c1");
    markA.scrollIntoView = vi.fn();
    const markB = document.createElement("span");
    markB.setAttribute("data-comment-id", "c1");
    markB.scrollIntoView = vi.fn();
    // A node for a different comment should be ignored.
    const other = document.createElement("span");
    other.setAttribute("data-comment-id", "c2");
    other.scrollIntoView = vi.fn();
    dom.append(markA, markB, other);

    const editor = makeFakeEditor(
      [sampleComment("c1"), sampleComment("c2")],
      dom
    );
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);

    // Click the first row (the c1 comment item).
    const item = screen.getAllByTestId("comment-item")[0];
    fireEvent.click(item);

    // Both c1 marks should now carry the flash class.
    expect(markA.classList.contains("is-flash")).toBe(true);
    expect(markB.classList.contains("is-flash")).toBe(true);
    expect(other.classList.contains("is-flash")).toBe(false);

    // After 1.6s the class is cleared.
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(markA.classList.contains("is-flash")).toBe(false);
    expect(markB.classList.contains("is-flash")).toBe(false);
  });

  it("flashes via keyboard (Enter / Space) on a focused comment row", async () => {
    const user = userEvent.setup();
    const dom = document.createElement("div");
    const mark = document.createElement("span");
    mark.setAttribute("data-comment-id", "c1");
    mark.scrollIntoView = vi.fn();
    dom.append(mark);
    const editor = makeFakeEditor([sampleComment("c1")], dom);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);

    const item = screen.getByTestId("comment-item");
    item.focus();
    await user.keyboard("{Enter}");
    expect(mark.classList.contains("is-flash")).toBe(true);

    mark.classList.remove("is-flash");
    await user.keyboard(" ");
    expect(mark.classList.contains("is-flash")).toBe(true);
  });

  it("renders the section list for a cross-section comment via decodeSections", () => {
    const editor = makeFakeEditor([
      sampleComment("x1", {
        scope: "cross-section",
        target: "Problem\nTry\nAction",
        body: "連動で書き直し",
      }),
    ]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);
    expect(screen.getByTestId("comment-sections-x1")).toHaveTextContent(
      "対象: Problem ・ Try ・ Action"
    );
  });

  it("renders a scope badge for non-inline comments and omits it for inline ones", () => {
    const editor = makeFakeEditor([
      sampleComment("c1"),
      sampleComment("c2", { scope: "global", target: "" }),
      sampleComment("c3", { scope: "cross-section", target: "" }),
    ]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);

    expect(screen.queryByTestId("comment-scope-inline")).not.toBeInTheDocument();
    expect(screen.getByTestId("comment-scope-global")).toBeInTheDocument();
    expect(
      screen.getByTestId("comment-scope-cross-section")
    ).toBeInTheDocument();
  });

  it("highlights the row matching activeId via action.selected background", () => {
    const editor = makeFakeEditor([
      sampleComment("c1"),
      sampleComment("c2"),
    ]);
    render(
      <CommentSidePane
        editor={asEditor(editor)}
        onDelete={() => {}}
        activeId="c2"
      />
    );

    const items = screen.getAllByTestId("comment-item");
    expect(items[0].getAttribute("data-comment-id")).toBe("c1");
    expect(items[1].getAttribute("data-comment-id")).toBe("c2");
  });

  it("folds block comments sharing a groupId into a single cross-section entry", () => {
    const editor = makeFakeEditor([
      sampleComment("m1", {
        scope: "block",
        groupId: "g-cs-1",
        target: "メモ",
        body: "ここを統一して",
      }),
      sampleComment("m2", {
        scope: "block",
        groupId: "g-cs-1",
        target: "Body",
        body: "ここを統一して",
      }),
      sampleComment("plain", {
        scope: "block",
        target: "別件",
        body: "独立した block コメント",
      }),
    ]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={() => {}} />);

    // 3 underlying comments collapse into 2 displayed rows (group + plain).
    const items = screen.getAllByTestId("comment-item");
    expect(items).toHaveLength(2);

    // The grouped row carries the cross-section scope label with a (2) count.
    expect(items[0]).toHaveAttribute("data-comment-group-id", "g-cs-1");
    expect(screen.getByTestId("comment-scope-cross-section")).toHaveTextContent(
      /横断/
    );
    // Anchored heading texts are joined with ・ for readability.
    expect(screen.getByTestId("comment-sections-m1")).toHaveTextContent(
      "対象: メモ ・ Body"
    );

    // Header count reflects the displayed (grouped) total.
    expect(screen.getByText(/Comments \(2\)/)).toBeInTheDocument();
  });

  it("delete on a grouped row removes every member id", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const editor = makeFakeEditor([
      sampleComment("m1", { scope: "block", groupId: "g-cs-2", target: "A" }),
      sampleComment("m2", { scope: "block", groupId: "g-cs-2", target: "B" }),
      sampleComment("m3", { scope: "block", groupId: "g-cs-2", target: "C" }),
    ]);
    render(<CommentSidePane editor={asEditor(editor)} onDelete={onDelete} />);

    await user.click(screen.getByTestId("comment-delete"));

    expect(onDelete).toHaveBeenCalledTimes(3);
    expect(onDelete.mock.calls.map((c) => c[0])).toEqual(["m1", "m2", "m3"]);
  });
});
