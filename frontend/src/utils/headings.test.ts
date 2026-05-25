import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import {
  collectHeadings,
  decodeSections,
  encodeSections,
} from "./headings";

function createEditor(content = ""): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown.configure({
        transformPastedText: false,
        transformCopiedText: false,
      }),
    ],
    content,
  });
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("collectHeadings", () => {
  it("returns [] when editor is null or destroyed", () => {
    expect(collectHeadings(null)).toEqual([]);
    editor = createEditor("# Title");
    editor.destroy();
    expect(collectHeadings(editor)).toEqual([]);
    editor = null;
  });

  it("collects H1 and H2 by default in document order", () => {
    editor = createEditor(
      "# Top\n\nIntro paragraph.\n\n## Section A\n\nText.\n\n### Skipped\n\n## Section B\n"
    );
    const result = collectHeadings(editor);
    expect(result.map((h) => ({ level: h.level, text: h.text }))).toEqual([
      { level: 1, text: "Top" },
      { level: 2, text: "Section A" },
      { level: 2, text: "Section B" },
    ]);
  });

  it("supports a custom level filter", () => {
    editor = createEditor("# T\n\n## A\n\n### Deep");
    const result = collectHeadings(editor, [1, 2, 3]);
    expect(result.map((h) => h.text)).toEqual(["T", "A", "Deep"]);
  });

  it("trims surrounding whitespace from heading text", () => {
    editor = createEditor("##   spaced heading   ");
    expect(collectHeadings(editor)[0].text).toBe("spaced heading");
  });
});

describe("encodeSections / decodeSections", () => {
  it("encodes a list as newline-joined string and round-trips", () => {
    const sections = ["Problem", "Try", "Action"];
    const encoded = encodeSections(sections);
    expect(encoded).toBe("Problem\nTry\nAction");
    expect(decodeSections(encoded)).toEqual(sections);
  });

  it("drops empty / whitespace-only entries on encode", () => {
    expect(encodeSections(["", "  ", "A", "B"])).toBe("A\nB");
  });

  it("returns [] for empty input on decode", () => {
    expect(decodeSections("")).toEqual([]);
  });
});
