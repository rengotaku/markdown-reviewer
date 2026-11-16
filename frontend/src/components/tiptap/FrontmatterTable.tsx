import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
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
 * Read-only table of a file's YAML frontmatter. Shown inside the header's
 * frontmatter dialog (#398) — it used to sit collapsed above the editor,
 * where it read as part of the document. The values are display-only;
 * the source frontmatter is round-tripped verbatim on save.
 */
export function FrontmatterTable({ entries }: FrontmatterTableProps) {
  if (entries.length === 0) return null;

  return (
    <Table size="small" data-testid="frontmatter-table">
      <TableBody>
        {entries.map((entry) => (
          <TableRow
            key={entry.key}
            sx={{ "&:last-child td, &:last-child th": { border: 0 } }}
          >
            <TableCell
              component="th"
              scope="row"
              sx={{
                width: "1%",
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
  );
}
