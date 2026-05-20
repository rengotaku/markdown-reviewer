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
    ],
    content: "",
    editable: true,
    onUpdate: ({ editor: ed }) => {
      if (!useOpenFiles.getState().activeId) return;
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
    const key = activeId ? `${activeId}:${activeReloadToken}` : null;
    if (lastLoadedKeyRef.current === key) return;
    lastLoadedKeyRef.current = key;
    if (!activeId) return;
    const state = useOpenFiles.getState();
    const file = state.files.find((f) => f.id === state.activeId);
    if (file) {
      editor.commands.setContent(file.markdown);
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
        >
          <DragIndicatorIcon fontSize="small" />
        </DragHandle>
      )}
      <EditorContent editor={editor} />
    </Box>
  );
}
