import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/**
 * Verifies the fix for issue #20: opening a file via `setContent(..., {
 * emitUpdate: false })` must NOT fire onUpdate, even though TipTap's Markdown
 * roundtrip can produce a slightly normalized serialization that would
 * otherwise flag the file as dirty on first render.
 */

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("setContent emitUpdate behavior", () => {
  it("does not fire onUpdate when emitUpdate is false", () => {
    const onUpdate = vi.fn();
    editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Markdown.configure({
          transformPastedText: false,
          transformCopiedText: false,
        }),
      ],
      content: "",
      onUpdate,
    });

    onUpdate.mockClear();
    editor.commands.setContent("# Heading\n\nParagraph body.\n", {
      emitUpdate: false,
    });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("fires onUpdate when emitUpdate is true (default)", () => {
    const onUpdate = vi.fn();
    editor = new Editor({
      extensions: [
        StarterKit.configure({ link: false }),
        Markdown.configure({
          transformPastedText: false,
          transformCopiedText: false,
        }),
      ],
      content: "",
      onUpdate,
    });

    onUpdate.mockClear();
    editor.commands.setContent("# Heading\n\nParagraph body.\n");

    expect(onUpdate).toHaveBeenCalled();
  });
});
