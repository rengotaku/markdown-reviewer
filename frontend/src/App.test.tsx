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
});
