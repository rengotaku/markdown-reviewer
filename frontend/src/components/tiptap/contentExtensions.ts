import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { MarkdownText, RawHtml, RawHtmlBlock } from "./extensions/RawHtml";
import { MermaidBlock } from "./extensions/MermaidBlock";
import { createCodeLowlight } from "./extensions/codeHighlight";
import { MarkdownLink } from "./extensions/MarkdownLink";

const codeLowlight = createCodeLowlight();

/**
 * contentExtensions returns the extensions that decide how a Markdown file is
 * parsed into the ProseMirror document — the schema and the Markdown
 * parse/serialize rules — and nothing that only affects interaction or
 * decoration.
 *
 * The editor and the anchor conformance test (#404) both build from this
 * list. Anchors are authored from this document's text, and the backend has
 * to resolve them against the raw file, so the test must parse exactly the way
 * the editor does; keeping one list is what stops the two from drifting.
 */
export function contentExtensions(): AnyExtension[] {
  return [
    // codeBlock comes from CodeBlockLowlight instead of StarterKit (#198):
    // same node name and markdown round-trip, plus per-token spans that the
    // stylesheet colours. Registering it twice would throw on duplicate node
    // names, hence the StarterKit opt-out.
    // `text` comes from MarkdownText instead (#297): same node, plus a
    // serializer that writes `<` / `>` as themselves.
    StarterKit.configure({ link: false, codeBlock: false, text: false }),
    MarkdownText,
    // Raw HTML in the file is kept as its source and written back as is
    // (#297), instead of being dropped or turned into other nodes.
    RawHtml,
    RawHtmlBlock,
    CodeBlockLowlight.configure({ lowlight: codeLowlight }),
    MarkdownLink.configure({
      openOnClick: true,
      autolink: true,
      linkOnPaste: true,
    }),
    Markdown.configure({
      // Render a bare `https://…` in the source as a link (#274). Round-trip
      // safety for that is MarkdownLink's job.
      linkify: true,
      transformPastedText: true,
      transformCopiedText: false,
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    MermaidBlock,
  ];
}
