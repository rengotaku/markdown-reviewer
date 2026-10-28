import { useEffect, useState, type ReactNode } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { AgentStatusResponse } from "@/api";
import { agentLabel } from "@/utils/agentActivity";
import { pulseSx } from "./pulseSx";

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Re-renders only this indicator once a second while busy, not the editor. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [since]);
  return since === null ? "" : formatElapsed(now - since);
}

interface Props {
  status: AgentStatusResponse | null;
  busySince: number | null;
  newReplyCount: number;
  /** Open comments this editor's send handed over, while the AI works on
   *  them (#366). Omitted when the busy period came from elsewhere. */
  sentCount?: number | null;
  onShowReplies: () => void;
}

/** The AI recipient's state beside "レビュー中" (#360). A separate slot from
 *  the review indicator: it describes the session, not the file. */
export function AgentStatusIndicator({
  status,
  busySince,
  newReplyCount,
  sentCount = null,
  onShowReplies,
}: Props) {
  const elapsed = useElapsed(busySince);
  if (!status) return null;
  const name = agentLabel(status.agent_id);
  const session = status.session_name ? `送信先: ${status.session_name}` : "送信先";

  const dot = (color: string, pulse = false, hollow = false) => (
    <Box
      component="span"
      sx={[
        { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
        hollow ? { border: "1.5px solid", borderColor: color } : { bgcolor: color },
        pulse ? pulseSx : {},
      ]}
    />
  );
  // `ticker` is outside what assistive tech announces: the live region should
  // speak once per state change, not every second while the timer runs.
  const label = (
    text: string,
    color: string,
    marker: ReactNode,
    title: string,
    ticker?: string,
    suffix?: string
  ) => (
    <Tooltip title={title}>
      <Typography
        variant="caption"
        role="status"
        aria-live="polite"
        data-testid="editor-agent-status"
        data-state={status.state}
        sx={{
          color,
          flexShrink: 0,
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          ml: 0.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {marker}
        {text}
        {ticker && <span aria-hidden="true">{ticker}</span>}
        {suffix && <span data-testid="editor-agent-sent-count">{suffix}</span>}
      </Typography>
    </Tooltip>
  );

  if (status.state === "busy") {
    return label(
      `${name} 返信中`,
      "warning.main",
      dot("warning.main", true),
      `${session}（処理中。いま送信ボタンを押すとコマンドのコピーになります）`,
      elapsed,
      sentCount === null ? undefined : `· 送信 ${sentCount} 件`
    );
  }
  if (newReplyCount > 0) {
    return (
      <Tooltip title="クリックで最初の新しい返信へ移動">
        <ButtonBase
          onClick={onShowReplies}
          data-testid="editor-agent-new-replies"
          sx={{
            ml: 0.5,
            gap: 0.75,
            flexShrink: 0,
            borderRadius: 0.5,
            typography: "caption",
            color: "success.main",
            textDecoration: "underline",
            textUnderlineOffset: 2,
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
          }}
        >
          {dot("success.main")}
          {`${name} の返信 ${newReplyCount} 件`}
        </ButtonBase>
      </Tooltip>
    );
  }
  if (status.state === "none") {
    return label(
      `${name} 未接続`,
      "text.secondary",
      dot("text.secondary", false, true),
      "このファイルの送信先セッションが見つかりません。送信ボタンはコマンドをコピーします"
    );
  }
  if (status.state === "background") {
    return label(
      `${name} 裏で処理中`,
      "info.main",
      dot("info.main"),
      `${session}（応答は終わり、バックグラウンドの処理が残っています。送信できます）`
    );
  }
  return label(
    `${name} 待機中`,
    "text.secondary",
    dot("success.main"),
    `${session}（入力待ち）`
  );
}
