import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import type { SvgIconComponent } from "@mui/icons-material";
import ContrastIcon from "@mui/icons-material/Contrast";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";

export type StatusFilter = "all" | "open" | "resolved";

interface Props {
  value: StatusFilter;
  onChange: (next: StatusFilter) => void;
  allCount: number;
  openCount: number;
  resolvedCount: number;
}

interface Option {
  value: StatusFilter;
  label: string;
  Icon: SvgIconComponent;
}

/** ◐ = both halves (open and resolved), ○ = not yet checked, ✓ = the same
 *  mark the card's 解決済みにする button uses. */
const OPTIONS: ReadonlyArray<Option> = [
  { value: "all", label: "すべて", Icon: ContrastIcon },
  { value: "open", label: "未解決", Icon: RadioButtonUncheckedIcon },
  { value: "resolved", label: "解決済み", Icon: CheckCircleOutlineIcon },
];

/** #394: the comment pane's status filter as three icon toggles with their
 *  counts. It was a select (#390) whose closed state showed one status only;
 *  as icons all three counts stay visible at 30px high, matching the row's
 *  buttons. An icon alone says little, so each carries a tooltip and an
 *  accessible name spelling out the status and count. */
export function StatusFilterToggle({
  value,
  onChange,
  allCount,
  openCount,
  resolvedCount,
}: Props) {
  const counts: Record<StatusFilter, number> = {
    all: allCount,
    open: openCount,
    resolved: resolvedCount,
  };
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      // Pressing the selected toggle again reports null; keep the filter.
      onChange={(_, next: StatusFilter | null) => {
        if (next) onChange(next);
      }}
      aria-label="コメントの表示フィルタ"
      data-testid="comment-status-filter"
      sx={{ height: 30, flexShrink: 0 }}
    >
      {OPTIONS.map(({ value: v, label, Icon }) => {
        const name = `${label}（${counts[v]} 件）を表示`;
        return (
          <ToggleButton
            key={v}
            value={v}
            aria-label={name}
            data-testid={`comment-filter-${v}`}
            sx={{ px: 0.75, py: 0, fontSize: "0.75rem", lineHeight: 1 }}
          >
            {/* The Tooltip sits inside: ToggleButtonGroup clones its direct
                children and needs them to be the ToggleButtons. */}
            <Tooltip title={name}>
              <Box
                component="span"
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.375 }}
              >
                <Icon sx={{ fontSize: 16 }} />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{counts[v]}</span>
              </Box>
            </Tooltip>
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}
