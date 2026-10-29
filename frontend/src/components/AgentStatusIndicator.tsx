import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
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

/** #376: the indicator is a fixed-size dot. Its words change length with the
 *  state ("待機中" → "返信中 1:08 · 送信 4 件"), which shifted everything to
 *  its right; they now live in the tooltip and, for assistive tech, in a
 *  visually hidden live region. */
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

const SLOT_SX = {
  width: 20,
  height: 20,
  flexShrink: 0,
  ml: 0.5,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
} as const;

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

  // `ring` sets new replies apart from idle, which shares the green.
  const dot = (color: string, pulse = false, hollow = false, ring = false) => (
    <Box
      component="span"
      aria-hidden="true"
      sx={[
        { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
        hollow ? { border: "1.5px solid", borderColor: color } : { bgcolor: color },
        ring ? { outline: "2px solid", outlineColor: color, outlineOffset: "2px" } : {},
        pulse ? pulseSx : {},
      ]}
    />
  );
  const tip = (heading: string, detail: string) => (
    <>
      <Box component="span" sx={{ fontWeight: 500 }}>
        {heading}
      </Box>
      <br />
      {detail}
    </>
  );
  // The elapsed ticker shows in the tooltip only: the live region should speak
  // once per state change, not every second while the timer runs.
  const label = (
    text: string,
    color: string,
    title: string,
    { pulse = false, hollow = false, ticker = "", suffix = "" } = {}
  ) => (
    <Tooltip title={tip([text, ticker, suffix].filter(Boolean).join(" "), title)}>
      <Box
        component="span"
        role="status"
        aria-live="polite"
        data-testid="editor-agent-status"
        data-state={status.state}
        // Focusable so a keyboard reader can open the tooltip the words moved to.
        tabIndex={0}
        sx={[
          SLOT_SX,
          { "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } },
        ]}
      >
        {dot(color, pulse, hollow)}
        <Box component="span" sx={VISUALLY_HIDDEN_SX}>
          {text}
          {suffix && <span data-testid="editor-agent-sent-count"> {suffix}</span>}
        </Box>
      </Box>
    </Tooltip>
  );

  if (status.state === "busy") {
    return label(
      `${name} 返信中`,
      "warning.main",
      `${session}（処理中。いま送信ボタンを押すとコマンドのコピーになります）`,
      {
        pulse: true,
        ticker: elapsed,
        suffix: sentCount === null ? "" : `· 送信 ${sentCount} 件`,
      }
    );
  }
  if (newReplyCount > 0) {
    const text = `${name} の返信 ${newReplyCount} 件`;
    return (
      <Tooltip title={tip(text, "クリックで最初の新しい返信へ移動")}>
        <ButtonBase
          onClick={onShowReplies}
          data-testid="editor-agent-new-replies"
          aria-label={text}
          sx={[
            SLOT_SX,
            { "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } },
          ]}
        >
          {dot("success.main", false, false, true)}
        </ButtonBase>
      </Tooltip>
    );
  }
  if (status.state === "none") {
    return label(
      `${name} 未接続`,
      "text.secondary",
      "このファイルの送信先セッションが見つかりません。送信ボタンはコマンドをコピーします",
      { hollow: true }
    );
  }
  if (status.state === "background") {
    return label(
      `${name} 裏で処理中`,
      "info.main",
      `${session}（応答は終わり、バックグラウンドの処理が残っています。送信できます）`
    );
  }
  return label(`${name} 待機中`, "success.main", `${session}（入力待ち）`);
}
