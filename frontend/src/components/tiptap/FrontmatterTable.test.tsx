import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrontmatterTable } from "./FrontmatterTable";

describe("FrontmatterTable", () => {
  it("renders nothing when there are no entries", () => {
    const { container } = render(<FrontmatterTable entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders scalar, array, empty, null and object values", () => {
    render(
      <FrontmatterTable
        entries={[
          { key: "date", value: "2026-06-24" },
          { key: "tags", value: ["infra", "staging"] },
          { key: "empty", value: [] },
          { key: "missing", value: null },
          { key: "meta", value: { author: "alice", count: 3 } },
        ]}
      />
    );
    expect(screen.getByTestId("frontmatter-table")).toBeInTheDocument();
    expect(screen.getByText("date")).toBeInTheDocument();
    expect(screen.getByText("2026-06-24")).toBeInTheDocument();
    // array items become chips
    expect(screen.getByText("infra")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
    // empty array and null both render a dash
    expect(screen.getAllByText("—")).toHaveLength(2);
    // nested object renders its keys/values
    expect(screen.getByText("author:")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
