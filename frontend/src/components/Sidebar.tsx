import { useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ChevronRight from "@mui/icons-material/ChevronRight";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMore from "@mui/icons-material/ExpandMore";
import FolderOpen from "@mui/icons-material/FolderOpen";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import { useSearchParams } from "react-router-dom";
import { useDir } from "@/hooks/useDir";
import { useConfig } from "@/hooks/useConfig";
import { useToast } from "@/hooks/useToast";
import type { DirEntryApi } from "@/api";

interface SidebarProps {
  activePath?: string;
  onSelect: (path: string) => void;
}

const INDENT_PX = 12;
const FILTER_PARAM = "filter";

interface EntryContextMenuState {
  x: number;
  y: number;
  entry: DirEntryApi;
}

export function Sidebar({ activePath, onSelect }: SidebarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get(FILTER_PARAM) ?? "";
  const [contextMenu, setContextMenu] = useState<EntryContextMenuState | null>(
    null
  );
  const showToast = useToast((s) => s.show);
  const { data: config } = useConfig();
  const reviewRoot = config?.review_root ?? "";

  const buildFullPath = (path: string): string => {
    if (!reviewRoot) return path;
    const root = reviewRoot.replace(/\/+$/, "");
    return `${root}/${path}`;
  };

  const openContextMenu = (e: React.MouseEvent, entry: DirEntryApi) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const closeContextMenu = () => setContextMenu(null);

  const copyToClipboard = async (text: string, label: string) => {
    closeContextMenu();
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label}をコピーしました: ${text}`, "success");
    } catch (err) {
      showToast(
        `クリップボードへのコピーに失敗しました: ${(err as Error).message ?? "unknown"}`,
        "error"
      );
    }
  };

  const updateFilter = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(FILTER_PARAM, value);
        else next.delete(FILTER_PARAM);
        return next;
      },
      { replace: true }
    );
  };

  const { data, isLoading, isError, error } = useDir("");

  // Filter applies ONLY to top-level directories.
  // Top-level files and any nested entries are unaffected.
  const filterLower = filter.toLowerCase();
  const visibleEntries = (data?.entries ?? []).filter((entry) => {
    if (!filterLower) return true;
    if (entry.type !== "dir") return true;
    return entry.name.toLowerCase().includes(filterLower);
  });

  return (
    <Box
      component="nav"
      aria-label="file tree"
      data-testid="sidebar"
      sx={{
        overflow: "auto",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ p: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <TextField
          value={filter}
          onChange={(e) => updateFilter(e.target.value)}
          placeholder="直下のディレクトリ名でフィルタ"
          size="small"
          fullWidth
          inputProps={{ "data-testid": "sidebar-filter" }}
          InputProps={{
            endAdornment: filter ? (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => updateFilter("")}
                  aria-label="clear filter"
                  data-testid="sidebar-filter-clear"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
        />
      </Box>

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {isLoading ? (
          <Box className="flex items-center justify-center p-4">
            <CircularProgress size={20} />
          </Box>
        ) : isError ? (
          <Box className="p-3">
            <Alert severity="error" variant="outlined">
              ファイル一覧の取得に失敗しました:{" "}
              {error?.message ?? "unknown error"}
            </Alert>
          </Box>
        ) : (data?.entries ?? []).length === 0 ? (
          <Box className="p-4">
            <Typography variant="body2" color="text.secondary">
              .md ファイルが見つかりませんでした
            </Typography>
          </Box>
        ) : (
          <>
            <List dense disablePadding>
              {visibleEntries.map((entry) => (
                <TreeItem
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  activePath={activePath}
                  onSelect={onSelect}
                  onContextMenu={openContextMenu}
                />
              ))}
            </List>
            {filter && !visibleEntries.some((e) => e.type === "dir") && (
              <Box sx={{ p: 2 }} data-testid="sidebar-no-match">
                <Typography variant="caption" color="text.secondary">
                  「{filter}」に一致するディレクトリはありません
                </Typography>
              </Box>
            )}
          </>
        )}
      </Box>

      <Menu
        open={!!contextMenu}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined
        }
      >
        <MenuItem
          onClick={() =>
            contextMenu && copyToClipboard(contextMenu.entry.name, "名前")
          }
          data-testid="sidebar-ctx-copy-name"
        >
          名前をクリップボードにコピー
        </MenuItem>
        <MenuItem
          onClick={() =>
            contextMenu &&
            copyToClipboard(buildFullPath(contextMenu.entry.path), "フルパス")
          }
          data-testid="sidebar-ctx-copy-path"
        >
          フルパスをコピー
        </MenuItem>
      </Menu>
    </Box>
  );
}

interface TreeItemProps {
  entry: DirEntryApi;
  depth: number;
  activePath?: string;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntryApi) => void;
}

function TreeItem({
  entry,
  depth,
  activePath,
  onSelect,
  onContextMenu,
}: TreeItemProps): ReactNode {
  // Auto-expand when this dir is an ancestor of the active file path so
  // tab-switching reveals the active file in the tree. Implemented as
  // derived state to avoid setState-in-effect lint warnings; the dir
  // stays effectively open while it shelters the active path.
  const isAncestorOfActive =
    entry.type === "dir" &&
    !!activePath &&
    activePath.startsWith(`${entry.path}/`);
  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = userExpanded || isAncestorOfActive;
  const indent = depth * INDENT_PX + 8;

  if (entry.type === "dir") {
    return (
      <>
        <ListItemButton
          onClick={() => setUserExpanded((v) => !v)}
          onContextMenu={(e) => onContextMenu(e, entry)}
          sx={{ pl: `${indent}px` }}
          data-testid={`sidebar-dir-${entry.path}`}
        >
          <ListItemIcon sx={{ minWidth: 24 }}>
            {expanded ? (
              <ExpandMore fontSize="small" />
            ) : (
              <ChevronRight fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <FolderOpen fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={entry.name}
            slotProps={{ primary: { variant: "body2" } }}
          />
        </ListItemButton>
        {expanded && (
          <DirChildren
            path={entry.path}
            depth={depth + 1}
            activePath={activePath}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        )}
      </>
    );
  }

  const selected = entry.path === activePath;
  return (
    <ListItemButton
      onClick={() => onSelect(entry.path)}
      onContextMenu={(e) => onContextMenu(e, entry)}
      selected={selected}
      sx={{ pl: `${indent + 24}px` }}
      data-testid={`sidebar-file-${entry.path}`}
    >
      <ListItemIcon sx={{ minWidth: 24 }}>
        <InsertDriveFile fontSize="small" />
      </ListItemIcon>
      <ListItemText
        primary={entry.name}
        slotProps={{ primary: { variant: "body2" } }}
      />
    </ListItemButton>
  );
}

interface DirChildrenProps {
  path: string;
  depth: number;
  activePath?: string;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntryApi) => void;
}

function DirChildren({
  path,
  depth,
  activePath,
  onSelect,
  onContextMenu,
}: DirChildrenProps) {
  const { data, isLoading, isError, error } = useDir(path);
  const indent = depth * INDENT_PX + 8;

  if (isLoading) {
    return (
      <Box sx={{ pl: `${indent + 24}px`, py: 0.5 }}>
        <CircularProgress size={14} />
      </Box>
    );
  }
  if (isError) {
    return (
      <Box sx={{ pl: `${indent + 24}px`, py: 0.5 }}>
        <Typography variant="caption" color="error">
          読み込みエラー: {error?.message ?? "unknown"}
        </Typography>
      </Box>
    );
  }
  const entries = data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <Box sx={{ pl: `${indent + 24}px`, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          (空)
        </Typography>
      </Box>
    );
  }
  return (
    <>
      {entries.map((child) => (
        <TreeItem
          key={child.path}
          entry={child}
          depth={depth}
          activePath={activePath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}
