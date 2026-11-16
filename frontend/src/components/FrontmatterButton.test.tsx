import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { FrontmatterButton } from "./FrontmatterButton";

vi.mock("@/hooks/useActiveRoot", () => ({
  useActiveRoot: () => ({ active: "rooms", roots: [], activePath: "" }),
}));

function openFile(markdown: string) {
  useOpenFiles.getState().addFiles([{ name: "a.md", root: "rooms", markdown }]);
}

describe("FrontmatterButton", () => {
  beforeEach(() => {
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it("renders nothing when the active file has no frontmatter", () => {
    openFile("# A\n\nbody");
    const { container } = render(<FrontmatterButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the entry count on the button", () => {
    openFile("---\ntitle: A\nstatus: draft\ntags: [x, y]\n---\n# A\n");
    render(<FrontmatterButton />);
    expect(screen.getByTestId("editor-frontmatter-button")).toBeInTheDocument();
    expect(screen.getByTestId("editor-frontmatter-count")).toHaveTextContent("3");
  });

  it("opens the table in a dialog and closes it", async () => {
    const user = userEvent.setup();
    openFile("---\ntitle: A\ntags: [x, y]\n---\n# A\n");
    render(<FrontmatterButton />);

    expect(screen.queryByTestId("frontmatter-dialog")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("editor-frontmatter-button"));

    const table = await screen.findByTestId("frontmatter-table");
    expect(table).toHaveTextContent("title");
    expect(table).toHaveTextContent("A");
    expect(screen.getByText("x")).toBeInTheDocument();

    await user.click(screen.getByTestId("frontmatter-dialog-close"));
    await waitForElementToBeRemoved(() => screen.queryByTestId("frontmatter-dialog"));
  });

  it("closes the dialog on Escape", async () => {
    const user = userEvent.setup();
    openFile("---\ntitle: A\n---\n# A\n");
    render(<FrontmatterButton />);
    await user.click(screen.getByTestId("editor-frontmatter-button"));
    await screen.findByTestId("frontmatter-dialog");
    await user.keyboard("{Escape}");
    await waitForElementToBeRemoved(() => screen.queryByTestId("frontmatter-dialog"));
  });
});
