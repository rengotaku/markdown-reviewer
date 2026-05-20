import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import SaveAsIcon from "@mui/icons-material/SaveAs";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import AddCommentIcon from "@mui/icons-material/AddComment";
import CommentIcon from "@mui/icons-material/Comment";
import CommentsDisabledIcon from "@mui/icons-material/CommentsDisabled";
import { TiptapEditor } from "@/components/tiptap/TiptapEditor";
import {
  Sidebar,
  ToastViewport,
  ConfirmDialog,
  AddCommentDialog,
  CommentSidePane,
} from "@/components";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useReadFile, useWriteFile } from "@/hooks/useFileContent";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/hooks/useUIStore";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useCommentAuthor } from "@/hooks/useCommentAuthor";
import { useConfig } from "@/hooks/useConfig";
import { dirQueryKey } from "@/hooks/useDir";
import { useQueryClient } from "@tanstack/react-query";
import { listDir } from "@/api";
import { generateCommentId } from "@/utils/commentId";
import { nextVersionedPath } from "@/utils/versionedPath";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const TARGET_SNIPPET_LENGTH = 60;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildTargetSnippet(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length <= TARGET_SNIPPET_LENGTH) return cleaned;
  return `${cleaned.slice(0, TARGET_SNIPPET_LENGTH)}…`;
}

