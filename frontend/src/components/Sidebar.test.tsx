import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useUIStore } from "@/hooks/useUIStore";

function renderWithProviders(ui: React.ReactElement, initialPath = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    // The view mode lives in a module-level persisted store; reset it so a
    // previous test's "recent" selection doesn't leak into tree-mode tests.
    useUIStore.setState({ sidebarViewMode: "tree" });
  });

  it("renders only top-level entries (lazy-collapsed by default)", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<Sidebar onSelect={onSelect} />);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );
    expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument();

    // Nested entries under docs are NOT fetched until docs is expanded.
    expect(
      screen.queryByTestId("sidebar-file-docs/intro.md")
    ).not.toBeInTheDocument();
  });

  it("invokes onSelect with the full path when a file is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(<Sidebar onSelect={onSelect} />);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-README.md"));
    expect(onSelect).toHaveBeenCalledWith("README.md");
  });

  it("lazily loads child entries when a directory is expanded", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    expect(screen.getByTestId("sidebar-dir-docs/api")).toBeInTheDocument();

    await user.click(screen.getByTestId("sidebar-dir-docs"));
    expect(
      screen.queryByTestId("sidebar-file-docs/intro.md")
    ).not.toBeInTheDocument();
  });

  it("renders an empty filter input by default", () => {
    renderWithProviders(<Sidebar onSelect={() => {}} />);
    const input = screen.getByTestId("sidebar-filter") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("filter affects only top-level directories — non-matching dirs hide, files stay visible", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    const input = screen.getByTestId("sidebar-filter");
    await user.type(input, "doc");

    // "docs" dir matches → visible
    expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument();
    // Top-level file stays visible regardless of filter
    expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument();
  });

  it("filter does not affect children of expanded dirs", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />, "/?filter=doc");

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("sidebar-dir-docs"));

    // Children render unfiltered — `intro.md` does not contain "doc" but is shown.
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    // Sub-dir `api` also doesn't contain "doc" but is shown.
    expect(screen.getByTestId("sidebar-dir-docs/api")).toBeInTheDocument();
  });

  it("?filter=foo prefills the filter input on mount", () => {
    renderWithProviders(<Sidebar onSelect={() => {}} />, "/?filter=docs");
    const input = screen.getByTestId("sidebar-filter") as HTMLInputElement;
    expect(input.value).toBe("docs");
  });

  it("clear button resets the filter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />, "/?filter=docs");
    expect(
      (screen.getByTestId("sidebar-filter") as HTMLInputElement).value
    ).toBe("docs");

    await user.click(screen.getByTestId("sidebar-filter-clear"));
    expect(
      (screen.getByTestId("sidebar-filter") as HTMLInputElement).value
    ).toBe("");
  });

  it("shows a no-match note when filter matches no top-level dir (files still visible)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    await user.type(screen.getByTestId("sidebar-filter"), "zzz-no-match");
    await waitFor(() =>
      expect(screen.queryByTestId("sidebar-dir-docs")).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("sidebar-no-match")).toBeInTheDocument();
    // Files at top level remain visible regardless of filter.
    expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument();
  });
});

describe("Sidebar recent view (#68)", () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarViewMode: "tree" });
  });

  it("toggle switches between tree and recent list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    // Click the single toggle button to switch tree → recent.
    await user.click(screen.getByTestId("sidebar-view-mode"));
    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/intro.md")
      ).toBeInTheDocument()
    );
    // Tree entries are gone while the flat list is shown.
    expect(screen.queryByTestId("sidebar-dir-docs")).not.toBeInTheDocument();

    // Click again to switch recent → tree.
    await user.click(screen.getByTestId("sidebar-view-mode"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("sidebar-recent-file-docs/intro.md")
    ).not.toBeInTheDocument();
  });

  it("persists the chosen view mode via the UI store", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-view-mode"));
    expect(useUIStore.getState().sidebarViewMode).toBe("recent");

    const raw = localStorage.getItem("markdown-reviewer-ui");
    expect(raw).not.toBeNull();
    expect(
      (JSON.parse(raw as string) as { state: { sidebarViewMode: string } }).state
        .sidebarViewMode
    ).toBe("recent");
  });

  it("lists all files sorted by modified descending", async () => {
    useUIStore.setState({ sidebarViewMode: "recent" });
    renderWithProviders(<Sidebar onSelect={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/intro.md")
      ).toBeInTheDocument()
    );

    // MSW returns README(05-18) / intro(05-21) / spec(05-20) → newest first.
    const items = screen.getAllByTestId(/^sidebar-recent-file-/);
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "sidebar-recent-file-docs/intro.md",
      "sidebar-recent-file-docs/api/spec.md",
      "sidebar-recent-file-README.md",
    ]);
  });

  it("renders each entry as folder path + file name (root files show /)", async () => {
    useUIStore.setState({ sidebarViewMode: "recent" });
    renderWithProviders(<Sidebar onSelect={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/api/spec.md")
      ).toBeInTheDocument()
    );

    const nested = screen.getByTestId("sidebar-recent-file-docs/api/spec.md");
    expect(
      screen.getByTestId("sidebar-recent-dir-docs/api/spec.md")
    ).toHaveTextContent("docs/api");
    expect(nested).toHaveTextContent("spec.md");

    // Root-level file: the folder line falls back to "/".
    expect(
      screen.getByTestId("sidebar-recent-dir-README.md")
    ).toHaveTextContent("/");
  });

  it("invokes onSelect with the file path when a recent entry is clicked", async () => {
    useUIStore.setState({ sidebarViewMode: "recent" });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(<Sidebar onSelect={onSelect} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/intro.md")
      ).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-recent-file-docs/intro.md"));
    expect(onSelect).toHaveBeenCalledWith("docs/intro.md");
  });

  it("highlights the active file like the tree does", async () => {
    useUIStore.setState({ sidebarViewMode: "recent" });
    renderWithProviders(
      <Sidebar activePath="docs/intro.md" onSelect={() => {}} />
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/intro.md")
      ).toBeInTheDocument()
    );

    expect(screen.getByTestId("sidebar-recent-file-docs/intro.md")).toHaveClass(
      "Mui-selected"
    );
    expect(
      screen.getByTestId("sidebar-recent-file-README.md")
    ).not.toHaveClass("Mui-selected");
  });

  it("filters the flat list by partial path match", async () => {
    useUIStore.setState({ sidebarViewMode: "recent" });
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/intro.md")
      ).toBeInTheDocument()
    );

    // Matches path segments, not just the file name.
    await user.type(screen.getByTestId("sidebar-filter"), "api");
    await waitFor(() =>
      expect(
        screen.queryByTestId("sidebar-recent-file-docs/intro.md")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByTestId("sidebar-recent-file-docs/api/spec.md")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("sidebar-recent-file-README.md")
    ).not.toBeInTheDocument();
  });

  it("shows a no-match note when the filter matches no file", async () => {
    useUIStore.setState({ sidebarViewMode: "recent" });
    const user = userEvent.setup();
    renderWithProviders(<Sidebar onSelect={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-recent-file-docs/intro.md")
      ).toBeInTheDocument()
    );

    await user.type(screen.getByTestId("sidebar-filter"), "zzz-no-match");
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-no-match")).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("sidebar-recent-file-docs/intro.md")
    ).not.toBeInTheDocument();
  });
});
