import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import App from "./App";
import { useOpenFiles } from "@/hooks/useOpenFiles";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
  });

  it("renders the editor at /", async () => {
    render(<App />);
    // EditorPage shows a placeholder in the header when no file is selected.
    await waitFor(() => {
      expect(screen.getByTestId("editor-active-path")).toHaveTextContent(
        "ファイルが選択されていません"
      );
    });
  });

  it("renders the sidebar header from /api/config", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("sidebar-review-root")).toHaveTextContent("mock-root");
    });
  });

  it("translates a legacy ?root=&select_file= deeplink into /{root}/{path}, carrying over every other query param (#236 codex review round 2)", async () => {
    // filter is an arbitrary "not root/select_file" param — stands in for
    // any current or future param RootRedirect doesn't itself know about.
    window.history.pushState(
      null,
      "",
      "/?filter=docs&root=mock-root&select_file=README.md"
    );
    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/mock-root/README.md");
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("filter")).toBe("docs");
    expect(params.has("root")).toBe(false);
    expect(params.has("select_file")).toBe(false);
  });
});