export function EditorPage() {
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isCommentPaneOpen = useUIStore((s) => s.isCommentPaneOpen);
  const toggleCommentPane = useUIStore((s) => s.toggleCommentPane);

  const activeFile = useOpenFiles((s) => s.files.find((f) => f.id === s.activeId));
  const openServerFile = useOpenFiles((s) => s.openServerFile);
  const markActiveSaved = useOpenFiles((s) => s.markActiveSaved);
  const setActive = useOpenFiles((s) => s.setActive);

  const readFile = useReadFile();
  const writeFile = useWriteFile();
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);
  const editor = useEditorInstance((s) => s.editor);
  const { author } = useCommentAuthor();
  const { data: config } = useConfig();
  const queryClient = useQueryClient();
  const reviewRootName = config?.review_root_name ?? "Files";

  const [commentDialog, setCommentDialog] = useState<{
    open: boolean;
    snippet: string;
  }>({ open: false, snippet: "" });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null
  );

  // Re-render the toolbar Add-Comment button when selection / doc changes.
  const [, setSelectionTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => setSelectionTick((n) => n + 1);
    editor.on("selectionUpdate", tick);
    editor.on("transaction", tick);
    return () => {
      editor.off("selectionUpdate", tick);
      editor.off("transaction", tick);
    };
  }, [editor]);

  // Right-click on a non-empty selection (outside an existing comment) opens
  // our custom mini menu with "コメント追加". The editor `view` may not be
  // mounted at the moment the editor object lands in the store, so we attach
  // lazily and retry on the "create" event if needed.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let detach: (() => void) | undefined;

    const tryAttach = () => {
      if (detach) return;
      let dom: Element;
      try {
        dom = editor.view.dom;
      } catch {
        return; // view not ready yet
      }
      const handler = (e: Event) => {
        const ev = e as MouseEvent;
        const sel = editor.state.selection;
        if (sel.empty || sel.from === sel.to) return;
        if (editor.isActive("comment")) return;
        ev.preventDefault();
        setContextMenu({ x: ev.clientX, y: ev.clientY });
      };
      dom.addEventListener("contextmenu", handler);
      detach = () => dom.removeEventListener("contextmenu", handler);
    };

    tryAttach();
    editor.on("create", tryAttach);

    return () => {
      editor.off("create", tryAttach);
      if (detach) detach();
    };
  }, [editor]);

  const handleSelect = async (path: string) => {
    const state = useOpenFiles.getState();
    const active = state.files.find((f) => f.id === state.activeId);
    const target = state.files.find((f) => f.path === path);

    if (target && target.id === state.activeId) return;

    if (active && active.isDirty && active.path !== path) {
      const ok = await confirm({
        title: "未保存の変更があります",
        message: `「${active.name}」の変更は破棄されます。別のファイルを開きますか？`,
        confirmLabel: "破棄して開く",
      });
      if (!ok) return;
    }

    if (target) {
      setActive(target.id);
      return;
    }

    try {
      const res = await readFile.mutateAsync(path);
      openServerFile({
        name: basename(res.path),
        path: res.path,
        markdown: res.content,
      });
    } catch (err) {
      showToast(
        `ファイルの読み込みに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  const handleSave = async () => {
    if (!activeFile) return;
    try {
      await writeFile.mutateAsync({
        path: activeFile.path,
        content: activeFile.markdown,
      });
      markActiveSaved();
      showToast(`「${activeFile.name}」を保存しました`, "success");
    } catch (err) {
      showToast(
        `保存に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  const handleSaveAs = async () => {
    if (!activeFile) return;
    const slash = activeFile.path.lastIndexOf("/");
    const dir = slash === -1 ? "" : activeFile.path.slice(0, slash);
    try {
      const siblings = await listDir(dir);
      const siblingPaths = siblings.entries.map((e) => e.path);
      const newPath = nextVersionedPath(activeFile.path, siblingPaths);
      const res = await writeFile.mutateAsync({
        path: newPath,
        content: activeFile.markdown,
      });
      await queryClient.invalidateQueries({ queryKey: dirQueryKey(dir) });
      openServerFile({
        name: basename(res.path),
        path: res.path,
        markdown: res.content,
      });
      showToast(`「${basename(res.path)}」として保存しました`, "success");
    } catch (err) {
      showToast(
        `別名保存に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  const canAddComment = (() => {
    if (!editor) return false;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) return false;
    return !editor.isActive("comment");
  })();

  const handleAddCommentClick = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      showToast("コメントを付ける範囲をエディタで選択してください", "info");
      return;
    }
    if (editor.isActive("comment")) {
      showToast("コメント内にコメントを追加することはできません", "warning");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    setCommentDialog({
      open: true,
      snippet: buildTargetSnippet(selectedText),
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextAddComment = () => {
    closeContextMenu();
    handleAddCommentClick();
  };

  const handleCommentSubmit = ({ body }: { body: string }) => {
    if (!editor) {
      setCommentDialog({ open: false, snippet: "" });
      return;
    }
    const id = generateCommentId();
    const date = todayISO();
    const snippet = commentDialog.snippet;

    // Notion-style: mark only — don't insert the comment body into the document.
    editor
      .chain()
      .focus()
      .setComment({ id, author, date, target: snippet, body })
      .run();

    setCommentDialog({ open: false, snippet: "" });
  };

  const handleDeleteComment = (id: string) => {
    if (!editor) return;
    editor.chain().focus().unsetCommentById(id).run();
  };

  const canSave = Boolean(activeFile);
  const isSaving = writeFile.isPending;

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {isSidebarOpen && (
        <Box
          component="aside"
          sx={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            sx={{
              p: 1.5,
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Tooltip title={reviewRootName} placement="bottom-start">
              <Typography
                variant="subtitle2"
                sx={{
                  flexGrow: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
                data-testid="sidebar-review-root"
              >
                {reviewRootName}
              </Typography>
            </Tooltip>
            <Tooltip title="サイドバーを閉じる">
              <IconButton size="small" onClick={toggleSidebar} aria-label="close sidebar">
                <MenuOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Sidebar activePath={activeFile?.path} onSelect={handleSelect} />
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {!isSidebarOpen && (
            <Tooltip title="サイドバーを開く">
              <IconButton size="small" onClick={toggleSidebar} aria-label="open sidebar">
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Typography
            variant="body2"
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            data-testid="editor-active-path"
          >
            {activeFile ? activeFile.path : "ファイルが選択されていません"}
            {activeFile?.isDirty && " •"}
          </Typography>
          <Tooltip title="選択範囲にコメントを追加">
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddCommentIcon />}
                disabled={!canAddComment}
                onClick={handleAddCommentClick}
                data-testid="editor-add-comment"
              >
                コメント
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={isCommentPaneOpen ? "コメントペインを閉じる" : "コメントペインを開く"}>
            <IconButton
              size="small"
              onClick={toggleCommentPane}
              aria-label="toggle comments"
              data-testid="editor-toggle-comments"
            >
              {isCommentPaneOpen ? (
                <CommentsDisabledIcon fontSize="small" />
              ) : (
                <CommentIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            startIcon={<SaveIcon />}
            disabled={!canSave || isSaving}
            onClick={handleSave}
            data-testid="editor-save"
          >
            {isSaving ? "保存中..." : "保存"}
          </Button>
          <Tooltip title="同じディレクトリに .vN.md 形式でバージョニング保存">
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SaveAsIcon />}
                disabled={!canSave || isSaving}
                onClick={handleSaveAs}
                data-testid="editor-save-as"
              >
                別名保存
              </Button>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0 }}>
          <TiptapEditor />
        </Box>
      </Box>

      {isCommentPaneOpen && (
        <Box
          component="aside"
          sx={{
            width: 320,
            flexShrink: 0,
            borderLeft: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CommentSidePane editor={editor} onDelete={handleDeleteComment} />
        </Box>
      )}

      <Menu
        open={!!contextMenu}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined
        }
        slotProps={{
          root: { "data-testid": "editor-context-menu" } as Record<string, unknown>,
        }}
      >
        <MenuItem onClick={handleContextAddComment} data-testid="ctx-add-comment">
          <ListItemIcon>
            <AddCommentIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>コメント追加</ListItemText>
        </MenuItem>
      </Menu>

      <AddCommentDialog
        open={commentDialog.open}
        targetSnippet={commentDialog.snippet}
        onClose={() => setCommentDialog({ open: false, snippet: "" })}
        onSubmit={handleCommentSubmit}
      />

      <ConfirmDialog />
      <ToastViewport />
    </Box>
  );
}

