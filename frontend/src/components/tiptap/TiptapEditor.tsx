import { useEffect, useRef, useMemo } from "react";
import Box from "@mui/material/Box";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
import { splitPreamble, parseFrontmatter } from "@/utils/frontmatter";
import { FrontmatterTable } from "./FrontmatterTable";
import { TableMenu } from "./toolbar/TableMenu";
import { SlashCommand } from "./extensions/SlashCommand";
import { MermaidBlock } from "./extensions/MermaidBlock";
import { MarkdownPaste } from "./extensions/MarkdownPaste";
import { CommentHighlight } from "./extensions/CommentHighlight";
import "./styles/editor.css";

function getEditorMarkdown(editor: { storage: unknown }): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

export function TiptapEditor() {
  const centered = useEditorPrefs((s) => s.centered);
  const { active: activeRoot } = useActiveRoot();
  const activeId = useOpenFiles((s) =>
    activeRoot ? (s.activeIdByRoot[activeRoot] ?? null) : null
  );
  const scrollToTopToken = useEditorInstance((s) => s.scrollToTopToken);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeReloadToken = useOpenFiles((s) => {
    const id = activeRoot ? s.activeIdByRoot[activeRoot] : null;
    const file = id ? s.files.find((f) => f.id === id) : undefined;
    return file ? file.reloadToken : 0;
  });
  const updateActiveMarkdown = useOpenFiles((s) => s.updateActiveMarkdown);
  const activeMarkdown = useOpenFiles((s) => {
    const id = activeRoot ? s.activeIdByRoot[activeRoot] : null;
    const file = id ? s.files.find((f) => f.id === id) : undefined;
    return file ? file.markdown : "";
  });
  const frontmatter = useMemo(
    () => parseFrontmatter(splitPreamble(activeMarkdown).frontmatterYaml),
    [activeMarkdown]
  );
  const lastLoadedKeyRef = useRef<string | null>(null);
  // Track the editor instance that recorded `lastLoadedKeyRef`. If TipTap
  // hands us a fresh editor (StrictMode dev unmount-remount, HMR, etc.) the
  // stale key would make us skip setContent on the new instance and the
  // user would see an empty editor until they switched tabs. Reset the
  // tracking ref when the editor identity changes.
  const lastLoadedEditorRef = useRef<unknown>(null);
  /**
   * The active file's non-editable preamble (AI hint + YAML frontmatter). It is
   * stripped before the body is loaded into the editor, then re-prepended to
   * the editor's markdown output so saving never drops or reorders it. Kept in
   * a ref so onUpdate can read the latest value without re-subscribing.
   */
  const preambleRef = useRef("");
  /**
   * Timestamp (ms) until which onUpdate should be ignored. setContent's
   * `emitUpdate: false` only suppresses the direct dispatch; extensions like
   * autolink fire follow-up transactions via appendTransaction that re-emit
   * onUpdate. Without this settle window, the post-load extension passes mark
   * the freshly-opened file dirty even though the user didn't edit. Issue #20.
   */
  const settleUntilRef = useRef(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Placeholder.configure({
        placeholder: "Start writing, or type / for commands...",
      }),
      Link.configure({ openOnClick: true, autolink: true, linkOnPaste: true }),
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: false,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      SlashCommand,
      MermaidBlock,
      MarkdownPaste,
      CommentHighlight,
    ],
    content: "",
    editable: true,
    onUpdate: ({ editor: ed }) => {
      if (!activeRoot) return;
      if (!useOpenFiles.getState().activeIdByRoot[activeRoot]) return;
      // Drop updates fired by post-setContent extension transactions
      // (e.g. autolink) so an untouched file isn't flagged dirty.
      if (Date.now() < settleUntilRef.current) return;
      // Re-attach the stripped preamble (AI hint + frontmatter) so the saved
      // markdown matches what was loaded and frontmatter is never lost.
      updateActiveMarkdown(activeRoot, preambleRef.current + getEditorMarkdown(ed));
    },
  });

  useEffect(() => {
    useEditorInstance.getState().setEditor(editor ?? null);
    return () => {
      useEditorInstance.getState().setEditor(null);
      editor?.destroy();
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    // A new editor instance must be re-populated even when activeId hasn't
    // changed (so the "loaded key" check below doesn't short-circuit on a
    // blank editor produced by StrictMode dev double-mount).
    if (lastLoadedEditorRef.current !== editor) {
      lastLoadedEditorRef.current = editor;
      lastLoadedKeyRef.current = null;
    }
    const key = activeId ? `${activeId}:${activeReloadToken}` : null;
    if (lastLoadedKeyRef.current === key) return;
    lastLoadedKeyRef.current = key;
    if (!activeId) return;
    const state = useOpenFiles.getState();
    const file = state.files.find((f) => f.id === activeId);
    if (file) {
      // Keep the non-editable preamble (AI hint + YAML frontmatter) out of the
      // editor — it has no schema for frontmatter and mangles `---` on
      // roundtrip. The preamble is surfaced as a read-only table instead and
      // re-prepended on save (see onUpdate).
      const { preamble, body } = splitPreamble(file.markdown);
      preambleRef.current = preamble;
      // emitUpdate: false → don't fire onUpdate for the programmatic load.
      // TipTap's Markdown roundtrip can produce a slightly normalized string
      // (e.g. trailing newline tweaks) which would otherwise set isDirty=true
      // immediately after opening a freshly-loaded file. See issue #20.
      editor.commands.setContent(body, { emitUpdate: false });
      // Open a settle window so post-setContent extension transactions
      // (autolink, etc.) don't slip past the suppression above.
      settleUntilRef.current = Date.now() + 250;
    }
  }, [editor, activeId, activeReloadToken]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      containerRef.current?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToTopToken]);

  return (
    <Box
      ref={containerRef}
      className={centered ? "editor-centered" : undefined}
      sx={{
        height: "100%",
        overflow: "auto",
        position: "relative",
        "& .ProseMirror": { minHeight: "100%" },
      }}
    >
      {editor && <TableMenu editor={editor} />}
      <FrontmatterTable entries={frontmatter} />
      <EditorContent editor={editor} />
    </Box>
  );
}
