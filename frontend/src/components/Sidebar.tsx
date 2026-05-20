import { useState, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import ChevronRight from "@mui/icons-material/ChevronRight";
import ExpandMore from "@mui/icons-material/ExpandMore";
import FolderOpen from "@mui/icons-material/FolderOpen";
import InsertDriveFile from "@mui/icons-material/InsertDriveFile";
import { useDir } from "@/hooks/useDir";
import type { DirEntryApi } from "@/api";

interface SidebarProps {
  activePath?: string;
  onSelect: (path: string) => void;
}

const INDENT_PX = 12;

export function Sidebar({ activePath, onSelect }: SidebarProps) {
  const { data, isLoading, isError, error } = useDir("");

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

  const entries = data?.entries ?? [];
  if (entries.length === 0) {
    return (
      <Box className="p-4">
        <Typography variant="body2" color="text.secondary">
          .md ファイルが見つかりませんでした
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      component="nav"
      aria-label="file tree"
      data-testid="sidebar"
      sx={{ overflow: "auto", height: "100%" }}
    >
      <List dense disablePadding>
        {entries.map((entry) => (
          <TreeItem
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            onSelect={onSelect}
          />
        ))}
      </List>
    </Box>
  );
}

interface TreeItemProps {
  entry: DirEntryApi;
  depth: number;
  activePath?: string;
  onSelect: (path: string) => void;
}

function TreeItem({ entry, depth, activePath, onSelect }: TreeItemProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const indent = depth * INDENT_PX + 8;

  if (entry.type === "dir") {
    return (
      <>
        <ListItemButton
          onClick={() => setExpanded((v) => !v)}
          sx={{ pl: `${indent}px` }}
          data-testid={`sidebar-dir-${entry.path}`}
        >
          <ListItemIcon sx={{ minWidth: 24 }}>
            {expanded ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
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
          />
        )}
      </>
    );
  }

  const selected = entry.path === activePath;
  return (
    <ListItemButton
      onClick={() => onSelect(entry.path)}
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
}

function DirChildren({ path, depth, activePath, onSelect }: DirChildrenProps) {
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
        />
      ))}
    </>
  );
}
