import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { BlockCopyButton } from "./BlockCopyButton";
import { useToast } from "@/hooks/useToast";

let editor: Editor | null = null;
let container: HTMLDivElement | null = null;
const writeText = vi.fn<(text: string) => Promise<void>>(() =>
  Promise.resolve()
);

const CONTENT = [
  "```go",
  "func main() {}",
  "```",
  "",
  "本文の段落",
  "",
  "| 名前 | 役割 |",
  "| --- | --- |",
  "| alpha | 入口 |",
  "",
].join("\n");

beforeEach(() => {
  writeText.mockClear();
  useToast.setState({ toasts: [] });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  const element = document.createElement("div");
  container.appendChild(element);
  editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: "",
  });
  editor.commands.setContent(CONTENT, { emitUpdate: false });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  container?.remove();
  container = null;
});

function renderButton() {
  return render(
    <BlockCopyButton editor={editor!} containerRef={{ current: container }} />
  );
}

describe("BlockCopyButton (#198)", () => {
  it("appears on a code block and copies its text", async () => {
    renderButton();
    expect(screen.queryByTestId("block-copy-button")).not.toBeInTheDocument();

    const pre = editor!.view.dom.querySelector("pre") as HTMLElement;
    fireEvent.mouseOver(pre);

    const button = await screen.findByTestId("block-copy-button");
    expect(button).toHaveAttribute("data-block-kind", "code");

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("func main() {}");
  });

  it("switches to the table and copies it as markdown", async () => {
    renderButton();
    const cell = editor!.view.dom.querySelector("td") as HTMLElement;
    fireEvent.mouseOver(cell);

    const button = await screen.findByTestId("block-copy-button");
    expect(button).toHaveAttribute("data-block-kind", "table");

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("| alpha | 入口 |");
  });

  it("ignores a table that isn't part of the document (frontmatter panel)", async () => {
    // The frontmatter panel renders a real <table> in the same scrolling
    // container; offering to copy it would produce a button that can only fail.
    const panel = document.createElement("table");
    panel.innerHTML = "<tbody><tr><td id='fm'>title</td></tr></tbody>";
    container!.insertBefore(panel, container!.firstChild);

    renderButton();
    fireEvent.mouseOver(panel.querySelector("#fm") as HTMLElement);

    await waitFor(() =>
      expect(screen.queryByTestId("block-copy-button")).not.toBeInTheDocument()
    );
  });

  it("disappears when the pointer moves to plain prose", async () => {
    renderButton();
    const pre = editor!.view.dom.querySelector("pre") as HTMLElement;
    fireEvent.mouseOver(pre);
    await screen.findByTestId("block-copy-button");

    const paragraph = editor!.view.dom.querySelector("p") as HTMLElement;
    fireEvent.mouseOver(paragraph);

    await waitFor(() =>
      expect(screen.queryByTestId("block-copy-button")).not.toBeInTheDocument()
    );
  });

  it("reports a failed clipboard write instead of claiming success", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderButton();
    const pre = editor!.view.dom.querySelector("pre") as HTMLElement;
    fireEvent.mouseOver(pre);
    await screen.findByTestId("block-copy-button");

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      const toasts = useToast.getState().toasts;
      expect(toasts.some((t) => t.severity === "error")).toBe(true);
    });
  });
});
