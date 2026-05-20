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
  it("renders nested directories from the flat API response", async () => {
    const onSelect = vi.fn();
    renderWithClient(<Sidebar onSelect={onSelect} />);

    // Top-level dir + file are shown
    await waitFor(() => expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument());
    expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument();

    // Nested file under docs/api is shown (default expanded)
    expect(screen.getByTestId("sidebar-file-docs/api/spec.md")).toBeInTheDocument();
  });

  it("invokes onSelect with the full path when a file is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithClient(<Sidebar onSelect={onSelect} />);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("sidebar-file-docs/intro.md"));
    expect(onSelect).toHaveBeenCalledWith("docs/intro.md");
  });

  it("collapses a directory when its header is clicked", async () => {
    const user = userEvent.setup();
    renderWithClient(<Sidebar onSelect={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("sidebar-dir-docs")).toBeInTheDocument());
    expect(screen.getByTestId("sidebar-file-docs/intro.md")).toBeInTheDocument();

    await user.click(screen.getByTestId("sidebar-dir-docs"));
    expect(screen.queryByTestId("sidebar-file-docs/intro.md")).not.toBeInTheDocument();
  });
});
