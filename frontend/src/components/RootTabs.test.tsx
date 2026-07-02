import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { RootTabs } from "./RootTabs";
import { useOpenFiles } from "@/hooks/useOpenFiles";

// Mirrors the useActiveRoot test harness: /api/config is pre-seeded into the
// query cache so the tabs render synchronously, and MemoryRouter carries the
// ?root= state that useActiveRoot reads/writes.
function renderTabs(opts: { roots?: Array<{ name: string; path: string }> } = {}) {
  const roots = opts.roots ?? [
    { name: "works", path: "/tmp/works" },
    { name: "rooms", path: "/tmp/rooms" },
  ];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["config"], {
    review_root_name: roots[0]?.name ?? "",
    review_root: roots[0]?.path ?? "",
    review_roots: roots,
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <RootTabs />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("RootTabs", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it("renders nothing for a single-root setup", () => {
    renderTabs({ roots: [{ name: "solo", path: "/tmp/solo" }] });
    expect(screen.queryByTestId("root-tabs")).not.toBeInTheDocument();
  });

  it("renders one tab per configured root with the first selected", () => {
    renderTabs();
    expect(screen.getByTestId("root-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("root-tab-works")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("root-tab-rooms")).toHaveAttribute("aria-selected", "false");
  });

  it("switches the active root when another tab is clicked", async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByTestId("root-tab-rooms"));
    expect(screen.getByTestId("root-tab-rooms")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("root-tab-works")).toHaveAttribute("aria-selected", "false");
  });

  it("shows a dirty indicator only on roots with unsaved files", () => {
    useOpenFiles.getState().addFiles([
      { name: "a.md", root: "rooms", markdown: "# A" },
    ]);
    useOpenFiles.getState().updateActiveMarkdown("rooms", "# changed");
    renderTabs();

    const dirtyDot = screen.getByLabelText("unsaved changes");
    expect(screen.getByTestId("root-tab-rooms")).toContainElement(dirtyDot);
    expect(screen.getByTestId("root-tab-works")).not.toHaveTextContent("•");
  });
});
