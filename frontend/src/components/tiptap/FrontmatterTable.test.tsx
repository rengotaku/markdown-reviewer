import { describe, it, expect } from "vitest";
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
          { key: "meta", value: { author: "kishira", count: 3 } },
        ]}
      />
    );
    expect(screen.getByText("date")).toBeInTheDocument();
    expect(screen.getByText("2026-06-24")).toBeInTheDocument();
    // array items become chips
    expect(screen.getByText("infra")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
    // nested object renders its keys/values
    expect(screen.getByText("author:")).toBeInTheDocument();
    expect(screen.getByText("kishira")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("toggles the table visibility via the header button", async () => {
    const user = userEvent.setup();
    render(<FrontmatterTable entries={[{ key: "date", value: "2026-06-24" }]} />);

    // visible by default (unmountOnExit removes it from the DOM when collapsed)
    expect(screen.getByTestId("frontmatter-table")).toBeInTheDocument();

    const toggle = screen.getByTestId("frontmatter-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapse unmounts after its exit transition completes.
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId("frontmatter-table")
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("frontmatter-table")).toBeInTheDocument();
  });
});
