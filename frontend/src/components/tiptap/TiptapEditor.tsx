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
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { offset } from "@floating-ui/dom";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { Markdown } from "tiptap-markdown";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
import { TableMenu } from "./toolbar/TableMenu";
import { SlashCommand } from "./extensions/SlashCommand";
import { MermaidBlock } from "./extensions/MermaidBlock";
import { MarkdownPaste } from "./extensions/MarkdownPaste";
import { CommentMark } from "./extensions/CommentMark";
import { StandaloneCommentNode } from "./extensions/StandaloneComment";
import "./styles/editor.css";

function getEditorMarkdown(editor: { storage: unknown }): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

export function TiptapEditor() {
  const centered = useEditorPrefs((s) => s.centered);
  const activeId = useOpenFiles((s) => s.activeId);
  const scrollToTopToken = useEditorInstance((s) => s.scrollToTopToken);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeReloadToken = useOpenFiles((s) => {
    const file = s.files.find((f) => f.id === s.activeId);
    return file ? file.reloadToken : 0;
  });
  const updateActiveMarkdown = useOpenFiles((s) => s.updateActiveMarkdown);
  const lastLoadedKeyRef = useRef<string | null>(null);
  // Track the editor instance that recorded `lastLoadedKeyRef`. If TipTap
  // hands us a fresh editor (StrictMode dev unmount-remount, HMR, etc.) the
  // stale key would make us skip setContent on the new instance and the
  // user would see an empty editor until they switched tabs. Reset the
  // tracking ref when the editor identity changes.
  const lastLoadedEditorRef = useRef<unknown>(null);
  const dragHandleBlockRef = useRef<{ pos: number; size: number } | null>(null);
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
      CommentMark,
      StandaloneCommentNode,
    ],
    content: "",
    editable: true,
    onUpdate: ({ editor: ed }) => {
      if (!useOpenFiles.getState().activeId) return;
      // Drop updates fired by post-setContent extension transactions
      // (e.g. autolink) so an untouched file isn't flagged dirty.
      if (Date.now() < settleUntilRef.current) return;
      updateActiveMarkdown(getEditorMarkdown(ed));
    },
  });

  const dragHandleNested = useMemo(() => ({ edgeDetection: "none" as const }), []);
  const dragHandlePosition = useMemo(
    () => ({
      placement: "left-start" as const,
      strategy: "absolute" as const,
      middleware: [offset(16)],
    }),
    []
  );

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
    const file = state.files.find((f) => f.id === state.activeId);
    if (file) {
      // emitUpdate: false → don't fire onUpdate for the programmatic load.
      // TipTap's Markdown roundtrip can produce a slightly normalized string
      // (e.g. trailing newline tweaks) which would otherwise set isDirty=true
      // immediately after opening a freshly-loaded file. See issue #20.
      editor.commands.setContent(file.markdown, { emitUpdate: false });
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
      {editor && (
        <DragHandle
          editor={editor}
          className="drag-handle"
          nested={dragHandleNested}
          computePositionConfig={dragHandlePosition}
          onNodeChange={({ node, pos }) => {
            dragHandleBlockRef.current = node
              ? { pos, size: node.nodeSize }
              : null;
          }}
        >
          <Box
            component="span"
            sx={{ display: "inline-flex", cursor: "grab" }}
            onContextMenu={(e) => {
              e.preventDefault();
              const info = dragHandleBlockRef.current;
              if (!info) return;
              const customEvent = new CustomEvent("mdr:block-context-menu", {
                detail: {
                  x: e.clientX,
                  y: e.clientY,
                  pos: info.pos,
                  size: info.size,
                },
                bubbles: true,
              });
              window.dispatchEvent(customEvent);
            }}
          >
            <DragIndicatorIcon fontSize="small" />
          </Box>
        </DragHandle>
      )}
      <EditorContent editor={editor} />
    </Box>
  );
}
