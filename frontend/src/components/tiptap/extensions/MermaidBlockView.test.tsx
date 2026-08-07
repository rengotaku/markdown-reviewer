import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { EditorProvider } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { MermaidBlock } from "./MermaidBlock";

const renderMock = vi.fn(async (id: string) => ({
  svg: `<svg data-testid="diagram" id="${id}"></svg>`,
}));
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    get initialize() {
      return initializeMock;
    },
    get render() {
      return renderMock;
    },
  },
}));

const CODE = "graph TD\n    A[Start] --> B[End]";

let editor: Editor | null = null;

/**
 * Mounts a one-block document through EditorProvider — React node views need a
 * React-hosted editor, a plain `new Editor({ element })` never renders them.
 */
async function mount(code = CODE): Promise<Editor> {
  render(
    <EditorProvider
      extensions={[StarterKit.configure({ link: false }), MermaidBlock]}
      content={{ type: "doc", content: [{ type: "mermaidBlock", attrs: { code } }] }}
      onCreate={({ editor: ed }) => {
        editor = ed;
      }}
    />
  );
  await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
  await waitFor(() => expect(editor).not.toBeNull());
  return editor!;
}

function pmRoot(): HTMLElement {
  return document.querySelector(".ProseMirror") as HTMLElement;
}

function currentCode(ed: Editor): string {
  return ed.getJSON().content?.[0]?.attrs?.code as string;
}

beforeEach(() => {
  renderMock.mockClear();
  initializeMock.mockClear();
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("MermaidBlockView chart / source toggle", () => {
  it("renders the chart first and offers a switch to the source", async () => {
    editor = await mount();

    await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.any(String), CODE));
    expect(await screen.findByLabelText("show mermaid source")).toBeInTheDocument();
    expect(screen.queryByLabelText("mermaid source")).not.toBeInTheDocument();
  });

  it("shows the mermaid source when toggled, and the chart again on the way back", async () => {
    const user = userEvent.setup();
    editor = await mount();

    await user.click(await screen.findByLabelText("show mermaid source"));

    const textarea = screen.getByLabelText("mermaid source") as HTMLTextAreaElement;
    expect(textarea.value).toBe(CODE);

    await user.click(screen.getByLabelText("show mermaid chart"));

    await waitFor(() => expect(screen.queryByLabelText("mermaid source")).not.toBeInTheDocument());
    expect(screen.getByLabelText("show mermaid source")).toBeInTheDocument();
  });

  it("commits source edits back into the node when switching to the chart", async () => {
    const user = userEvent.setup();
    editor = await mount();

    await user.click(await screen.findByLabelText("show mermaid source"));
    await user.click(screen.getByLabelText("mermaid source"));
    // `[` / `]` are userEvent key syntax, so the appended line stays bracket-free.
    await user.keyboard("{End}{Enter}    B --> C2");
    await user.click(screen.getByLabelText("show mermaid chart"));

    await waitFor(() => expect(currentCode(editor!)).toContain("B --> C2"));
    await waitFor(() =>
      expect(renderMock).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.stringContaining("B --> C2")
      )
    );
  });

  it("sizes the source box to the diagram definition", async () => {
    const user = userEvent.setup();
    const long = Array.from({ length: 12 }, (_, i) => `    A${i} --> A${i + 1}`).join("\n");
    editor = await mount(`graph TD\n${long}`);

    await user.click(await screen.findByLabelText("show mermaid source"));

    const textarea = screen.getByLabelText("mermaid source") as HTMLTextAreaElement;
    expect(textarea.rows).toBe(13);
  });

  it("gives a one-line definition a readable minimum height", async () => {
    const user = userEvent.setup();
    editor = await mount("graph TD");

    await user.click(await screen.findByLabelText("show mermaid source"));

    expect((screen.getByLabelText("mermaid source") as HTMLTextAreaElement).rows).toBe(4);
  });

  it("keeps the node unchanged when the source is only viewed", async () => {
    const user = userEvent.setup();
    editor = await mount();

    await user.click(await screen.findByLabelText("show mermaid source"));
    await user.click(screen.getByLabelText("show mermaid chart"));

    expect(currentCode(editor)).toBe(CODE);
  });

  it("reports a mermaid parse failure in place of the chart", async () => {
    renderMock.mockRejectedValueOnce(new Error("Parse error on line 2"));
    editor = await mount("graph TD\n  A[[[--> ?");

    await waitFor(() =>
      expect(pmRoot().querySelector("pre")?.textContent).toBe("Parse error on line 2")
    );
    // The source is still reachable so the author can fix it.
    expect(screen.getByLabelText("show mermaid source")).toBeInTheDocument();
  });

  it("labels an empty diagram instead of rendering it", async () => {
    editor = await mount("");

    await waitFor(() => expect(pmRoot().textContent).toContain("Empty mermaid block"));
    expect(renderMock).not.toHaveBeenCalled();
  });
});
