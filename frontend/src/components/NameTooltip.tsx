import type { ReactElement } from "react";
import Tooltip, { type TooltipProps } from "@mui/material/Tooltip";

interface NameTooltipProps {
  name: string;
  /**
   * Defaults to "right" for the vertical sidebar list. Horizontal strips (the
   * editor tab bar) pass "bottom" so the tooltip doesn't cover its neighbours.
   */
  placement?: TooltipProps["placement"];
  children: ReactElement;
}

/**
 * Hover tooltip that shows a file/directory name in full (#192).
 *
 * Sidebar rows and editor tabs render their name with an ellipsis, so a long
 * name is unreadable until the pane is resized or the name is copied from the
 * context menu. The enter delay keeps the tooltip from firing while the pointer
 * merely sweeps across rows on the way somewhere else; enterNextDelay is
 * shorter so moving between neighbours while scanning stays responsive.
 *
 * describeChild matters here: without it MUI puts `aria-label={title}` on the
 * child, replacing its own accessible name. The recent view's rows read out
 * directory path + timestamp + file name, and that would collapse to just the
 * file name. The tooltip is supplementary, so it is attached as a description.
 */
export function NameTooltip({
  name,
  placement = "right",
  children,
}: NameTooltipProps) {
  return (
    <Tooltip
      title={name}
      placement={placement}
      enterDelay={500}
      enterNextDelay={200}
      disableInteractive
      describeChild
    >
      {children}
    </Tooltip>
  );
}
