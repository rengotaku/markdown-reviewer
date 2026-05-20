import { useState, useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "default" });

export function MermaidBlockView({ node, updateAttributes }: NodeViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editCode, setEditCode] = useState(node.attrs.code as string);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderDiagram = useCallback(async () => {
    const el = containerRef.current;
    if (!el || isEditing) return;

    const code = node.attrs.code as string;
    if (!code.trim()) {
      el.innerHTML =
        '<p style="color: #999; font-style: italic;">Empty mermaid block</p>';
      return;
    }

    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    try {
      const { svg } = await mermaid.render(id, code);
      el.innerHTML = svg;
    } catch {
      el.innerHTML =
        '<pre style="color: #d32f2f; font-size: 0.85em;">Invalid mermaid syntax</pre>';
    }
  }, [node.attrs.code, isEditing]);

  useEffect(() => {
    renderDiagram();
  }, [renderDiagram]);

  const handleSave = () => {
    updateAttributes({ code: editCode });
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <NodeViewWrapper>
      <Box
        sx={{
          border: "1px solid #e0e0e0",
          borderRadius: 1,
          my: 1,
          overflow: "hidden",
          position: "relative",
          "&:hover .mermaid-actions": { opacity: 1 },
        }}
        contentEditable={false}
      >
        <Box
          className="mermaid-actions"
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            opacity: 0,
            transition: "opacity 0.2s",
            zIndex: 1,
          }}
        >
          {isEditing ? (
            <IconButton
              size="small"
              onClick={handleSave}
              aria-label="Save mermaid"
              sx={{ bgcolor: "background.paper" }}
            >
              <CheckIcon fontSize="small" />
            </IconButton>
          ) : (
            <IconButton
              size="small"
              onClick={() => {
                setEditCode(node.attrs.code as string);
                setIsEditing(true);
              }}
              aria-label="Edit mermaid"
              sx={{ bgcolor: "background.paper" }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {isEditing ? (
          <Box
            component="textarea"
            value={editCode}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setEditCode(e.target.value)
            }
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            autoFocus
            sx={{
              width: "100%",
              minHeight: 120,
              p: 2,
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
