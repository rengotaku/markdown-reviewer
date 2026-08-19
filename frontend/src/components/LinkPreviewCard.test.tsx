import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { LinkPreviewCard } from "./LinkPreviewCard";

const API_BASE = "http://localhost:8080";

function anchorEl(): HTMLAnchorElement {
  const a = document.createElement("a");
  document.body.appendChild(a);
  return a;
}

describe("LinkPreviewCard", () => {
  it("shows a loading spinner then the rendered body", async () => {
    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
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

  it("does not render when anchorEl is null", () => {
    render(
      <LinkPreviewCard
        open
        anchorEl={null}
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    expect(screen.queryByText("docs/intro.md")).not.toBeInTheDocument();
  });

  it("shows an error message when the fetch fails", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({ error: "not found" }, { status: 404 })
      )
    );

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="missing.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
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
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
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
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={onOpen}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-open")).not.toBeDisabled()
    );
    await user.click(screen.getByTestId("link-preview-open"));
    expect(onOpen).toHaveBeenCalledWith("docs/intro.md");
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={onClose}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    await user.click(screen.getByTestId("link-preview-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed while open", async () => {
    const onClose = vi.fn();

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={onClose}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("opens an internal link resolved against the previewed file's path instead of navigating (#215 follow-up)", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "docs/design.md",
          root: "mock-root",
          content: "# Design\n\nSee [glossary](./glossary.md).\n",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
        })
      )
    );
    const onOpen = vi.fn();

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/design.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={onOpen}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    const link = screen.getByRole("link", { name: "glossary" });
    const event = fireEvent.click(link);
    expect(event).toBe(false); // preventDefault() was called
    expect(onOpen).toHaveBeenCalledWith("docs/glossary.md");
  });

  it("opens an external link in a new tab instead of navigating the app away", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "docs/design.md",
          root: "mock-root",
          content: "# Design\n\nSee [external](https://example.com/page).\n",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
        })
      )
    );
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/design.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    const link = screen.getByRole("link", { name: "external" });
    const event = fireEvent.click(link);
    expect(event).toBe(false); // preventDefault() was called
    expect(windowOpenSpy).toHaveBeenCalledWith(
      "https://example.com/page",
      "_blank",
      "noopener,noreferrer"
    );

    windowOpenSpy.mockRestore();
  });

  it("does nothing when a page-internal anchor (#...) is clicked", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "docs/design.md",
          root: "mock-root",
          content: "# Design\n\nSee [heading](#some-heading).\n",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
        })
      )
    );
    const onOpen = vi.fn();
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/design.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={onOpen}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    const link = screen.getByRole("link", { name: "heading" });
    const event = fireEvent.click(link);
    expect(event).toBe(false); // preventDefault() was called
    expect(onOpen).not.toHaveBeenCalled();
    expect(windowOpenSpy).not.toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  it("calls onMouseEnter/onMouseLeave for the stay area (#215)", async () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    const card = screen.getByTestId("link-preview-content").closest(
      '[class*="MuiPaper"]'
    ) as HTMLElement;
    fireEvent.mouseEnter(card);
    expect(onMouseEnter).toHaveBeenCalled();
    fireEvent.mouseLeave(card);
    expect(onMouseLeave).toHaveBeenCalled();
  });

  it("marks external links but not internal/anchor links (#215 external-link icon)", async () => {
    server.use(
      http.get(`${API_BASE}/api/files/*`, () =>
        HttpResponse.json({
          path: "docs/intro.md",
          root: "mock-root",
          content:
            "# docs/intro.md\n\n" +
            "[ext](https://example.com/page) " +
            "[sibling](./sibling.md) " +
            "[anchor](#heading)",
          modified: "2026-05-20T00:00:00Z",
          created: "2026-05-19T00:00:00Z",
          state: "draft",
        })
      )
    );

    render(
      <LinkPreviewCard
        open
        anchorEl={anchorEl()}
        path="docs/intro.md"
        root="mock-root"
        onClose={vi.fn()}
        onOpen={vi.fn()}
        onMouseEnter={vi.fn()}
        onMouseLeave={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("link-preview-content")).toBeInTheDocument()
    );
    const content = screen.getByTestId("link-preview-content");
    const links = Array.from(content.querySelectorAll("a"));
    const byText = (text: string) =>
      links.find((a) => a.textContent === text);

    expect(byText("ext")?.classList.contains("cm-link-external")).toBe(true);
    expect(byText("sibling")?.classList.contains("cm-link-external")).toBe(
      false
    );
    expect(byText("anchor")?.classList.contains("cm-link-external")).toBe(
      false
    );
  });
});
