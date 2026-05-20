import type { FileEntry } from "@/api";

export interface FileTreeNode {
  type: "file" | "dir";
  name: string;
  path: string;
  children?: FileTreeNode[];
}

interface MutableDir {
  type: "dir";
  name: string;
  path: string;
  childMap: Map<string, MutableDir | FileTreeNode>;
}

function isDir(node: MutableDir | FileTreeNode): node is MutableDir {
  return node.type === "dir" && "childMap" in node;
}

function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function materialize(dir: MutableDir): FileTreeNode {
  const children = Array.from(dir.childMap.values()).map((n) =>
    isDir(n) ? materialize(n) : n
  );
  return {
    type: "dir",
    name: dir.name,
    path: dir.path,
    children: sortNodes(children),
  };
}

/**
 * Convert flat `FileEntry[]` (paths use '/' as separator) into a tree.
 * Directories appear before files at each level; both are sorted by name.
 */
export function buildFileTree(files: FileEntry[]): FileTreeNode[] {
  const rootChildren = new Map<string, MutableDir | FileTreeNode>();

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let cursor = rootChildren;
    let accumulated = "";

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      accumulated = accumulated ? `${accumulated}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        cursor.set(segment, { type: "file", name: segment, path: file.path });
        continue;
      }

      const existing = cursor.get(segment);
      if (existing && isDir(existing)) {
        cursor = existing.childMap;
        continue;
      }
      const dir: MutableDir = {
        type: "dir",
        name: segment,
        path: accumulated,
        childMap: new Map(),
      };
      cursor.set(segment, dir);
      cursor = dir.childMap;
    }
  }

  const top = Array.from(rootChildren.values()).map((n) =>
    isDir(n) ? materialize(n) : n
  );
  return sortNodes(top);
}
