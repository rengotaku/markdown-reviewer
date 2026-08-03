import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { RootSelect } from "./RootSelect";
import { useOpenFiles } from "@/hooks/useOpenFiles";

// Mirrors the RootTabs test harness (pre-#158): /api/config is pre-seeded
// into the query cache so RootSelect renders synchronously, and MemoryRouter
// carries the ?root= state that useActiveRoot reads/writes.
function LocationProbe() {
  const [params] = useSearchParams();
  return <span data-testid="location-probe">{params.get("root") ?? ""}</span>;
}

function renderSelect(opts: { roots?: Array<{ name: string; path: string }> } = {}) {
  const roots = opts.roots ?? [
    { name: "works", path: "/tmp/works" },
    { name: "rooms", path: "/tmp/rooms" },
    { name: "reviews", path: "/tmp/reviews" },
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
        <RootSelect />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("RootSelect", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it("A1: renders a plain, non-interactive label for a single-root setup", () => {
    renderSelect({ roots: [{ name: "solo", path: "/tmp/solo" }] });
    const label = screen.getByTestId("sidebar-review-root");
    expect(label).toHaveTextContent("solo");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("root-select-menu")).not.toBeInTheDocument();
  });

  it("A2: renders a pressable header button for a multi-root setup", () => {
    renderSelect();
    const button = screen.getByTestId("sidebar-review-root");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveTextContent("works");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("A3: opens a menu listing every configured root", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByTestId("sidebar-review-root"));

    expect(screen.getByTestId("root-select-menu")).toBeInTheDocument();
    expect(screen.getByTestId("root-select-item-works")).toBeInTheDocument();
    expect(screen.getByTestId("root-select-item-rooms")).toBeInTheDocument();
    expect(screen.getByTestId("root-select-item-reviews")).toBeInTheDocument();
    // role="menuitem" は aria-selected をサポートしないため、現在のルートは
    // aria-current で伝える（事前設計仕様の aria-selected は誤りだった。#158
    // codex review で訂正）。
    expect(screen.getByTestId("root-select-item-works")).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByTestId("root-select-item-rooms")).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("A2b: announces a menu popup (matching MUI's role=menu), not a listbox", () => {
    renderSelect();
    expect(screen.getByTestId("sidebar-review-root")).toHaveAttribute(
      "aria-haspopup",
      "menu"
    );
  });

  it("A2c: keeps the active root name in the button's accessible name", () => {
    renderSelect();
    // 固定文言の aria-label は子テキスト（root 名）を上書きしてしまうため、
    // アクセシブル名に root 名が残っていることを固定する（#158 review round 2）。
    expect(
      screen.getByRole("button", { name: /works/ })
    ).toBe(screen.getByTestId("sidebar-review-root"));
  });

  it("A4: switches the active root and closes the menu when an item is clicked", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByTestId("sidebar-review-root"));
    await user.click(screen.getByTestId("root-select-item-rooms"));

    expect(screen.getByTestId("location-probe")).toHaveTextContent("rooms");
    expect(screen.getByTestId("sidebar-review-root")).toHaveTextContent("rooms");
    expect(screen.queryByTestId("root-select-menu")).not.toBeInTheDocument();
  });

  it("A5: shows a dirty indicator only on menu items with unsaved files", async () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: "rooms", markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown("rooms", "# changed");
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByTestId("sidebar-review-root"));

    expect(screen.getByTestId("root-select-item-rooms")).toHaveTextContent("•");
    expect(screen.getByTestId("root-select-item-works")).not.toHaveTextContent("•");
  });

  it("A6: shows a dirty indicator on the header button when another root has unsaved files", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: "rooms", markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown("rooms", "# changed");
    renderSelect();

    expect(screen.getByTestId("sidebar-review-root")).toHaveTextContent("•");
    // 視覚的な `•` だけでなくアクセシブル名にも載せる。ボタンの aria-label が
    // 子要素の aria-label を上書きするため（#158 review round 3）。
    expect(
      screen.getByRole("button", { name: /他の root に未保存の変更あり/ })
    ).toBe(screen.getByTestId("sidebar-review-root"));
  });

  it("A7: does not show a dirty indicator on the header button for the active root's own unsaved files", () => {
    useOpenFiles.getState().addFiles([{ name: "a.md", root: "works", markdown: "# A" }]);
    useOpenFiles.getState().updateActiveMarkdown("works", "# changed");
    renderSelect();

    expect(screen.getByTestId("sidebar-review-root")).not.toHaveTextContent("•");
  });

  it("A8: shows each root's absolute path in the menu", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByTestId("sidebar-review-root"));

    expect(screen.getByTestId("root-select-item-works")).toHaveTextContent("/tmp/works");
    expect(screen.getByTestId("root-select-item-rooms")).toHaveTextContent("/tmp/rooms");
    expect(screen.getByTestId("root-select-item-reviews")).toHaveTextContent(
      "/tmp/reviews"
    );
  });
});
