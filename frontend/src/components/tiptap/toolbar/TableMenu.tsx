import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { moveTableRow, moveTableCol } from "./tableDragDrop";

interface TableMenuProps {
  editor: Editor;
}

interface DragState {
  type: "row" | "col";
  fromIndex: number;
  tableEl: HTMLTableElement;
}

function getEditorDom(editor: Editor): HTMLElement | null {
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
}

interface TablePosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface HoveredRow {
  index: number;
  top: number;
  height: number;
}

interface HoveredColumn {
  index: number;
  left: number;
  width: number;
}

function useTablePosition(
  editor: Editor,
  hoveredTableRef: React.RefObject<HTMLTableElement | null>,
  hoveredRow: HoveredRow | null,
  hoveredColumn: HoveredColumn | null
): TablePosition | null {
  const [position, setPosition] = useState<TablePosition | null>(null);

  const updatePosition = useCallback(() => {
    const tableEl = hoveredTableRef.current;
    if (!tableEl) {
      setPosition(null);
      return;
    }

    const rect = tableEl.getBoundingClientRect();
    setPosition({
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    });
  }, [hoveredTableRef]);

  useEffect(() => {
    const id = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(id);
  }, [hoveredRow, hoveredColumn, updatePosition]);

  useEffect(() => {
    let rafId1 = 0;
    let rafId2 = 0;
    const handler = () => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(updatePosition);
      });
    };
    const handleScroll = () => {
      setPosition(null);
    };
    editor.on("update", handler);
    editor.on("transaction", handler);

    const findScrollParent = (): HTMLElement | null => {
      const dom = getEditorDom(editor);
      let el = dom?.parentElement ?? null;
      while (el) {
        const style = getComputedStyle(el);
        if (
          style.overflow === "auto" ||
          style.overflowY === "auto" ||
          style.overflow === "scroll" ||
          style.overflowY === "scroll"
        ) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    };

    let scrollEl = findScrollParent();
    scrollEl?.addEventListener("scroll", handleScroll);

    const attachScroll = () => {
      scrollEl = findScrollParent();
      scrollEl?.addEventListener("scroll", handleScroll);
    };
    editor.on("create", attachScroll);

    return () => {
      cancelAnimationFrame(rafId1);
      cancelAnimationFrame(rafId2);
      editor.off("update", handler);
      editor.off("transaction", handler);
      editor.off("create", attachScroll);
      scrollEl?.removeEventListener("scroll", handleScroll);
    };
  }, [editor, updatePosition]);

  return position;
}

function useTableHover(editor: Editor) {
  const [hoveredRow, setHoveredRow] = useState<HoveredRow | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<HoveredColumn | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const gripHoveredRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const clearHover = useCallback(() => {
    if (gripHoveredRef.current) return;
    setHoveredRow(null);
    setHoveredColumn(null);
    tableRef.current = null;
  }, []);

  const scheduleClearHover = useCallback(() => {
    if (gripHoveredRef.current) return;
    cancelLeaveTimer();
    leaveTimerRef.current = setTimeout(clearHover, 300);
  }, [cancelLeaveTimer, clearHover]);

  const onGripEnter = useCallback(() => {
    gripHoveredRef.current = true;
    cancelLeaveTimer();
  }, [cancelLeaveTimer]);

  const onGripLeave = useCallback(() => {
    gripHoveredRef.current = false;
    scheduleClearHover();
  }, [scheduleClearHover]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (gripHoveredRef.current) return;
      cancelLeaveTimer();

      const target = e.target as HTMLElement;
      const cell = target.closest("td, th");
      const tableEl = cell?.closest("table") ?? null;
      if (!tableEl) {
        scheduleClearHover();
        return;
      }
      tableRef.current = tableEl;

      if (!cell) {
        scheduleClearHover();
        return;
      }

      const row = cell.closest("tr");
      if (row) {
        const rowRect = row.getBoundingClientRect();
        const rows = Array.from(tableEl.querySelectorAll("tr"));
        const rowIndex = rows.indexOf(row);
        setHoveredRow({
          index: rowIndex,
          top: rowRect.top + window.scrollY,
          height: rowRect.height,
        });
      }

      const cellEl = cell as HTMLTableCellElement;
      const cellRect = cellEl.getBoundingClientRect();
      setHoveredColumn({
        index: cellEl.cellIndex,
        left: cellRect.left + window.scrollX,
        width: cellRect.width,
      });
    };

    const handleMouseLeave = () => {
      if (gripHoveredRef.current) return;
      scheduleClearHover();
    };

    let currentDom: HTMLElement | null = null;

    const attach = () => {
      const dom = getEditorDom(editor);
      if (!dom || dom === currentDom) return;
      if (currentDom) {
        currentDom.removeEventListener("mousemove", handleMouseMove);
        currentDom.removeEventListener("mouseleave", handleMouseLeave);
      }
      currentDom = dom;
      dom.addEventListener("mousemove", handleMouseMove);
      dom.addEventListener("mouseleave", handleMouseLeave);
    };

    attach();
    editor.on("create", attach);

    return () => {
      editor.off("create", attach);
      cancelLeaveTimer();
      if (currentDom) {
        currentDom.removeEventListener("mousemove", handleMouseMove);
        currentDom.removeEventListener("mouseleave", handleMouseLeave);
      }
    };
  }, [editor, cancelLeaveTimer, clearHover, scheduleClearHover]);

  return {
    hoveredRow,
    hoveredColumn,
    setHoveredRow,
    setHoveredColumn,
    onGripEnter,
    onGripLeave,
    tableRef,
  };
}

