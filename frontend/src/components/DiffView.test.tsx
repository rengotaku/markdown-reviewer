import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffView } from "./DiffView";
import type { RevisionMeta } from "../api";

const revs: RevisionMeta[] = [
  { id: "r-001", ts: "2026-06-29T11:00:00+09:00", author: "ai" },
];

describe("DiffView", () => {
  it("renders added and deleted lines with sign markers", () => {
    render(
      <DiffView
        oldText={"a\nb\nc"}
        newText={"a\nB\nc"}
        revisions={revs}
        selectedRevId="r-001"
        onSelectRevision={vi.fn()}
      />
    );

    const view = screen.getByTestId("diff-view");
    const dels = view.querySelectorAll('[data-diff-type="del"]');
    const adds = view.querySelectorAll('[data-diff-type="add"]');
    expect(dels).toHaveLength(1);
    expect(adds).toHaveLength(1);
    expect(dels[0].textContent).toContain("b");
    expect(adds[0].textContent).toContain("B");
    // The baseline revision id is surfaced via the picker.
    expect(view.textContent).toContain("r-001");
  });

  it("shows a no-change note when texts are identical", () => {
    render(
      <DiffView
        oldText={"same\n"}
        newText={"same\n"}
        revisions={revs}
        selectedRevId="r-001"
        onSelectRevision={vi.fn()}
      />
    );
    expect(screen.getByText(/このバージョンと現在の内容に差分はありません/)).toBeInTheDocument();
    const view = screen.getByTestId("diff-view");
    expect(view.querySelectorAll('[data-diff-type="add"]')).toHaveLength(0);
    expect(view.querySelectorAll('[data-diff-type="del"]')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #88: author display + quick-select buttons
// ---------------------------------------------------------------------------

const multiRevs: RevisionMeta[] = [
  { id: "r-003", ts: "2026-07-01T10:00:00+09:00", author: "kishira" },
  { id: "r-002", ts: "2026-06-30T10:00:00+09:00", author: "external" },
  { id: "r-001", ts: "2026-06-29T10:00:00+09:00", author: "external" },
];

describe("DiffView – Issue #88 author display", () => {
  it('shows "外部編集" in the picker for author="external"', () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-002"
        onSelectRevision={vi.fn()}
      />
    );
    // MUI Select renders options in a listbox; open it first
    const picker = screen.getByTestId("diff-revision-picker");
    // The selected option text is rendered inside the Select trigger
    // For hidden options, check the DOM directly via getAllByRole after opening
    // — but MUI also renders MenuItem text in the select box for the selected value.
    // We verify the rendered text of all options by querying listitem-like nodes.
    // Simpler: the component renders MenuItem children in the DOM (even when closed,
    // MUI keeps them in a hidden list). We just check textContent of the picker.
    expect(picker.textContent).toContain("外部編集");
  });

  it("shows human author name in the picker for non-external author", () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-003"
        onSelectRevision={vi.fn()}
      />
    );
    const picker = screen.getByTestId("diff-revision-picker");
    expect(picker.textContent).toContain("kishira");
  });

  it("shows selected author in the header caption", () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-002"
        onSelectRevision={vi.fn()}
      />
    );
    // The selected-author caption should display "外部編集"
    const caption = screen.getByTestId("diff-selected-author");
    expect(caption.textContent).toContain("外部編集");
  });

  it("shows human name in the header caption for non-external author", () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-003"
        onSelectRevision={vi.fn()}
      />
    );
    const caption = screen.getByTestId("diff-selected-author");
    expect(caption.textContent).toContain("kishira");
  });
});

describe("DiffView – Issue #88 quick-select buttons", () => {
  it('「前ラウンド」ボタンクリックで onSelectRevision が revisions[0].id で呼ばれる', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-002"
        onSelectRevision={onSelect}
      />
    );
    const btn = screen.getByTestId("diff-btn-latest-round");
    await user.click(btn);
    expect(onSelect).toHaveBeenCalledWith("r-003"); // revisions[0].id
  });

  it('「初版」ボタンクリックで onSelectRevision が最古 id で呼ばれる', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-003"
        onSelectRevision={onSelect}
      />
    );
    const btn = screen.getByTestId("diff-btn-first");
    await user.click(btn);
    expect(onSelect).toHaveBeenCalledWith("r-001"); // revisions[last].id
  });

  it('revisions.length === 1 のとき「初版」ボタンは表示されない', () => {
    const singleRev: RevisionMeta[] = [
      { id: "r-001", ts: "2026-06-29T10:00:00+09:00", author: "kishira" },
    ];
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={singleRev}
        selectedRevId="r-001"
        onSelectRevision={vi.fn()}
      />
    );
    expect(screen.queryByTestId("diff-btn-first")).toBeNull();
    // 前ラウンドは表示される（ただし選択中なので disabled）
    expect(screen.getByTestId("diff-btn-latest-round")).toBeInTheDocument();
  });

  it("revisions が空のとき両ボタンとも表示されない", () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={[]}
        selectedRevId={null}
        onSelectRevision={vi.fn()}
      />
    );
    expect(screen.queryByTestId("diff-btn-latest-round")).toBeNull();
    expect(screen.queryByTestId("diff-btn-first")).toBeNull();
  });

  it("選択中が revisions[0] のとき「前ラウンド」ボタンは disabled になる", () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-003" // revisions[0].id
        onSelectRevision={vi.fn()}
      />
    );
    const btnLatest = screen.getByTestId("diff-btn-latest-round");
    expect(btnLatest).toBeDisabled();
  });

  it("選択中が revisions[last] のとき「初版」ボタンは disabled になる", () => {
    render(
      <DiffView
        oldText="old"
        newText="new"
        revisions={multiRevs}
        selectedRevId="r-001" // revisions[last].id
        onSelectRevision={vi.fn()}
      />
    );
    const btnFirst = screen.getByTestId("diff-btn-first");
    expect(btnFirst).toBeDisabled();
  });
});
