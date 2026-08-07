import { useState, useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CodeIcon from "@mui/icons-material/Code";
import AccountTreeIcon from "@mui/icons-material/AccountTree";

type MermaidApi = typeof import("mermaid").default;

/** Which face of the block is showing: the rendered diagram or its source. */
type ViewMode = "diagram" | "source";

/** Bounds for the auto-sized source textarea (in text rows). */
const MIN_SOURCE_ROWS = 4;
const MAX_SOURCE_ROWS = 40;

let mermaidPromise: Promise<MermaidApi> | null = null;

/**
 * loadMermaid imports mermaid on first use and initializes it once. mermaid
 * (plus its diagram bundles) is ~1MB, so keeping it out of the entry chunk
 * matters for files that contain no diagram at all (issue #189).
 */
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        // We surface parse errors ourselves; without this mermaid also injects
        // its own error diagram into the page on a failed render.
        suppressErrorRendering: true,
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** Replaces the container's content with a single styled text node. */
function showMessage(el: HTMLElement, tag: "p" | "pre", text: string, css: string) {
  const node = document.createElement(tag);
  node.setAttribute("style", css);
  node.textContent = text;
  el.replaceChildren(node);
}

export function MermaidBlockView({ node, updateAttributes }: NodeViewProps) {
  /**
   * The block shows either the rendered chart or its mermaid source, toggled
   * from the button in the corner. The source face doubles as the editor —
   * edits are committed on blur, on Mod-Enter, and when switching back to the
   * chart, so toggling never silently drops what was typed.
   */
  const [mode, setMode] = useState<ViewMode>("diagram");
  const [draft, setDraft] = useState(node.attrs.code as string);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Renders the current source into the container. Async mermaid renders can
   * finish out of order (fast edits, or the first call that also loads the
   * library) or after teardown, so the caller passes an `isStale` probe that
   * every await point re-checks before touching the DOM.
   */
  const renderDiagram = useCallback(async (isStale: () => boolean) => {
    const el = containerRef.current;
    if (!el || mode === "source") return;

    const code = node.attrs.code as string;
    if (!code.trim()) {
      showMessage(el, "p", "Empty mermaid block", "color: #999; font-style: italic;");
      return;
    }

    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    try {
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(id, code);
      if (isStale()) return;
      el.innerHTML = svg;
    } catch (err) {
      if (isStale()) return;
      const detail = err instanceof Error ? err.message : String(err);
      showMessage(el, "pre", detail, "color: #d32f2f; font-size: 0.85em; white-space: pre-wrap;");
    }
  }, [node.attrs.code, mode]);

  useEffect(() => {
    // Each effect run owns its own flag; tearing the run down (unmount, or a
    // fresh source) marks its in-flight render stale so a late resolve can't
    // write into a container that has moved on.
    let stale = false;
    renderDiagram(() => stale);
    return () => {
      stale = true;
    };
  }, [renderDiagram]);

  /** Writes the draft back into the node, unless it is unchanged. */
  const commitDraft = useCallback(() => {
    if (draft !== node.attrs.code) updateAttributes({ code: draft });
  }, [draft, node.attrs.code, updateAttributes]);

  const showSource = () => {
    setDraft(node.attrs.code as string);
    setMode("source");
  };

  const showDiagram = () => {
    commitDraft();
    setMode("diagram");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      showDiagram();
    }
  };

  const isSource = mode === "source";
  const sourceRows = Math.min(Math.max(draft.split("\n").length, MIN_SOURCE_ROWS), MAX_SOURCE_ROWS);

  return (
    <NodeViewWrapper>
      <Box
        sx={{
          border: "1px solid #e0e0e0",
          borderRadius: 1,
          my: 1,
          overflow: "hidden",
          position: "relative",
          "&:hover .mermaid-actions, &:focus-within .mermaid-actions": { opacity: 1 },
        }}
        contentEditable={false}
      >
        <Box
          className="mermaid-actions"
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            // Keep the way back to the chart visible while the source shows;
            // the chart face reveals the button on hover instead.
            opacity: isSource ? 1 : 0,
            transition: "opacity 0.2s",
            zIndex: 1,
          }}
        >
          <Tooltip title={isSource ? "チャートを表示" : "mermaid ソースを表示"}>
            <IconButton
              size="small"
              onClick={isSource ? showDiagram : showSource}
              aria-label={isSource ? "show mermaid chart" : "show mermaid source"}
              sx={{ bgcolor: "background.paper" }}
            >
              {isSource ? (
                <AccountTreeIcon fontSize="small" />
              ) : (
                <CodeIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>

        {isSource ? (
          <Box
            component="textarea"
            value={draft}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitDraft}
            aria-label="mermaid source"
            spellCheck={false}
            autoFocus
            // Sized to the source so the whole diagram definition is visible
            // when toggled; still resizable for very long definitions.
            rows={sourceRows}
            sx={{
              width: "100%",
              p: 2,
              // Room for the toggle button so it never covers the first line.
              pr: 6,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "0.875rem",
              border: "none",
              outline: "none",
              resize: "vertical",
              bgcolor: "#f5f5f5",
            }}
          />
        ) : (
          <Box
            ref={containerRef}
            sx={{
              p: 2,
              display: "flex",
              justifyContent: "center",
              "& svg": { maxWidth: "100%" },
            }}
          />
        )}
      </Box>
    </NodeViewWrapper>
  );
}
