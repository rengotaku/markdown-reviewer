import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PublicIcon from "@mui/icons-material/Public";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { CountBadge } from "./CountBadge";

export type GlobalBadgeKind = "global" | "orphan";

interface Props {
  globalCount: number;
  orphanCount: number;
  /** The orphan button only means something once the file is under review;
   *  before that there are no comments to have lost their place. */
  showOrphan?: boolean;
  onOpen: (kind: GlobalBadgeKind) => void;
  /** Opens the global-comment composer beside `anchor`. The globe goes
   *  straight here while there is nothing to list yet. */
  onAddGlobal: (anchor: DOMRect) => void;
}

/** The 位置不明 and 全体 buttons of the comment pane's second row (#316, #390).
 *  #394: they used to be a "全体 N" chip next to a separate globe button for
 *  adding one — two globes meaning two things. Now a single globe carries the
 *  count: with global comments it opens GlobalCommentsDialog (whose footer
 *  adds one), with none it opens the composer directly. The orphan button is
 *  view-only (an orphan cannot be created) and renders only while it has a
 *  count, so the globe and the add button to its right never move. */
export function GlobalCommentBadges({
  globalCount,
  orphanCount,
  showOrphan = true,
  onOpen,
  onAddGlobal,
}: Props) {
  const globalLabel =
    globalCount > 0
      ? `ファイル全体へのコメント（${globalCount} 件）`
      : "ファイル全体にコメントを追加（選択不要・未取り込みなら自動で取り込む）";
  const orphanLabel = `位置不明のコメント（${orphanCount} 件）`;

  return (
    <>
      {showOrphan && orphanCount > 0 && (
        <Tooltip title={orphanLabel}>
          <IconButton
            size="small"
            color="warning"
            onClick={() => onOpen("orphan")}
            aria-label={orphanLabel}
            data-testid="orphan-comment-badge"
            sx={{ flexShrink: 0 }}
          >
            <WarningAmberIcon fontSize="small" />
            <CountBadge count={orphanCount} color="warning" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={globalLabel}>
        <IconButton
          size="small"
          color="primary"
          onClick={(e) => {
            if (globalCount > 0) onOpen("global");
            else onAddGlobal(e.currentTarget.getBoundingClientRect());
          }}
          aria-label={globalLabel}
          data-testid="global-comment-badge"
          sx={{ flexShrink: 0 }}
        >
          <PublicIcon fontSize="small" />
          {globalCount > 0 && <CountBadge count={globalCount} />}
        </IconButton>
      </Tooltip>
    </>
  );
}
