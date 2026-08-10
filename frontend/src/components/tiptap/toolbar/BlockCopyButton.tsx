import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type { Editor } from "@tiptap/react";
import { useToast } from "@/hooks/useToast";
import { copyTextOf, findCopyableBlock, type CopyableBlock } from "./blockCopy";
import { visibleTableWidth } from "./tableGeometry";

interface BlockCopyButtonProps {
  editor: Editor;
  containerRef: RefObject<HTMLElement | null>;
}

interface Placement {
  top: number;
  left: number;
}

const BUTTON_SIZE = 28;
const INSET = 4;

/**
 * Copy affordance for code blocks and tables (#198).
 *
 * Rendered as a single floating button that follows whichever block the
 * pointer is over, rather than one button per block: the editor is a live
 * ProseMirror document, so per-block chrome would mean node views for two node
 * types and a second source of truth for their DOM. This stays entirely
 * outside the document — no schema change, nothing to serialize.
 *
 * It lives inside the scrolling editor container and is positioned in that
 * container's scrolled coordinate space, so it tracks the block on scroll
 * without a scroll listener.
 */
export function BlockCopyButton({ editor, containerRef }: BlockCopyButtonProps) {
  const [block, setBlock] = useState<CopyableBlock | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const showToast = useToast((s) => s.show);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Hovering the button itself must not count as leaving the block.
      if (target.closest("[data-block-copy-button]")) return;
      const next = findCopyableBlock(target);
      // The frontmatter panel renders its own <table> inside this same
      // scrolling container, but it isn't part of the document — offering to
      // copy it would produce a button whose click can only fail, since
      // posAtDOM has no node for it.
      const inDocument = next !== null && editor.view.dom.contains(next.el);
      setBlock((prev) => {
        const resolved = inDocument ? next : null;
        return prev?.el === resolved?.el ? prev : resolved;
      });
    };
    const handleMouseLeave = () => setBlock(null);

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [containerRef, editor]);

  // Drop the button when its block leaves the document (edit, file switch).
  useEffect(() => {
    if (!block) return;
    const handler = () => {
      if (!block.el.isConnected) setBlock(null);
    };
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor, block]);

  useEffect(() => {
    const container = containerRef.current;
    if (!block || !container) {
      setPlacement(null);
      return;
    }
    const blockRect = block.el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    // A table is `display: block` (#152), so its own rect spans the whole
    // editor column and its right edge is not where the table visually ends —
    // the same trap #171 hit with the "+" buttons.
    const right =
      block.kind === "table"
        ? blockRect.left + visibleTableWidth(block.el)
        : blockRect.right;
    setPlacement({
      top: blockRect.top - containerRect.top + container.scrollTop + INSET,
      left:
        right - containerRect.left + container.scrollLeft - BUTTON_SIZE - INSET,
    });
  }, [block, containerRef]);

  const handleCopy = useCallback(async () => {
    if (!block) return;
    const text = copyTextOf(editor, block);
    if (text === null) {
      showToast("この内容はコピーできませんでした", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(
        block.kind === "code"
          ? "コードをコピーしました"
          : "テーブルを Markdown でコピーしました",
        "success"
      );
    } catch (err) {
      showToast(
        `クリップボードへのコピーに失敗しました: ${(err as Error).message ?? "unknown"}`,
        "error"
      );
    }
  }, [block, editor, showToast]);

  if (!block || !placement) return null;

  return (
    <Box
      data-block-copy-button
      data-testid="block-copy-button"
      data-block-kind={block.kind}
      sx={{
        position: "absolute",
        top: placement.top,
        left: placement.left,
        zIndex: 2,
      }}
    >
      <Tooltip
        title={
          block.kind === "code"
            ? "コードをコピー"
            : "テーブルを Markdown でコピー"
        }
        placement="left"
      >
        <IconButton
          size="small"
          onClick={handleCopy}
          aria-label={
            block.kind === "code" ? "コードをコピー" : "テーブルをコピー"
          }
          sx={{
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            color: "text.secondary",
            "&:hover": { bgcolor: "background.paper", color: "text.primary" },
          }}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
