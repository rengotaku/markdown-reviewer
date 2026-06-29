import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView } from "./DiffView";

describe("DiffView", () => {
  it("renders added and deleted lines with sign markers", () => {
    render(<DiffView oldText={"a\nb\nc"} newText={"a\nB\nc"} baseLabel="r-001" />);

    const view = screen.getByTestId("diff-view");
    const dels = view.querySelectorAll('[data-diff-type="del"]');
    const adds = view.querySelectorAll('[data-diff-type="add"]');
    expect(dels).toHaveLength(1);
    expect(adds).toHaveLength(1);
    expect(dels[0].textContent).toContain("b");
    expect(adds[0].textContent).toContain("B");
    expect(view.textContent).toContain("r-001");
  });

  it("shows a no-change note when texts are identical", () => {
    render(<DiffView oldText={"same\n"} newText={"same\n"} />);
    expect(screen.getByText(/変更なし/)).toBeInTheDocument();
    const view = screen.getByTestId("diff-view");
    expect(view.querySelectorAll('[data-diff-type="add"]')).toHaveLength(0);
    expect(view.querySelectorAll('[data-diff-type="del"]')).toHaveLength(0);
  });
});
