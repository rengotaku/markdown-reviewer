import { createContext } from "react";

/** What the comment cards need to know about the AI session (#360). Passed
 *  through context so every rail mode (aligned / list / icons) gets it
 *  without threading props through each layout. */
export interface AgentCardActivity {
  /** The AI is working on this file's comments after a send from here. */
  replying: boolean;
  /** New AI replies per comment id since that work began. */
  newReplies: ReadonlyMap<string, number>;
  /** Open comment ids the last send handed over (#366). A card outside it was
   *  written after the send, so the AI working now has not read it. */
  sentIds: ReadonlySet<string> | null;
}

export const AgentActivityContext = createContext<AgentCardActivity>({
  replying: false,
  newReplies: new Map(),
  sentIds: null,
});
