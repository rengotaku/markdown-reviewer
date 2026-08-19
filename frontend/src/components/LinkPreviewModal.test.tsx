import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { LinkPreviewModal } from "./LinkPreviewModal";

const API_BASE = "http://localhost:8080";

describe("LinkPreviewModal", () => {
  it("shows a loading spinner then the rendered body", async () => {
    render(
      <LinkPreviewModal
        open
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText("docs/intro.md")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    expect(screen.getByTestId("link-preview-content").textContent).toContain(
      "docs/intro.md"
    );
  });

  it("shows an error message when the fetch fails", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({ error: "not found" }, { status: 404 })
      )
    );

    render(
      <LinkPreviewModal
        open
        path="missing.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-error")).toBeInTheDocument()
    );
    // "Open" is disabled while there is no successfully-loaded content.
    expect(screen.getByTestId("link-preview-open")).toBeDisabled();
  });

  it("strips the AI hint and frontmatter before rendering", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          content:
            "<!-- markdown-reviewer\nhint\n-->\n---\ntitle: Hello\n---\n# Body\n\ntext\n",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
        })
      )
    );

    render(
      <LinkPreviewModal
        open
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    const content = screen.getByTestId("link-preview-content").textContent ?? "";
    expect(content).not.toContain("markdown-reviewer");
    expect(content).not.toContain("title: Hello");
    expect(content).toContain("Body");
  });

  it("calls onOpen with the path when the Open button is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(
      <LinkPreviewModal
        open
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={onOpen}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-open")).not.toBeDisabled()
    );
    await user.click(screen.getByTestId("link-preview-open"));
    expect(onOpen).toHaveBeenCalledWith("docs/intro.md");
  });

  it("calls onClose when the Close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <LinkPreviewModal
        open
        path="docs/intro.md"
        root="mock-root"
        onClose={onClose}
        onOpen={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    await user.click(screen.getByText("閉じる"));
    expect(onClose).toHaveBeenCalled();
  });
});
