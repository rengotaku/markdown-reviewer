import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import DataObjectIcon from "@mui/icons-material/DataObject";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { parseFrontmatter, splitPreamble } from "@/utils/frontmatter";
import { CountBadge } from "./CountBadge";
import { FrontmatterTable } from "./tiptap/FrontmatterTable";

/**
 * #398: header button that opens the active file's YAML frontmatter in a
 * dialog. Frontmatter used to sit collapsed above the editor, where it read
 * as part of the document; it is reference metadata, so it now lives behind
 * a header icon. Renders nothing when the file has no frontmatter.
 */
export function FrontmatterButton() {
  const { active: activeRoot } = useActiveRoot();
  const activeMarkdown = useOpenFiles((s) => {
    const id = activeRoot ? s.activeIdByRoot[activeRoot] : null;
    const file = id ? s.files.find((f) => f.id === id) : undefined;
    return file ? file.markdown : "";
  });
  const entries = useMemo(
    () => parseFrontmatter(splitPreamble(activeMarkdown).frontmatterYaml),
    [activeMarkdown]
  );
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <>
      <Tooltip title={`frontmatter（${entries.length} 項目）`}>
        <IconButton
          size="small"
          sx={{ flexShrink: 0 }}
          onClick={() => setOpen(true)}
          aria-label="frontmatter を表示"
          aria-haspopup="dialog"
          data-testid="editor-frontmatter-button"
        >
          <DataObjectIcon fontSize="small" />
          <CountBadge
            count={entries.length}
            label="frontmatter"
            testId="editor-frontmatter-count"
          />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        data-testid="frontmatter-dialog"
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
          <Box sx={{ flexGrow: 1, display: "flex", alignItems: "baseline", gap: 1 }}>
            <Typography variant="subtitle1" component="span">
              frontmatter
            </Typography>
            <Typography variant="caption" component="span" color="text.secondary">
              読み取り専用
            </Typography>
          </Box>
          <IconButton
            onClick={() => setOpen(false)}
            aria-label="閉じる"
            data-testid="frontmatter-dialog-close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <FrontmatterTable entries={entries} />
        </DialogContent>
      </Dialog>
    </>
  );
}
