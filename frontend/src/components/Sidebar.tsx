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
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ChevronRight from "@mui/icons-material/ChevronRight";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandMore from "@mui/icons-material/ExpandMore";
import FolderOpen from "@mui/icons-material/FolderOpen";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useSearchParams } from "react-router-dom";
import { useDir } from "@/hooks/useDir";
import { useFiles } from "@/hooks/useFiles";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/hooks/useUIStore";
import { formatLocalTimestamp } from "@/utils/formatTimestamp";
import type { DirEntryApi } from "@/api";
import { BAR_HEIGHT } from "@/theme/dimensions";

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
  const selectedDirPath = useUIStore((s) => s.selectedDirPath);
  const viewMode = useUIStore((s) => s.sidebarViewMode);
  const setSidebarViewMode = useUIStore((s) => s.setSidebarViewMode);
  const { activePath: reviewRoot } = useActiveRoot();

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

  // The tree query is paused while the recent list is shown so only the
  // visible view polls the server; switching back re-enables (and refetches
  // when stale).
  const { data, isLoading, isError, error } = useDir("", {
    enabled: viewMode === "tree",
  });

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
      <Box
        sx={{
          px: 1,
          // Fixed height (not min) so the filter bar sits at exactly the same
          // visual row height as the other pane bars (BAR_HEIGHT = 37px). The
          // TextField is shrunk (see below) to fit inside without growing the
          // row (#94).
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <TextField
          value={filter}
          onChange={(e) => updateFilter(e.target.value)}
          placeholder={
            viewMode === "recent"
              ? "ファイル名・パスでフィルタ"
              : "直下のディレクトリ名でフィルタ"
          }
          size="small"
          sx={{
            flex: 1,
            minWidth: 0,
            // Keep the input inside the 37px bar: shrink the field + font so it
            // doesn't force the row taller than the other pane bars.
            "& .MuiInputBase-root": { height: 28 },
            "& .MuiInputBase-input": { py: 0, fontSize: "0.8125rem" },
          }}
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
        <Tooltip title={viewMode === "tree" ? "更新順表示に切替" : "ツリー表示に切替"}>
          <IconButton
            size="small"
            onClick={() => setSidebarViewMode(viewMode === "tree" ? "recent" : "tree")}
            aria-label="表示モード切替"
            data-testid="sidebar-view-mode"
          >
            {viewMode === "tree" ? (
              <AccountTreeIcon fontSize="small" />
            ) : (
              <ScheduleIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {viewMode === "recent" ? (
          <RecentList
            filter={filter}
            activePath={activePath}
            onSelect={onSelect}
            onContextMenu={openContextMenu}
          />
        ) : isLoading ? (
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
                  selectedDirPath={selectedDirPath}
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
  selectedDirPath?: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntryApi) => void;
}

function TreeItem({
  entry,
  depth,
  activePath,
  selectedDirPath,
  onSelect,
  onContextMenu,
}: TreeItemProps): ReactNode {
  // Auto-expand when this dir is an ancestor of the active file path or the
  // selected dir path so tab-switching / toast-link clicks reveal the target
  // in the tree. Derived state avoids setState-in-effect lint warnings.
  const isAncestorOfActive =
    entry.type === "dir" &&
    !!activePath &&
    activePath.startsWith(`${entry.path}/`);
  const isAncestorOfSelectedDir =
    entry.type === "dir" &&
    !!selectedDirPath &&
    selectedDirPath.startsWith(`${entry.path}/`);
  // A directory that *is* the selected one should also auto-expand so the
  // user sees its children after clicking the popup link.
  const isSelectedSelf =
    entry.type === "dir" && !!selectedDirPath && selectedDirPath === entry.path;
  const [userExpanded, setUserExpanded] = useState(false);
  const expanded =
    userExpanded || isAncestorOfActive || isAncestorOfSelectedDir || isSelectedSelf;
  const indent = depth * INDENT_PX + 8;

  if (entry.type === "dir") {
    return (
      <>
        <ListItemButton
          onClick={() => setUserExpanded((v) => !v)}
          onContextMenu={(e) => onContextMenu(e, entry)}
          selected={isSelectedSelf}
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
            slotProps={{ primary: { variant: "body2", noWrap: true } }}
            sx={{ minWidth: 0 }}
          />
        </ListItemButton>
        {expanded && (
          <DirChildren
            path={entry.path}
            depth={depth + 1}
            activePath={activePath}
            selectedDirPath={selectedDirPath}
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
        slotProps={{ primary: { variant: "body2", noWrap: true } }}
        sx={{ minWidth: 0 }}
      />
    </ListItemButton>
  );
}

interface DirChildrenProps {
  path: string;
  depth: number;
  activePath?: string;
  selectedDirPath?: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntryApi) => void;
}

function DirChildren({
  path,
  depth,
  activePath,
  selectedDirPath,
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
          selectedDirPath={selectedDirPath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

// Directory portion of a path for the recent list's first line. Root-level
// files show "/" so the line is never blank.
function dirLabel(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "/" : path.slice(0, idx);
}

function baseName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

interface RecentListProps {
  filter: string;
  activePath?: string;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntryApi) => void;
}

/**
 * Flat "recent" view (#68): every file under the root, newest modification
 * first, each rendered as folder-path + file-name two-liner. Data comes from
 * the /api/files listing — like /api/dirs it only ever returns .md files, so
 * no client-side extension filtering is needed.
 */
function RecentList({ filter, activePath, onSelect, onContextMenu }: RecentListProps) {
  const { data, isLoading, isError, error } = useFiles();

  if (isLoading) {
    return (
      <Box className="flex items-center justify-center p-4">
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (isError) {
    return (
      <Box className="p-3">
        <Alert severity="error" variant="outlined">
          ファイル一覧の取得に失敗しました: {error?.message ?? "unknown error"}
        </Alert>
      </Box>
    );
  }

  const files = data?.files ?? [];
  if (files.length === 0) {
    return (
      <Box className="p-4">
        <Typography variant="body2" color="text.secondary">
          .md ファイルが見つかりませんでした
        </Typography>
      </Box>
    );
  }

  // Newest first. RFC3339 strings with mixed timezone offsets don't sort
  // lexicographically, so compare parsed epoch values.
  const sorted = [...files].sort(
    (a, b) => Date.parse(b.modified) - Date.parse(a.modified)
  );
  // Unlike the tree (top-level dirs only), the flat list matches the filter
  // against the whole path so files can be narrowed by name or folder.
  const filterLower = filter.toLowerCase();
  const visible = filterLower
    ? sorted.filter((f) => f.path.toLowerCase().includes(filterLower))
    : sorted;

  return (
    <>
      <List dense disablePadding>
        {visible.map((file) => {
          const name = baseName(file.path);
          return (
            <ListItemButton
              key={file.path}
              onClick={() => onSelect(file.path)}
              onContextMenu={(e) =>
                onContextMenu(e, {
                  name,
                  path: file.path,
                  type: "file",
                  modified: file.modified,
                })
              }
              selected={file.path === activePath}
              sx={{ px: 1.5, py: 0.5 }}
              data-testid={`sidebar-recent-file-${file.path}`}
            >
              <Box sx={{ minWidth: 0, width: "100%" }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 1,
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ minWidth: 0 }}
                    data-testid={`sidebar-recent-dir-${file.path}`}
                  >
                    {dirLabel(file.path)}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flexShrink: 0 }}
                  >
                    {formatLocalTimestamp(file.modified)}
                  </Typography>
                </Box>
                <Typography variant="body2" noWrap>
                  {name}
                </Typography>
              </Box>
            </ListItemButton>
          );
        })}
      </List>
      {filter && visible.length === 0 && (
        <Box sx={{ p: 2 }} data-testid="sidebar-no-match">
          <Typography variant="caption" color="text.secondary">
            「{filter}」に一致するファイルはありません
          </Typography>
        </Box>
      )}
    </>
  );
}
