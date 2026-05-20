import { useMemo, useState, type ReactNode } from "react";
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
import { useFiles } from "@/hooks/useFiles";
import { buildFileTree, type FileTreeNode } from "@/utils/buildFileTree";

interface SidebarProps {
  activePath?: string;
  onSelect: (path: string) => void;
}

const INDENT_PX = 12;

export function Sidebar({ activePath, onSelect }: SidebarProps) {
  const { data, isLoading, isError, error } = useFiles();

  const tree = useMemo(() => buildFileTree(data?.files ?? []), [data]);

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

  if (tree.length === 0) {
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
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
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
  node: FileTreeNode;
  depth: number;
  activePath?: string;
  onSelect: (path: string) => void;
}

function TreeItem({ node, depth, activePath, onSelect }: TreeItemProps): ReactNode {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * INDENT_PX + 8;

  if (node.type === "dir") {
    return (
      <>
        <ListItemButton
          onClick={() => setExpanded((v) => !v)}
          sx={{ pl: `${indent}px` }}
          data-testid={`sidebar-dir-${node.path}`}
        >
          <ListItemIcon sx={{ minWidth: 24 }}>
            {expanded ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <FolderOpen fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={node.name}
            slotProps={{ primary: { variant: "body2" } }}
          />
        </ListItemButton>
        {expanded &&
          node.children?.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  }

  const selected = node.path === activePath;
  return (
    <ListItemButton
      onClick={() => onSelect(node.path)}
      selected={selected}
      sx={{ pl: `${indent + 24}px` }}
      data-testid={`sidebar-file-${node.path}`}
    >
      <ListItemIcon sx={{ minWidth: 24 }}>
        <InsertDriveFile fontSize="small" />
      </ListItemIcon>
      <ListItemText
        primary={node.name}
        slotProps={{ primary: { variant: "body2" } }}
      />
    </ListItemButton>
  );
}
