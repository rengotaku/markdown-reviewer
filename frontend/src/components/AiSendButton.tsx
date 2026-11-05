import { useEffect, useId, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import SendIcon from "@mui/icons-material/Send";
import type { AgentStatusResponse } from "@/api";
import { agentLabel } from "@/utils/agentActivity";
import { CountBadge } from "./CountBadge";

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Re-renders only this button once a second while busy, not the editor. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [since]);
  return since === null ? "" : formatElapsed(now - since);
}

/** Same as MUI's visuallyHidden: read by screen readers, never drawn. */
const VISUALLY_HIDDEN_SX = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;

interface Props {
  status: AgentStatusResponse | null;
  busySince: number | null;
  newReplyCount: number;
  /** Open comments this editor's send handed over, while the AI works on
   *  them (#366). Omitted when the busy period came from elsewhere. */
  sentCount?: number | null;
  /** Comments not yet sent to the AI; drawn as an outlined badge. */
  unsentCount?: number | null;
  disabled?: boolean;
  onSend: () => void;
  onShowReplies: () => void;
}

/** The header's "AI へ送信" button (#390). Icon only: the AI recipient's state
 *  (#360, formerly a dot beside the button) shows in the button's look and
 *  tooltip, and new replies are a green count badge that is its own button. */
export function AiSendButton({
  status,
  busySince,
  newReplyCount,
  sentCount = null,
  unsentCount = null,
  disabled = false,
  onSend,
  onShowReplies,
}: Props) {
  const elapsed = useElapsed(busySince);
  const descId = useId();
  const name = status?.agent_id ? agentLabel(status.agent_id) : "";
  const state = status?.state ?? null;
  const isBusy = state === "busy";
  const isNone = state === "none";

  // `live` is what the screen-reader region speaks: no ticking timer, so it
  // announces once per state change rather than every second.
  let detail = "";
  let live = "";
  if (isBusy) {
    const sent = sentCount === null ? "" : ` · 送信 ${sentCount} 件`;
    detail = `${name} 返信中 ${elapsed}${sent}。いま押すとコマンドのコピー`;
    live = `${name} 返信中`;
  } else if (isNone) {
    detail = "";
    live = `${name || "AI"} 未接続`;
  } else if (state === "background") {
    detail = `${name} 裏で処理中。送信できます`;
    live = `${name} 裏で処理中`;
  } else if (state === "idle") {
    detail = `${name} 待機中`;
    live = `${name} 待機中`;
  }
  const title = isNone
    ? "コマンドをコピー（送信先のセッションが見つかりません）"
    : detail
      ? `AI へ送信（${detail}）`
      : "AI へ送信";

  return (
    <Box
      component="span"
      sx={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
    >
      <Tooltip title={title}>
        <Box component="span" sx={{ display: "inline-flex" }}>
          <Button
            size="small"
            variant={isNone ? "outlined" : "contained"}
            color={isNone ? "inherit" : "primary"}
            disableElevation
            onClick={onSend}
            disabled={disabled}
            aria-label="AI へ送信"
            // The Tooltip labels its span wrapper, not this button, so the
            // state and the copy-instead-of-send cases are tied on here.
            aria-describedby={descId}
            data-testid="editor-copy-review-command"
            sx={[
              { minWidth: 0, px: 1, py: 0.5, lineHeight: 0 },
              isNone
                ? {
                    borderStyle: "dashed",
                    borderColor: "divider",
                    color: "text.secondary",
                    "&:hover": { borderStyle: "dashed" },
                  }
                : {},
            ]}
          >
            {isBusy ? (
              <CircularProgress
                size={18}
                color="inherit"
                thickness={5}
                data-testid="editor-send-spinner"
              />
            ) : (
              <SendIcon fontSize="small" data-testid="editor-send-icon" />
            )}
            {unsentCount !== null && unsentCount > 0 && (
              <CountBadge
                count={unsentCount}
                label="未送信"
                variant="outlined"
                placement="bottom"
                testId="editor-unsent-count"
              />
            )}
          </Button>
        </Box>
      </Tooltip>
      <Box component="span" id={descId} sx={VISUALLY_HIDDEN_SX}>
        {title}
      </Box>
      {state && (
        <Box
          component="span"
          role="status"
          aria-live="polite"
          data-testid="editor-agent-status"
          data-state={state}
          sx={VISUALLY_HIDDEN_SX}
        >
          {live}
          {isBusy && sentCount !== null && (
            <span data-testid="editor-agent-sent-count"> · 送信 {sentCount} 件</span>
          )}
        </Box>
      )}
      {/* Hidden while the state is unknown too (a failed poll keeps the busy
          baseline): acknowledging then would drop replies still arriving. */}
      {state !== null && !isBusy && newReplyCount > 0 && (
        <Tooltip title={`新しい返信 ${newReplyCount} 件（押すと最初の返信へ移動）`}>
          <ButtonBase
            onClick={onShowReplies}
            data-testid="editor-agent-new-replies"
            aria-label={`新しい返信 ${newReplyCount} 件（押すと最初の返信へ移動）`}
            sx={{
              position: "absolute",
              top: -4,
              right: -6,
              minWidth: 16,
              height: 16,
              px: 0.5,
              boxSizing: "border-box",
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              bgcolor: "success.main",
              color: "success.contrastText",
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
            }}
          >
            {newReplyCount}
          </ButtonBase>
        </Tooltip>
      )}
    </Box>
  );
}
