import { useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { FrontmatterEntry, FrontmatterValue } from "@/utils/frontmatter";

function scalarLabel(value: FrontmatterValue): string {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const emptyDash = (
  <Typography component="span" sx={{ color: "text.disabled" }}>
    —
  </Typography>
);

function renderValue(value: FrontmatterValue): ReactNode {
  if (value === null || value === undefined) return emptyDash;

  if (Array.isArray(value)) {
    if (value.length === 0) return emptyDash;
    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {value.map((item, i) => (
          <Chip key={i} size="small" variant="outlined" label={scalarLabel(item)} />
        ))}
      </Box>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return emptyDash;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {entries.map(([k, v]) => (
          <Box key={k} sx={{ display: "flex", gap: 1 }}>
            <Box component="span" sx={{ fontWeight: 600, color: "text.secondary" }}>
              {k}:
            </Box>
            <Box component="span">{renderValue(v)}</Box>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Typography component="span" sx={{ wordBreak: "break-word" }}>
      {scalarLabel(value)}
    </Typography>
  );
}

interface FrontmatterTableProps {
  entries: FrontmatterEntry[];
}

/**
 * Read-only, collapsible table that renders a file's YAML frontmatter above
 * the editor. The values are display-only — editing is not supported; the
 * source frontmatter is round-tripped verbatim on save.
 */
export function FrontmatterTable({ entries }: FrontmatterTableProps) {
  // Collapsed by default — frontmatter is reference metadata, kept out of the
  // way until the reviewer expands it.
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <Box className="frontmatter-panel">
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="frontmatter-toggle"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          p: "2px 6px",
          mb: 0.5,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "text.secondary",
          borderRadius: 1,
          fontSize: "0.75rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          "&:hover": { backgroundColor: "action.hover" },
        }}
      >
        {open ? (
          <ExpandMoreIcon fontSize="small" />
        ) : (
          <ChevronRightIcon fontSize="small" />
        )}
        Frontmatter
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            backgroundColor: "grey.50",
            overflow: "hidden",
          }}
        >
          <Table size="small" data-testid="frontmatter-table">
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.key} sx={{ "&:last-child td": { border: 0 } }}>
                  <TableCell
                    component="th"
                    scope="row"
                    sx={{
                      width: 200,
                      fontWeight: 600,
                      color: "text.secondary",
                      verticalAlign: "top",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.key}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>
                    {renderValue(entry.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}
