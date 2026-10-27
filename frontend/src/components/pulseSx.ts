import { keyframes } from "@mui/material/styles";

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;

/** Pulsing dot shared by the header indicator, the send button badge and the
 *  comment rail's "replying" row. */
export const pulseSx = {
  animation: `${blink} 1.1s ease-in-out infinite`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;
