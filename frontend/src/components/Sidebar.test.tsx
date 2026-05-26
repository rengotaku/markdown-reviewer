import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

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

/** Renders the URL search string so tests can assert URL state via the DOM. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc-search">{loc.search}</span>;
}

describe("Sidebar", () => {
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

  it("drops select_file from the URL when the filter input changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Sidebar onSelect={() => {}} />
        <LocationProbe />
      </>,
      "/?filter=do&select_file=docs/intro.md"
    );

    // Sanity: initial URL carries both params.
    expect(screen.getByTestId("loc-search").textContent).toContain(
      "select_file=docs/intro.md"
    );

    await user.type(screen.getByTestId("sidebar-filter"), "c");

    await waitFor(() => {
      const search = screen.getByTestId("loc-search").textContent ?? "";
      expect(search).not.toContain("select_file");
      expect(search).toContain("filter=doc");
    });
  });

  it("drops select_file from the URL when the filter is cleared", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Sidebar onSelect={() => {}} />
        <LocationProbe />
      </>,
      "/?filter=docs&select_file=docs/intro.md"
    );

    await user.click(screen.getByTestId("sidebar-filter-clear"));

    await waitFor(() => {
      const search = screen.getByTestId("loc-search").textContent ?? "";
      expect(search).not.toContain("select_file");
      expect(search).not.toContain("filter=");
    });
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
