import type { Editor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Pure reorder helper. Returns null when no actual move would occur. */
export function reorderArray<T>(arr: T[], fromIdx: number, toIdx: number): T[] | null {
  if (fromIdx < 0 || fromIdx >= arr.length) return null;
  if (toIdx < 0 || toIdx > arr.length) return null;
  if (fromIdx === toIdx) return null;
  // toIdx === fromIdx+1 means "insert after itself" — no change
  if (toIdx === fromIdx + 1) return null;

  const next = [...arr];
  const [moved] = next.splice(fromIdx, 1);
  const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
  next.splice(insertAt, 0, moved);
  return next;
}

interface TableNodeResult {
  tableStart: number;
  tableNode: PMNode;
}

function findTableNode(
  editor: Editor,
  tableEl: HTMLTableElement
): TableNodeResult | null {
  const { view } = editor;
  const { state } = view;

  const firstCell = tableEl.querySelector("th, td");
  if (!firstCell) return null;

  try {
    const cellPos = view.posAtDOM(firstCell, 0);
    const $pos = state.doc.resolve(cellPos);

    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      if (node.type.name === "table") {
        return { tableStart: $pos.before(depth), tableNode: node };
      }
    }
  } catch {
    // view not ready or DOM not in editor
  }

  return null;
}

export function moveTableRow(
  editor: Editor,
  tableEl: HTMLTableElement,
  fromIdx: number,
  toIdx: number
): void {
  const found = findTableNode(editor, tableEl);
  if (!found) return;

  const { tableStart, tableNode } = found;

  const rows: PMNode[] = [];
  tableNode.forEach((child) => {
    if (child.type.name === "tableRow") rows.push(child);
  });

  const newRows = reorderArray(rows, fromIdx, toIdx);
  if (!newRows) return;

  const tr = editor.view.state.tr;
  tr.replaceWith(
    tableStart + 1,
    tableStart + tableNode.nodeSize - 1,
    Fragment.fromArray(newRows)
  );
  editor.view.dispatch(tr);
}

export function moveTableCol(
  editor: Editor,
  tableEl: HTMLTableElement,
  fromIdx: number,
  toIdx: number
): void {
  if (fromIdx === toIdx || toIdx === fromIdx + 1) return;
  if (fromIdx < 0 || toIdx < 0) return;

  const found = findTableNode(editor, tableEl);
  if (!found) return;

  const { tableStart, tableNode } = found;

  const newRows: PMNode[] = [];

  tableNode.forEach((rowNode) => {
    if (rowNode.type.name !== "tableRow") {
      newRows.push(rowNode);
      return;
    }

    const cells: PMNode[] = [];
    rowNode.forEach((cell) => cells.push(cell));

    const newCells = reorderArray(cells, fromIdx, toIdx);
    if (!newCells) {
      newRows.push(rowNode);
      return;
    }

    newRows.push(
      rowNode.type.create(rowNode.attrs, Fragment.fromArray(newCells), rowNode.marks)
    );
  });

  const tr = editor.view.state.tr;
  tr.replaceWith(
    tableStart + 1,
    tableStart + tableNode.nodeSize - 1,
    Fragment.fromArray(newRows)
  );
  editor.view.dispatch(tr);
}
