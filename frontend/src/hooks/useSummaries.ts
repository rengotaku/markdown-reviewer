import { useCallback, useEffect, useState } from "react";
import { getSummaries, type SummaryItem } from "@/api";
import { readSummarySeen, writeSummarySeen } from "@/utils/summaries";

export interface SummariesState {
  /** Newest first. */
  summaries: ReadonlyArray<SummaryItem>;
  /** Id of the newest summary the reader has opened; null when none. */
  lastSeenId: string | null;
  markRead: () => void;
}

/** AI work summaries for the active file. Fetched when the file opens, each
 *  time the AI goes from busy to not busy, and when a status poll reports it
 *  stored a summary (`savedId`): the transcript can be written a poll after
 *  the session goes idle. */
export function useSummaries(
  path: string | undefined,
  root: string | undefined,
  busy: boolean,
  savedId?: string
): SummariesState {
  const key = path ? `${root ?? ""}:${path}` : "";
  const [loaded, setLoaded] = useState<{
    key: string;
    items: ReadonlyArray<SummaryItem>;
  }>({ key: "", items: [] });
  const [seen, setSeen] = useState<{ key: string; id: string | null }>({
    key: "",
    id: null,
  });
  const [wasBusy, setWasBusy] = useState(false);
  const [tick, setTick] = useState(0);

  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (wasBusy && !busy) setTick((n) => n + 1);
  }

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    getSummaries(root, path)
      .then((res) => {
        if (!cancelled) setLoaded({ key, items: res.summaries ?? [] });
      })
      .catch(() => {
        // Summaries are a convenience; a failed fetch keeps what is shown.
      });
    return () => {
      cancelled = true;
    };
  }, [path, root, key, tick, savedId]);

  const summaries = loaded.key === key ? loaded.items : [];
  const lastSeenId =
    seen.key === key ? seen.id : path ? readSummarySeen(root, path) : null;
  const newestId = summaries[0]?.id;

  const markRead = useCallback(() => {
    if (!path || !newestId) return;
    writeSummarySeen(root, path, newestId);
    setSeen({ key, id: newestId });
  }, [path, root, key, newestId]);

  return { summaries, lastSeenId, markRead };
}
