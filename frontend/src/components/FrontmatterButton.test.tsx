import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  act,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
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

  it("names the button with the entry count", () => {
    openFile("---\ntitle: A\nstatus: draft\ntags: [x, y]\n---\n# A\n");
    render(<FrontmatterButton />);
    expect(
      screen.getByRole("button", { name: "frontmatter を表示（3 項目）" })
    ).toBeInTheDocument();
  });

  it("stays closed when frontmatter is removed and added back while open", async () => {
    const user = userEvent.setup();
    openFile("---\ntitle: A\n---\n# A\n");
    render(<FrontmatterButton />);
    await user.click(screen.getByTestId("editor-frontmatter-button"));
    await screen.findByTestId("frontmatter-dialog");

    act(() => useOpenFiles.getState().updateActiveMarkdown("rooms", "# A\n"));
    expect(screen.queryByTestId("editor-frontmatter-button")).not.toBeInTheDocument();

    act(() =>
      useOpenFiles.getState().updateActiveMarkdown("rooms", "---\ntitle: B\n---\n# A\n")
    );
    expect(screen.getByTestId("editor-frontmatter-button")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("frontmatter-dialog")).not.toBeInTheDocument()
    );
  });

  it("closes when another file becomes active", async () => {
    const user = userEvent.setup();
    openFile("---\ntitle: A\n---\n# A\n");
    render(<FrontmatterButton />);
    await user.click(screen.getByTestId("editor-frontmatter-button"));
    await screen.findByTestId("frontmatter-dialog");

    act(() =>
      useOpenFiles
        .getState()
        .addFiles([{ name: "b.md", root: "rooms", markdown: "---\ntitle: B\n---\n# B\n" }])
    );
    await waitFor(() =>
      expect(screen.queryByTestId("frontmatter-dialog")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("editor-frontmatter-button")).toBeInTheDocument();
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