function focusCellAt(
  editor: Editor,
  tableEl: HTMLTableElement | null,
  rowIndex: number,
  colIndex: number
) {
  if (!tableEl) return;
  const rows = tableEl.querySelectorAll("tr");
  const targetRow = rows[rowIndex];
  if (!targetRow) return;
  const cells = targetRow.querySelectorAll("td, th");
  const targetCell = cells[colIndex];
  if (!targetCell) return;
  try {
    const pos = editor.view.posAtDOM(targetCell, 0);
    editor.chain().focus().setTextSelection(pos).run();
  } catch {
    // view not available
  }
}

export function TableMenu({ editor }: TableMenuProps) {
  const {
    hoveredRow,
    hoveredColumn,
    setHoveredRow,
    setHoveredColumn,
    onGripEnter,
    onGripLeave,
    tableRef,
  } = useTableHover(editor);
  const position = useTablePosition(editor, tableRef, hoveredRow, hoveredColumn);

  const [rowMenuPos, setRowMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [colMenuPos, setColMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number>(-1);
  const [activeColIndex, setActiveColIndex] = useState<number>(-1);

  const dragStateRef = useRef<DragState | null>(null);
  const dropInsertRef = useRef<{ type: "row" | "col"; insertBefore: number } | null>(
    null
  );
  const [dropIndicatorStyle, setDropIndicatorStyle] =
    useState<React.CSSProperties | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const clearDragState = useCallback(() => {
    dragStateRef.current = null;
    dropInsertRef.current = null;
    setDropIndicatorStyle(null);
    setIsDragging(false);
  }, []);

  const handleRowDragStart = useCallback(
    (e: React.DragEvent, rowIndex: number) => {
      if (!tableRef.current) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      dragStateRef.current = {
        type: "row",
        fromIndex: rowIndex,
        tableEl: tableRef.current,
      };
      setIsDragging(true);
    },
    [tableRef]
  );

  const handleColDragStart = useCallback(
    (e: React.DragEvent, colIndex: number) => {
      if (!tableRef.current) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      dragStateRef.current = {
        type: "col",
        fromIndex: colIndex,
        tableEl: tableRef.current,
      };
      setIsDragging(true);
    },
    [tableRef]
  );

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      const { type, tableEl } = ds;

      if (type === "row") {
        const rows = Array.from(tableEl.querySelectorAll("tr"));
        if (!rows.length) return;

        let insertBefore = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const rect = rows[i].getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            insertBefore = i;
            break;
          }
        }
        dropInsertRef.current = { type: "row", insertBefore };

        const tableRect = tableEl.getBoundingClientRect();
        let top: number;
        if (insertBefore === 0) {
          top = rows[0].getBoundingClientRect().top;
        } else if (insertBefore >= rows.length) {
          top = rows[rows.length - 1].getBoundingClientRect().bottom;
        } else {
          top = rows[insertBefore - 1].getBoundingClientRect().bottom;
        }

        setDropIndicatorStyle({
          position: "fixed",
          top: top - 1,
          left: tableRect.left,
          width: tableRect.width,
          height: 2,
          backgroundColor: "#1565c0",
          borderRadius: 1,
          pointerEvents: "none",
          zIndex: 9999,
        });
      } else {
        const headerRow = tableEl.querySelector("tr");
        if (!headerRow) return;
        const cells = Array.from(headerRow.querySelectorAll("td, th"));
        if (!cells.length) return;

        let insertBefore = cells.length;
        for (let i = 0; i < cells.length; i++) {
          const rect = cells[i].getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            insertBefore = i;
            break;
          }
        }
        dropInsertRef.current = { type: "col", insertBefore };

        const tableRect = tableEl.getBoundingClientRect();
        let left: number;
        if (insertBefore === 0) {
          left = cells[0].getBoundingClientRect().left;
        } else if (insertBefore >= cells.length) {
          left = cells[cells.length - 1].getBoundingClientRect().right;
        } else {
          left = cells[insertBefore - 1].getBoundingClientRect().right;
        }

        setDropIndicatorStyle({
          position: "fixed",
          top: tableRect.top,
          left: left - 1,
          width: 2,
          height: tableRect.height,
          backgroundColor: "#1565c0",
          borderRadius: 1,
          pointerEvents: "none",
          zIndex: 9999,
        });
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const ds = dragStateRef.current;
      const di = dropInsertRef.current;
      if (ds && di) {
        if (ds.type === "row") {
          moveTableRow(editor, ds.tableEl, ds.fromIndex, di.insertBefore);
        } else {
          moveTableCol(editor, ds.tableEl, ds.fromIndex, di.insertBefore);
        }
      }
      clearDragState();
    };

    const onDragEnd = () => clearDragState();

    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    document.addEventListener("dragend", onDragEnd);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", onDragEnd);
    };
  }, [editor, clearDragState]);

  const handleRowGripClick = (e: React.MouseEvent<HTMLElement>, rowIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setRowMenuPos({ top: rect.bottom, left: rect.left });
    setActiveRowIndex(rowIndex);
  };

  const handleColGripClick = (e: React.MouseEvent<HTMLElement>, colIndex: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setColMenuPos({ top: rect.bottom, left: rect.left });
    setActiveColIndex(colIndex);
  };

  const closeRowMenu = () => {
    setRowMenuPos(null);
    setActiveRowIndex(-1);
    setHoveredRow(null);
    setHoveredColumn(null);
    onGripLeave();
  };

  const closeColMenu = () => {
    setColMenuPos(null);
    setActiveColIndex(-1);
    setHoveredRow(null);
    setHoveredColumn(null);
    onGripLeave();
  };

  const focusHoveredTable = (rowIndex: number, colIndex: number) => {
    focusCellAt(editor, tableRef.current, rowIndex, colIndex);
  };

  const handleRowAction = (action: "addAbove" | "addBelow" | "delete") => {
    focusHoveredTable(activeRowIndex, 0);
    switch (action) {
      case "addAbove":
        editor.chain().focus().addRowBefore().run();
        break;
      case "addBelow":
        editor.chain().focus().addRowAfter().run();
        break;
      case "delete":
        editor.chain().focus().deleteRow().run();
        break;
    }
    closeRowMenu();
  };

  const handleColAction = (action: "addLeft" | "addRight" | "delete") => {
    focusHoveredTable(0, activeColIndex);
    switch (action) {
      case "addLeft":
        editor.chain().focus().addColumnBefore().run();
        break;
      case "addRight":
        editor.chain().focus().addColumnAfter().run();
        break;
      case "delete":
        editor.chain().focus().deleteColumn().run();
        break;
    }
    closeColMenu();
  };

  if (!position) {
    return null;
  }

  const isHeaderRow = hoveredRow?.index === 0;

  const gripButtonStyles = {
    minWidth: 0,
    padding: "1px 2px",
    borderRadius: "3px",
    bgcolor: "rgba(55, 53, 47, 0.06)",
    color: "rgba(55, 53, 47, 0.35)",
    "&:hover": { bgcolor: "rgba(55, 53, 47, 0.1)", color: "rgba(55, 53, 47, 0.6)" },
    zIndex: 1200,
    cursor: "grab",
  } as const;

  const rowGrip =
    hoveredRow && !rowMenuPos && !isDragging ? (
      <IconButton
        data-table-grip="row"
        draggable
        size="small"
        onClick={(e) => handleRowGripClick(e, hoveredRow.index)}
        onDragStart={(e) => handleRowDragStart(e, hoveredRow.index)}
        onMouseEnter={onGripEnter}
        onMouseLeave={onGripLeave}
        aria-label="Row options"
        sx={{
          ...gripButtonStyles,
          position: "absolute",
          top: hoveredRow.top,
          left: position.left - 22,
          width: 20,
          height: hoveredRow.height,
          borderRadius: "3px 0 0 3px",
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: 14 }} />
      </IconButton>
    ) : null;

  const colGrip =
    hoveredColumn && !colMenuPos && !isDragging ? (
      <IconButton
        data-table-grip="column"
        draggable
        size="small"
        onClick={(e) => handleColGripClick(e, hoveredColumn.index)}
        onDragStart={(e) => handleColDragStart(e, hoveredColumn.index)}
        onMouseEnter={onGripEnter}
        onMouseLeave={onGripLeave}
        aria-label="Column options"
        sx={{
          ...gripButtonStyles,
          position: "absolute",
          top: position.top - 20,
          left: hoveredColumn.left,
          width: hoveredColumn.width,
          height: 18,
          borderRadius: "3px 3px 0 0",
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: 14, transform: "rotate(90deg)" }} />
      </IconButton>
    ) : null;

  const addColumnButton = (
    <IconButton
      size="small"
      onClick={() => {
        const lastColIndex =
          (tableRef.current?.querySelector("tr")?.querySelectorAll("td, th").length ??
            1) - 1;
        focusHoveredTable(0, lastColIndex);
        editor.chain().focus().addColumnAfter().run();
      }}
      onMouseEnter={onGripEnter}
      onMouseLeave={onGripLeave}
      aria-label="Add column at end"
      sx={{
        position: "absolute",
        top: position.top,
        left: position.left + position.width + 4,
        width: 24,
        height: position.height,
        borderRadius: "0 4px 4px 0",
        bgcolor: "#f0f0f0",
        "&:hover": { bgcolor: "#e0e0e0" },
        zIndex: 1200,
      }}
    >
      <AddIcon sx={{ fontSize: 16 }} />
    </IconButton>
  );

  const addRowButton = (
    <IconButton
      size="small"
      onClick={() => {
        const lastRowIndex = (tableRef.current?.querySelectorAll("tr").length ?? 1) - 1;
        focusHoveredTable(lastRowIndex, 0);
        editor.chain().focus().addRowAfter().run();
      }}
      onMouseEnter={onGripEnter}
      onMouseLeave={onGripLeave}
      aria-label="Add row at end"
      sx={{
        position: "absolute",
        top: position.top + position.height + 4,
        left: position.left,
        width: position.width,
        height: 24,
        borderRadius: "0 0 4px 4px",
        bgcolor: "#f0f0f0",
        "&:hover": { bgcolor: "#e0e0e0" },
        zIndex: 1200,
      }}
    >
      <AddIcon sx={{ fontSize: 16 }} />
    </IconButton>
  );

  return createPortal(
    <>
      {rowGrip}
      {colGrip}
      {!isDragging && addColumnButton}
      {!isDragging && addRowButton}
      {dropIndicatorStyle && <div style={dropIndicatorStyle} />}

      <Menu
        open={Boolean(rowMenuPos)}
        onClose={closeRowMenu}
        anchorReference="anchorPosition"
        anchorPosition={rowMenuPos ?? undefined}
        slotProps={{ paper: { sx: { minWidth: 160 } } }}
      >
        <MenuItem onClick={() => handleRowAction("addAbove")}>
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>上に行を追加</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleRowAction("addBelow")}>
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>下に行を追加</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => handleRowAction("delete")} disabled={isHeaderRow}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: isHeaderRow ? undefined : "error.main" }}>
            行を削除
          </ListItemText>
        </MenuItem>
      </Menu>

      <Menu
        open={Boolean(colMenuPos)}
        onClose={closeColMenu}
        anchorReference="anchorPosition"
        anchorPosition={colMenuPos ?? undefined}
        slotProps={{ paper: { sx: { minWidth: 160 } } }}
      >
        <MenuItem onClick={() => handleColAction("addLeft")}>
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>左に列を追加</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleColAction("addRight")}>
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>右に列を追加</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => handleColAction("delete")}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>列を削除</ListItemText>
        </MenuItem>
      </Menu>
    </>,
    document.body
  );
}
