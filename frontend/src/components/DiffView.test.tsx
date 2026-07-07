import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
