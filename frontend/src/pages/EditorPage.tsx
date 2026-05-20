import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import { TiptapEditor } from "@/components/tiptap/TiptapEditor";
import { Sidebar, ToastViewport, ConfirmDialog } from "@/components";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useReadFile, useWriteFile } from "@/hooks/useFileContent";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/hooks/useUIStore";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function EditorPage() {
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const activeFile = useOpenFiles((s) => s.files.find((f) => f.id === s.activeId));
  const openServerFile = useOpenFiles((s) => s.openServerFile);
  const markActiveSaved = useOpenFiles((s) => s.markActiveSaved);
  const setActive = useOpenFiles((s) => s.setActive);

  const readFile = useReadFile();
  const writeFile = useWriteFile();
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);

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
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              Files
            </Typography>
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
        </Box>

        <Box sx={{ flex: 1, minHeight: 0 }}>
          <TiptapEditor />
        </Box>
      </Box>

      <ConfirmDialog />
      <ToastViewport />
    </Box>
  );
}
