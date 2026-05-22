import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CloseIcon from "@mui/icons-material/Close";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import SaveAsIcon from "@mui/icons-material/SaveAs";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddCommentIcon from "@mui/icons-material/AddComment";
import CommentIcon from "@mui/icons-material/Comment";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
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
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useDirChangeWatcher } from "@/hooks/useDirChangeWatcher";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/hooks/useUIStore";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
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

// Render an RFC3339 timestamp as local-time "YYYY/MM/DD HH:mm" for the
// header. Empty input → empty string so the caller can elide the label.
function formatLocalTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function EditorPage() {
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isCommentPaneOpen = useUIStore((s) => s.isCommentPaneOpen);
  const toggleCommentPane = useUIStore((s) => s.toggleCommentPane);
  const setSelectedDirPath = useUIStore((s) => s.setSelectedDirPath);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const files = useOpenFiles((s) => s.files);
  const activeFile = useOpenFiles((s) => s.files.find((f) => f.id === s.activeId));
  const openServerFile = useOpenFiles((s) => s.openServerFile);
  const markActiveSaved = useOpenFiles((s) => s.markActiveSaved);
  const discardActiveChanges = useOpenFiles((s) => s.discardActiveChanges);
  const setActive = useOpenFiles((s) => s.setActive);
  const closeFile = useOpenFiles((s) => s.closeFile);

  const readFile = useReadFile();
  const writeFile = useWriteFile();
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);
  const editor = useEditorInstance((s) => s.editor);
  const centered = useEditorPrefs((s) => s.centered);
  const toggleCentered = useEditorPrefs((s) => s.toggleCentered);
  const { author } = useCommentAuthor();
  const { data: config } = useConfig();
  const queryClient = useQueryClient();
  const reviewRootName = config?.review_root_name ?? "Files";

  useFileWatcher();

  const handleRefreshTree = () => {
    void queryClient.invalidateQueries({ queryKey: ["dir"] });
  };

  useDirChangeWatcher({
    onOpenFile: (path) => {
      void handleSelect(path);
    },
    onSelectDir: (path) => {
      // Highlight + expand the directory in the tree and make sure the
      // sidebar is visible so the user can actually see the result.
      setSidebarOpen(true);
      setSelectedDirPath(path);
    },
  });

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
      // Roll the active file back to its saved baseline so its in-memory
      // edits aren't persisted to localStorage and don't reappear when the
      // user navigates back to it.
      discardActiveChanges();
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
        modified: res.modified,
        created: res.created,
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
      const res = await writeFile.mutateAsync({
        path: activeFile.path,
        content: activeFile.markdown,
      });
      markActiveSaved(res.modified, res.created);
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
        modified: res.modified,
        created: res.created,
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
      {!isSidebarOpen && (
        <Box
          component="aside"
          sx={{
            width: 40,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            pl: 0.5,
            pt: 0.75,
          }}
        >
          <Tooltip title="サイドバーを開く" placement="right">
            <IconButton
              size="small"
              onClick={toggleSidebar}
              aria-label="open sidebar"
              data-testid="sidebar-rail-open"
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
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
              pl: 0.5,
              pr: 1.5,
              py: 1,
              minHeight: 48,
              boxSizing: "border-box",
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Tooltip title="サイドバーを閉じる">
              <IconButton size="small" onClick={toggleSidebar} aria-label="close sidebar">
                <MenuOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
            <Tooltip title="ファイルツリーを再読み込み">
              <IconButton
                size="small"
                onClick={handleRefreshTree}
                aria-label="refresh file tree"
                data-testid="sidebar-refresh"
              >
                <RefreshIcon fontSize="small" />
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
            minHeight: 48,
            boxSizing: "border-box",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box
            component="img"
            src="/logo.png"
            alt="markdown-reviewer"
            sx={{
              width: 24,
              height: 24,
              borderRadius: 0.5,
              flexShrink: 0,
            }}
            data-testid="editor-header-logo"
          />
          <Box
            sx={{
              flexGrow: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "baseline",
              gap: 1.5,
              overflow: "hidden",
            }}
          >
            <Typography
              variant="body2"
              sx={{
                flexGrow: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              data-testid="editor-active-path"
            >
              {activeFile ? activeFile.path : "ファイルが選択されていません"}
              {activeFile?.isDirty && " •"}
            </Typography>
            {activeFile && (activeFile.serverCreated || activeFile.serverModified) && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
                data-testid="editor-active-timestamps"
              >
                {activeFile.serverCreated && (
                  <>作成: {formatLocalTimestamp(activeFile.serverCreated)}</>
                )}
                {activeFile.serverCreated && activeFile.serverModified && " · "}
                {activeFile.serverModified && (
                  <>更新: {formatLocalTimestamp(activeFile.serverModified)}</>
                )}
              </Typography>
            )}
          </Box>
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
          <Tooltip title={centered ? "全幅表示に切替" : "中央寄せに切替"}>
            <IconButton
              size="small"
              onClick={toggleCentered}
              aria-label="toggle width"
              data-testid="editor-toggle-width"
            >
              {centered ? (
                <UnfoldMoreIcon fontSize="small" sx={{ transform: "rotate(90deg)" }} />
              ) : (
                <FormatAlignCenterIcon fontSize="small" />
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

        {/*
         * Tab bar is always rendered even with a single open file, so the user
         * always has a visible target for close / switch and the layout stays
         * stable when a second file is opened.
         */}
        <Tabs
          value={activeFile?.id ?? false}
          onChange={(_, v) => setActive(v as string)}
          variant="scrollable"
          scrollButtons={false}
          sx={{
            minHeight: 36,
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            "& .MuiTab-root": {
              minHeight: 36,
              textTransform: "none",
              py: 0.5,
              px: 1,
              minWidth: 0,
              width: 180,
              maxWidth: 180,
              flex: "0 0 180px",
            },
          }}
          data-testid="editor-tabs"
        >
          {files.map((f) => (
            <Tab
              key={f.id}
              value={f.id}
              data-testid={`editor-tab-${f.path}`}
              label={
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textAlign: "left",
                    }}
                  >
                    {f.name}
                    {f.isDirty ? " •" : ""}
                  </Box>
                  <CloseIcon
                    fontSize="inherit"
                    role="button"
                    aria-label={`close ${f.name}`}
                    data-testid={`editor-tab-close-${f.path}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFile(f.id);
                    }}
                    sx={{
                      flexShrink: 0,
                      ml: 0.5,
                      opacity: 0.55,
                      "&:hover": { opacity: 1 },
                    }}
                  />
                </Box>
              }
            />
          ))}
        </Tabs>

        <Box sx={{ flex: 1, minHeight: 0 }}>
          <TiptapEditor />
        </Box>
      </Box>

      {isCommentPaneOpen ? (
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
          <CommentSidePane
            editor={editor}
            onDelete={handleDeleteComment}
            onClose={toggleCommentPane}
          />
        </Box>
      ) : (
        <Box
          component="aside"
          sx={{
            width: 40,
            flexShrink: 0,
            borderLeft: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            pr: 0.5,
            pt: 0.75,
          }}
        >
          <Tooltip title="コメントペインを開く" placement="left">
            <IconButton
              size="small"
              onClick={toggleCommentPane}
              aria-label="open comment pane"
              data-testid="editor-toggle-comments"
            >
              <CommentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
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

