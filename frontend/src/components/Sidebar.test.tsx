import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Sidebar", () => {
  it("renders only top-level entries (lazy-collapsed by default)", async () => {
    const onSelect = vi.fn();
    renderWithClient(<Sidebar onSelect={onSelect} />);

    await waitFor(() => expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument());
    expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument();

    // Nested file under docs is NOT fetched until docs is expanded.
    expect(screen.queryByTestId("sidebar-file-docs/intro.md")).not.toBeInTheDocument();
  });

  it("invokes onSelect with the full path when a file is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithClient(<Sidebar onSelect={onSelect} />);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-README.md"));
    expect(onSelect).toHaveBeenCalledWith("README.md");
  });

  it("lazily loads child entries when a directory is expanded", async () => {
    const user = userEvent.setup();
    renderWithClient(<Sidebar onSelect={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument());

    // Expand `docs/` → children fetched and rendered.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );
    expect(screen.getByTestId("sidebar-dir-docs/api")).toBeInTheDocument();

    // Collapse → children hidden.
    await user.click(screen.getByTestId("sidebar-dir-docs"));
    expect(screen.queryByTestId("sidebar-file-docs/intro.md")).not.toBeInTheDocument();
  });
});
