import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HTTPError } from "ky";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import CloseIcon from "@mui/icons-material/Close";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddCommentIcon from "@mui/icons-material/AddComment";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CommentIcon from "@mui/icons-material/Comment";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { TiptapEditor } from "@/components/tiptap/TiptapEditor";
import {
  Sidebar,
  RootTabs,
  ToastViewport,
  ConfirmDialog,
  AddCommentDialog,
  CommentSidePane,
  DiffView,
} from "@/components";
import { useOpenFiles, reattachLegacyFilesToRoot } from "@/hooks/useOpenFiles";
import { useReadFile, useWriteFile } from "@/hooks/useFileContent";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useDirChangeWatcher } from "@/hooks/useDirChangeWatcher";
import { useServerEvents } from "@/hooks/useServerEvents";
import { useServerConnection } from "@/hooks/useServerConnection";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/hooks/useUIStore";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
import { useCommentAuthor } from "@/hooks/useCommentAuthor";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useQueryClient } from "@tanstack/react-query";
import {
  statFile,
  ingestFile,
  listRevisions,
  getRevision,
  listComments,
  createComment,
  setCommentStatus,
  editCommentBody,
  deleteComment,
  replyToComment,
  editReply,
  deleteReply,
  type ReviewState,
  type RevisionMeta,
  type CommentJSON,
} from "@/api";
import { stripHint } from "@/utils/stripHint";
import { formatLocalTimestamp } from "@/utils/formatTimestamp";
import { computeAnchorFromSelection } from "@/utils/pmAnchor";
import { lineDiff, hasChanges } from "@/utils/lineDiff";
import { dirOf } from "@/utils/dirOf";
import type { HighlightComment } from "@/components/tiptap/extensions/CommentHighlight";
import { BAR_HEIGHT, TAB_CONTENT_HEIGHT } from "@/theme/dimensions";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const TARGET_SNIPPET_LENGTH = 60;
const SELECT_FILE_PARAM = "select_file";
// How often to re-poll the active review file's comments for out-of-band
// changes (mr CLI / API / other viewers). Matches the file-tree cadence.
const COMMENTS_POLL_MS = 30_000;

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildTargetSnippet(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (cleaned.length <= TARGET_SNIPPET_LENGTH) return cleaned;
  return `${cleaned.slice(0, TARGET_SNIPPET_LENGTH)}…`;
}

export function EditorPage() {
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isCommentPaneOpen = useUIStore((s) => s.isCommentPaneOpen);
  const toggleCommentPane = useUIStore((s) => s.toggleCommentPane);
  const setSelectedDirPath = useUIStore((s) => s.setSelectedDirPath);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);

  const asideRef = useRef<HTMLDivElement>(null);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!asideRef.current) return;
      const newWidth = ev.clientX - asideRef.current.getBoundingClientRect().left;
      setSidebarWidth(Math.max(180, Math.min(600, newWidth)));
    };

    const onMouseUp = () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const { active: activeRoot, roots } = useActiveRoot();
  const allFiles = useOpenFiles((s) => s.files);
  const activeIdByRoot = useOpenFiles((s) => s.activeIdByRoot);
  // Editor-tab list = open files belonging to the currently selected root.
  // Switching root tabs hot-swaps this list without dropping the other
  // root's open files.
  const files = useMemo(
    () => (activeRoot ? allFiles.filter((f) => f.root === activeRoot) : []),
    [allFiles, activeRoot]
  );
  const activeFileId = activeRoot ? activeIdByRoot[activeRoot] : null;
  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId) ?? undefined,
    [files, activeFileId]
  );
  const openServerFile = useOpenFiles((s) => s.openServerFile);
  const markActiveSaved = useOpenFiles((s) => s.markActiveSaved);
  const discardActiveChanges = useOpenFiles((s) => s.discardActiveChanges);
  const setActive = useOpenFiles((s) => s.setActive);
  const closeFileRaw = useOpenFiles((s) => s.closeFile);
  const closeOthersRaw = useOpenFiles((s) => s.closeOthers);
  const closeToRightRaw = useOpenFiles((s) => s.closeToRight);
  const reorderFiles = useOpenFiles((s) => s.reorderFiles);

  // Right-click tab menu: anchor position + the tab the menu was opened on.
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(
    null
  );

  // Drag-to-reorder: id of the tab currently being dragged (null when idle).
  const [dragTabId, setDragTabId] = useState<string | null>(null);

  // Directory of the active file. Other open tabs sharing this directory get a
  // colored frame so siblings of what you're looking at are easy to spot.
  const activeDir = useMemo(
    () => (activeFile ? dirOf(activeFile.path) : null),
    [activeFile]
  );

  const readFile = useReadFile();
  const writeFile = useWriteFile();
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);
  const editor = useEditorInstance((s) => s.editor);
  const centered = useEditorPrefs((s) => s.centered);
  const toggleCentered = useEditorPrefs((s) => s.toggleCentered);
  const { author } = useCommentAuthor();
  const queryClient = useQueryClient();
  const reviewRootName = activeRoot || "Files";

  // --- Managed-review session state (ingest / revision diff) ---------------
  // Kept local to the editor rather than in the open-files store: it is a view
  // concern derived from the server, refetched whenever the active file or a
  // save/ingest changes it. `reviewRefresh` is bumped to force a refetch.
  const [reviewState, setReviewState] = useState<ReviewState | undefined>(undefined);
  const [revisions, setRevisions] = useState<RevisionMeta[]>([]);
  const [revContents, setRevContents] = useState<Record<string, string>>({});
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [diffMode, setDiffMode] = useState(false);
  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);
  const [diffBaseText, setDiffBaseText] = useState<string>("");
  // Files known to be in "review" state, by `${root}:${path}` — drives the
  // per-tab review badge. Populated as files are visited / ingested (there is
  // no batch state endpoint, so unvisited tabs stay unmarked until activated).
  const [reviewFiles, setReviewFiles] = useState<Set<string>>(new Set());

  // Sidecar comments for the active file (#50). Fetched from the API, not read
  // from the editor — the canonical body is clean. `commentsRefresh` forces a
  // refetch after any create/resolve/reply/delete.
  const [comments, setComments] = useState<CommentJSON[]>([]);
  const [commentsRefresh, setCommentsRefresh] = useState(0);
  const reviewActive = reviewState === "review";
  // Once every comment is resolved there's no open review work left, so the
  // "review 中" indicator is hidden. Diff/history stay available.
  const hasOpenComments = comments.some((c) => c.status === "open");

  const activePath = activeFile?.path;
  const activeFileRoot = activeFile?.root;
  const keyOf = (root: string | undefined, path: string) => `${root ?? ""}:${path}`;
  const fileKey = activePath ? keyOf(activeFileRoot, activePath) : "";

  // The *currently* active tab's key, read fresh from the store rather than
  // the `activeFile` closure above. Used by the sweep effect to guard
  // against a race (#114 review follow-up): a sweep's statFile for a tab
  // can resolve 404 *after* the user has since activated that very tab (the
  // per-active-file stat effect re-checks and may have already cleared it
  // from missing) — without this guard the sweep's late `add` would
  // immediately undo that re-check.
  const currentActiveKey = () => {
    if (!activeRoot) return null;
    const id = useOpenFiles.getState().activeIdByRoot[activeRoot];
    if (!id) return null;
    const active = useOpenFiles.getState().files.find((f) => f.id === id);
    return active ? keyOf(active.root, active.path) : null;
  };

  // Record/clear a file's review membership for the tab badge.
  const markReviewFile = (key: string, inReview: boolean) => {
    setReviewFiles((prev) => {
      if (inReview === prev.has(key)) return prev;
      const next = new Set(prev);
      if (inReview) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // Tabs whose `statFile` returned 404 (#114) — typically a stale tab left
  // over from a directory rename, still persisted in localStorage but no
  // longer resolvable on the server. Kept in a ref (not state) since it's
  // read/written only inside effects and never drives a render directly;
  // the badge sweep effect below reads it synchronously without waiting for
  // a re-render. Cleared when: the tab is activated (the per-active-file
  // stat effect below re-checks), a `file`/`tree` SSE event names it (the
  // canonical path may have reappeared), or the tab is closed (nothing left
  // to sweep, and reusing the key for a future re-open of the same path
  // should get a fresh check rather than inherit a stale miss).
  const missingStatFilesRef = useRef<Set<string>>(new Set());

  // True when some open tab (any root) already has this root/path — used to
  // decide whether an SSE `comments` event should bump the tab-badge sweep
  // (#114: a review.json change for a file nobody has open shouldn't trigger
  // a statFile round-trip for every other open tab).
  const isPathOpen = (root: string, path: string) =>
    useOpenFiles.getState().files.some((f) => f.root === root && f.path === path);

  // Wrap every close-tab action (close button / "他のタブを閉じる" /
  // "右側のタブを閉じる") so the closed tab(s) drop out of the missing-stat
  // set (#114 review follow-up). Without this, re-opening the same path
  // later would inherit a stale "give up on this one" mark from before the
  // close, permanently hiding its badge even though it's a fresh tab.
  const closeFile = (id: string) => {
    const target = useOpenFiles.getState().files.find((f) => f.id === id);
    closeFileRaw(id);
    if (target) missingStatFilesRef.current.delete(keyOf(target.root, target.path));
  };
  const closeOthers = (id: string) => {
    const target = useOpenFiles.getState().files.find((f) => f.id === id);
    const closed = target
      ? useOpenFiles.getState().files.filter((f) => f.root === target.root && f.id !== id)
      : [];
    closeOthersRaw(id);
    for (const f of closed) missingStatFilesRef.current.delete(keyOf(f.root, f.path));
  };
  const closeToRight = (id: string) => {
    const target = useOpenFiles.getState().files.find((f) => f.id === id);
    const closed = (() => {
      if (!target) return [];
      const sameRoot = useOpenFiles.getState().files.filter((f) => f.root === target.root);
      const index = sameRoot.findIndex((f) => f.id === id);
      return index === -1 ? [] : sameRoot.slice(index + 1);
    })();
    closeToRightRaw(id);
    for (const f of closed) missingStatFilesRef.current.delete(keyOf(f.root, f.path));
  };

  // --- Server-push events (#112) --------------------------------------------
  // Bumped every time an SSE `file` event matches the active file, so
  // useFileWatcher can run its external-edit reconcile immediately instead
  // of waiting for its own interval (which is disabled once SSE is
  // connected — see the `paused` arg passed to useFileWatcher below).
  const [fileEventTrigger, setFileEventTrigger] = useState(0);
  const setSseConnected = useServerConnection((s) => s.setConnected);
  const { connected: sseConnected } = useServerEvents({
    onTree: (ev) => {
      void queryClient.invalidateQueries({ queryKey: ["dir"] });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      // The path this event names may be a tab we'd previously given up on
      // (#114) — clear it from the missing set so the badge sweep resumes
      // checking it. Set.delete only returns true when the key was actually
      // present, so this only fires a sweep for tabs that were genuinely
      // stuck missing — a `tree` event for any other file (the overwhelming
      // common case) stays a no-op here, same as before #114.
      const wasMissing = missingStatFilesRef.current.delete(keyOf(ev.root, ev.path));
      if (wasMissing) setReviewRefresh((n) => n + 1);
    },
    onFile: (ev) => {
      // A stat-404'd tab (#114) becoming valid again is signaled by its own
      // `file` event even when it isn't the active tab, so clear it here
      // regardless of the active-file guard below (which only gates the
      // fileEventTrigger bump used for the external-edit reconcile). As with
      // onTree, only re-trigger the sweep when this path was actually the
      // one we'd given up on — not on every `file` event.
      const wasMissing = missingStatFilesRef.current.delete(keyOf(ev.root, ev.path));
      if (wasMissing) setReviewRefresh((n) => n + 1);
      if (ev.root !== activeFileRoot || ev.path !== activePath) return;
      setFileEventTrigger((n) => n + 1);
    },
    onComments: (ev) => {
      if (ev.root === activeFileRoot && ev.path === activePath) {
        setCommentsRefresh((n) => n + 1);
      }
      // Only bump the tab-badge sweep when the changed file is actually one
      // of the open tabs (#114) — otherwise a review.json change for a file
      // nobody has open triggers a needless statFile sweep across every tab.
      //
      // Deliberately does NOT clear missingStatFilesRef the way onFile/onTree
      // do: a `comments` event only proves the sidecar (review.json) was
      // written, not that the canonical file path itself exists again. A tab
      // stat-404'd because its file was renamed away could still get a
      // `comments` event (e.g. the old sidecar being cleaned up) without the
      // canonical path having come back — clearing missing here would just
      // reopen the request storm this fix removes. Only `file`/`tree`
      // events (which are emitted for the canonical path) or reactivating
      // the tab lift the exclusion.
      if (isPathOpen(ev.root, ev.path)) setReviewRefresh((n) => n + 1);
    },
  });
  useEffect(() => {
    setSseConnected(sseConnected);
  }, [sseConnected, setSseConnected]);

  // Sticky "has the SSE channel ever connected" flag (#119 case 4). Once
  // true it stays true, so a later drop shows the disconnected badge below —
  // but the badge never flashes before the first successful connection
  // (e.g. jsdom / tests where EventSource is undefined, or the brief instant
  // between mount and the first onopen). Set during render (React's
  // recommended pattern over an effect for derived state — same approach as
  // the fileKey reset below), not inside a useEffect body.
  const [everConnected, setEverConnected] = useState(false);
  if (sseConnected && !everConnected) {
    setEverConnected(true);
  }

  // Reset all review/diff view-state the instant the active file changes —
  // done during render (React's recommended pattern over an effect) so the
  // next file never opens stuck in a stale diff. prevFileKey is the guard that
  // makes this run once per change instead of every render.
  const [prevFileKey, setPrevFileKey] = useState(fileKey);
  if (fileKey !== prevFileKey) {
    setPrevFileKey(fileKey);
    setDiffMode(false);
    setSelectedRevId(null);
    setDiffBaseText("");
    setReviewState(undefined);
    setRevisions([]);
    setRevContents({});
    setComments([]);
  }

  // Fetch review state + revision list for the active file. Degrades to
  // "draft" with no history on any error so the editor stays usable offline /
  // against an older server. setState only happens after an await, so it does
  // not trigger the synchronous-setState-in-effect lint.
  useEffect(() => {
    if (!activePath) return;
    // Activating a tab is one of the two conditions (#114) that lets a
    // previously stat-404'd tab back into the badge sweep — clear it
    // up-front so this fetch is the fresh recheck, not a skip.
    const activeKey = keyOf(activeFileRoot, activePath);
    missingStatFilesRef.current.delete(activeKey);
    let cancelled = false;
    void (async () => {
      try {
        const stat = await statFile(activePath, activeFileRoot);
        if (cancelled) return;
        const state = stat.state ?? "draft";
        setReviewState(state);
        markReviewFile(activeKey, stat.hasOpenComments ?? false);
        if (state === "review") {
          const rl = await listRevisions(activePath, activeFileRoot);
          if (!cancelled) setRevisions(rl.revisions);
        } else {
          setRevisions([]);
        }
      } catch (err) {
        if (err instanceof HTTPError && err.response.status === 404) {
          missingStatFilesRef.current.add(activeKey);
        }
        if (!cancelled) {
          setReviewState("draft");
          setRevisions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, activeFileRoot, reviewRefresh]);

  // Fetch sidecar comments for the active file once it is under review. Draft
  // files have no review.json, so we skip the call and keep the list empty.
  useEffect(() => {
    // Draft files have no review.json. The render-time reset (fileKey change)
    // already empties the list, so we only need to fetch when under review;
    // setState only happens after an await, avoiding the sync-setState lint.
    if (!activePath || reviewState !== "review") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listComments(activePath, activeFileRoot);
        if (!cancelled) setComments(res.comments);
      } catch {
        if (!cancelled) setComments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, activeFileRoot, reviewState, commentsRefresh]);

  // Poll for comment changes the UI didn't make itself: comments can be added
  // or answered out-of-band (mr CLI / HTTP API / another viewer), and unlike
  // the file tree / external-content watcher the comment list otherwise only
  // refetches on file-switch or a local mutation. Bump commentsRefresh on an
  // interval (active review file only, paused when the tab is hidden) to reuse
  // the fetch effect above.
  //
  // This is the fallback path only (issue #112): once the SSE channel is
  // connected, a `comments` event for the active file bumps commentsRefresh
  // directly (see the useServerEvents callbacks below) and this interval is
  // disabled so out-of-band changes aren't discovered twice.
  useEffect(() => {
    if (!activePath || reviewState !== "review") return;
    if (sseConnected) return;
    const handle = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setCommentsRefresh((n) => n + 1);
      }
    }, COMMENTS_POLL_MS);
    return () => window.clearInterval(handle);
  }, [activePath, activeFileRoot, reviewState, sseConnected]);

  // Poll review state for all open tabs at a fixed interval so external
  // ingest (mr CLI / API) is reflected without a manual file-switch.
  // Uses the same cadence as comment polling to avoid extra requests.
  // Disabled once SSE is connected — a `comments` event bumps reviewRefresh
  // directly instead (see the useServerEvents callbacks below).
  useEffect(() => {
    if (sseConnected) return;
    const handle = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setReviewRefresh((n) => n + 1);
      }
    }, COMMENTS_POLL_MS);
    return () => window.clearInterval(handle);
  }, [sseConnected]);

  // Sync review badge for all open tabs whenever reviewRefresh bumps. Capture
  // a snapshot of the file list at effect-run time to avoid stale-closure
  // issues; the effect re-runs on reviewRefresh changes and when the number
  // of open files changes.
  //
  // Tabs previously stat-404'd (#114 — typically a stale path left over from
  // a directory rename) are skipped entirely: retrying them every sweep is
  // exactly the request storm this fix exists to stop. They rejoin the sweep
  // once activated (the per-active-file stat effect above clears them via
  // markReviewFile / the try below) or once a `file`/`tree` SSE event names
  // them again (cleared in the useServerEvents callbacks).
  useEffect(() => {
    if (allFiles.length === 0) return;
    const snapshot = allFiles.filter(
      (f) => !missingStatFilesRef.current.has(keyOf(f.root, f.path))
    );
    if (snapshot.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all(
          snapshot.map(async (f) => {
            const key = keyOf(f.root, f.path);
            try {
              const stat = await statFile(f.path, f.root);
              if (!cancelled) {
                markReviewFile(key, stat.hasOpenComments ?? false);
              }
            } catch (err) {
              // A 404 means this tab's path no longer exists server-side —
              // remember it so future sweeps skip it (#114). Any other
              // error (network blip, 5xx) is transient, so it's ignored
              // without marking the tab missing.
              //
              // Guard against the activation race: if the user activated
              // this exact tab while this request was in flight, the
              // per-active-file stat effect owns its missing/present state
              // from here on — recording a late 404 here would immediately
              // re-exclude a tab that effect just decided to (re)check.
              if (
                err instanceof HTTPError &&
                err.response.status === 404 &&
                key !== currentActiveKey()
              ) {
                missingStatFilesRef.current.add(key);
                if (!cancelled) markReviewFile(key, false);
              }
            }
          })
        );
      } catch {
        // ignore top-level errors
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFiles.length, reviewRefresh]);

  // Push the current comments into the editor as inline highlight decorations.
  // Re-runs whenever the list changes or a new file is loaded; passing [] when
  // there are none clears stale highlights.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const highlights: HighlightComment[] = comments.map((c) => ({
      id: c.id,
      status: c.status,
      anchor: c.anchor,
      anchors: c.anchors,
    }));
    editor.commands.setCommentHighlights(highlights);
  }, [editor, comments]);

  const loadRevision = async (id: string) => {
    if (!activePath) return;
    try {
      const rev = await getRevision(activePath, id, activeFileRoot);
      setSelectedRevId(id);
      setDiffBaseText(rev.content);
    } catch (err) {
      showToast(
        `リビジョンの取得に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  // Ingest is internal bookkeeping, not a user action: a file only gets a
  // sidecar / revision history once it's actually reviewed (tracking every
  // opened file would be wasteful). It runs transparently the first time the
  // user comments, so success is never surfaced. Failures still surface, since
  // they block the comment the user asked for.
  const handleIngest = async (): Promise<boolean> => {
    if (!activeFile) return false;
    try {
      const res = await ingestFile(activeFile.path, activeFile.root);
      setReviewState(res.state);
      // Ingest itself creates no comments; the green mark only lights up once
      // an open comment exists. The full-tab sync that follows (reviewRefresh
      // bump) will re-evaluate hasOpenComments from the server.
      markReviewFile(keyOf(activeFile.root, activeFile.path), false);
      setReviewRefresh((n) => n + 1);
      return true;
    } catch (err) {
      showToast(
        `取り込みに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
      return false;
    }
  };

  const handleToggleDiff = async () => {
    if (diffMode) {
      setDiffMode(false);
      return;
    }
    if (revisions.length === 0) {
      showToast("比較できる過去リビジョンがまだありません", "info");
      return;
    }
    // Fetch all revision contents not yet cached, so we can filter to those
    // that actually differ from the current editor content.
    let contents = revContents;
    if (activePath) {
      const missing = revisions.filter((r) => !(r.id in revContents));
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(async (r) => {
            try {
              const rev = await getRevision(activePath, r.id, activeFileRoot);
              return [r.id, rev.content] as const;
            } catch {
              return null;
            }
          })
        );
        const next = { ...revContents };
        for (const e of fetched) if (e) next[e[0]] = e[1];
        setRevContents(next);
        contents = next;
      }
    }
    const latestText = activeFile ? stripHint(activeFile.savedMarkdown) : "";
    const meaningful = revisions.filter((r) => {
      const c = contents[r.id];
      return c !== undefined && hasChanges(lineDiff(c, latestText));
    });
    if (meaningful.length === 0) {
      showToast("差分のある過去バージョンはありません", "info");
      return;
    }
    // Always (re)open against the most recent meaningful revision so the picker
    // starts on "最新差分あり", regardless of any earlier selection.
    await loadRevision(meaningful[0].id);
    setDiffMode(true);
  };

  // The "latest 正典" side of the diff is the last-saved content (not the
  // live editor buffer), so tiptap-markdown's roundtrip normalization —
  // which mutates `activeFile.markdown` on any onUpdate — doesn't leak into
  // the diff as spurious "+/-" lines. AI hint stripped to line up with the
  // hint-stripped snapshots. #117
  const diffLatestText = useMemo(
    () => (activeFile ? stripHint(activeFile.savedMarkdown) : ""),
    [activeFile]
  );

  // Revisions that actually differ from the last-saved content. Same rationale
  // as diffLatestText: compare against savedMarkdown, not the live buffer.
  const currentEditorText = activeFile ? stripHint(activeFile.savedMarkdown) : "";
  const meaningfulRevisions = revisions.filter((r) => {
    const c = revContents[r.id];
    return c !== undefined && hasChanges(lineDiff(c, currentEditorText));
  });

  // Migrate any persisted legacy single-root files onto the default root
  // the first time we learn which root that is. Idempotent — subsequent
  // renders with the same root are no-ops.
  useEffect(() => {
    if (roots.length > 0) reattachLegacyFilesToRoot(roots[0].name);
  }, [roots]);

  // Fallback poll is disabled while SSE is connected; the onFile callback
  // above bumps fileEventTrigger to drive the same reconcile logic instead.
  useFileWatcher(undefined, { paused: sseConnected, trigger: fileEventTrigger });

  const handleRefreshTree = () => {
    // The sidebar has two data sources — the lazy tree ("dir") and the flat
    // recent list ("files") — refresh both so the button works in either
    // view mode (#68). Also bump reviewRefresh so tab badges reflect any
    // out-of-band review-state changes that happened since the last poll.
    void queryClient.invalidateQueries({ queryKey: ["dir"] });
    void queryClient.invalidateQueries({ queryKey: ["files"] });
    setReviewRefresh((n) => n + 1);
  };

  useDirChangeWatcher({
    onOpenFile: (path) => {
      void handleSelect(path);
    },
    onSelectDir: (path) => {
      // Highlight + expand the directory in the tree and make sure the
      // sidebar is visible so the user can actually see the result.
      setSidebarOpen(true);
      setSelectedDirPath(path);
    },
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const initialSelectFileRef = useRef(searchParams.get(SELECT_FILE_PARAM));

  // Keep the URL's `select_file` param in sync with the active tab so the
  // current view is bookmarkable / shareable. Runs on every active-file
  // change (tab click, sidebar open, close-last-tab → undefined).
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const current = prev.get(SELECT_FILE_PARAM);
        const next = new URLSearchParams(prev);
        if (activeFile?.path) {
          if (current === activeFile.path) return prev;
          next.set(SELECT_FILE_PARAM, activeFile.path);
        } else {
          if (current === null) return prev;
          next.delete(SELECT_FILE_PARAM);
        }
        return next;
      },
      { replace: true }
    );
  }, [activeFile?.path, setSearchParams]);

  const [commentDialog, setCommentDialog] = useState<{
    open: boolean;
    mode: "anchored" | "global";
    snippet: string;
    /**
     * The editor selection captured when the dialog opened (anchored mode).
     * Held so the anchor is computed against the exact range the user picked,
     * even if focus shifts to the dialog.
     */
    range?: { from: number; to: number };
  }>({ open: false, mode: "anchored", snippet: "" });
  // Editor context menu. Without commentId → "コメント追加" for the current
  // selection; with commentId → "このコメントを削除" for the highlight that was
  // right-clicked.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    commentId?: string;
  } | null>(null);

  // Re-render the toolbar Add-Comment button when selection / doc changes.
  const [, setSelectionTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => setSelectionTick((n) => n + 1);
    editor.on("selectionUpdate", tick);
    editor.on("transaction", tick);
    return () => {
      editor.off("selectionUpdate", tick);
      editor.off("transaction", tick);
    };
  }, [editor]);

  // Right-click on a non-empty selection → コメント追加 menu (contextMenu state).
  // The editor `view` may not be mounted at the moment the editor object lands
  // in the store, so we attach lazily and retry on the "create" event.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let detach: (() => void) | undefined;

    const tryAttach = () => {
      if (detach) return;
      let dom: HTMLElement;
      try {
        dom = editor.view.dom as HTMLElement;
      } catch {
        return; // view not ready yet
      }
      const handler = (e: Event) => {
        const ev = e as MouseEvent;
        // Right-click on a comment highlight → offer to delete that comment,
        // taking priority over the selection-based "コメント追加" path.
        const target = ev.target as HTMLElement | null;
        const markEl = target?.closest?.("[data-comment-id]") as HTMLElement | null;
        const commentId = markEl?.getAttribute("data-comment-id") ?? undefined;
        if (commentId) {
          ev.preventDefault();
          setContextMenu({ x: ev.clientX, y: ev.clientY, commentId });
          return;
        }
        const sel = editor.state.selection;
        if (sel.empty || sel.from === sel.to) return;
        ev.preventDefault();
        setContextMenu({ x: ev.clientX, y: ev.clientY });
      };
      dom.addEventListener("contextmenu", handler);
      detach = () => dom.removeEventListener("contextmenu", handler);
    };

    tryAttach();
    editor.on("create", tryAttach);

    return () => {
      editor.off("create", tryAttach);
      if (detach) detach();
    };
  }, [editor]);

  const handleSelect = async (path: string) => {
    if (!activeRoot) return;
    const state = useOpenFiles.getState();
    const currentActiveId = state.activeIdByRoot[activeRoot];
    const active = state.files.find((f) => f.id === currentActiveId);
    const target = state.files.find((f) => f.path === path && f.root === activeRoot);

    if (target && target.id === currentActiveId) return;

    if (active && active.isDirty && active.path !== path) {
      const ok = await confirm({
        title: "未保存の変更があります",
        message: `「${active.name}」の変更は破棄されます。別のファイルを開きますか？`,
        confirmLabel: "破棄して開く",
      });
      if (!ok) return;
      // Roll the active file back to its saved baseline so its in-memory
      // edits aren't persisted to localStorage and don't reappear when the
      // user navigates back to it.
      discardActiveChanges(activeRoot);
    }

    if (target) {
      setActive(activeRoot, target.id);
      // Re-activating an already-open tab (#119 case 6) can be stale if it
      // changed on disk while some other tab was active — the file watcher
      // was only checking whichever tab was active at the time. Bump the
      // same trigger the SSE onFile handler uses so it revalidates this tab
      // right now instead of waiting for the next interval/push event.
      setFileEventTrigger((n) => n + 1);
      return;
    }

    try {
      const res = await readFile.mutateAsync({ path, root: activeRoot });
      openServerFile({
        name: basename(res.path),
        path: res.path,
        root: activeRoot,
        markdown: res.content,
        modified: res.modified,
        created: res.created,
        sha: res.sha,
      });
    } catch (err) {
      showToast(
        `ファイルの読み込みに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  // Tab-bar clicks switch tabs directly via MUI Tabs' onChange, bypassing
  // handleSelect entirely — so the #119 case 6 revalidation added there
  // (bump fileEventTrigger after reactivating an existing tab) needs its own
  // copy here. Only bump when the active tab actually changes: MUI still
  // fires onChange when the currently-active tab is clicked again, and
  // re-triggering on every such click would just be redundant /api/stat
  // traffic for a tab we already know is current.
  const handleTabChange = (_: React.SyntheticEvent, v: string) => {
    if (!activeRoot) return;
    const changed = v !== (activeFile?.id ?? null);
    setActive(activeRoot, v);
    if (changed) {
      setFileEventTrigger((n) => n + 1);
    }
  };

  // Deeplink: `?select_file=<path>` opens that file on first mount. Held in
  // a ref so subsequent URL changes (e.g. user editing the sidebar filter)
  // don't re-trigger the open, and StrictMode's double-invoke is a no-op
  // the second time. We wait until activeRoot is non-empty so the read is
  // scoped to the correct root from the start.
  useEffect(() => {
    const path = initialSelectFileRef.current;
    if (!path) return;
    if (!activeRoot) return;
    initialSelectFileRef.current = null;
    void handleSelect(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoot]);

  // Save conflict (#119 case 5): the server rejects the write with 412 when
  // `If-Match` no longer matches the on-disk sha — i.e. the file changed on
  // disk since we last read/wrote it — and writes nothing. Offer to
  // overwrite (retry without If-Match, legacy last-write-wins) or cancel
  // (the file watcher's next tick will independently offer to take the
  // external change, since the on-disk sha now differs from ours).
  const handleSave = async () => {
    if (!activeFile) return;
    try {
      const res = await writeFile.mutateAsync({
        path: activeFile.path,
        content: activeFile.markdown,
        root: activeFile.root,
        ifMatch: activeFile.serverSha,
      });
      markActiveSaved(activeFile.root, res.modified, res.created, res.sha);
      // A save snapshots the previous content into history (review state only),
      // so refresh the revision list backing the diff picker.
      setReviewRefresh((n) => n + 1);
      showToast(`「${activeFile.name}」を保存しました`, "success");
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 412) {
        const overwrite = await confirm({
          title: "保存の競合",
          message: `「${activeFile.name}」は他の場所で更新されているため、まだ保存していません。\n外部の変更を上書きして保存しますか？`,
          confirmLabel: "上書き保存",
          cancelLabel: "キャンセル",
        });
        if (!overwrite) return;
        try {
          const res = await writeFile.mutateAsync({
            path: activeFile.path,
            content: activeFile.markdown,
            root: activeFile.root,
          });
          markActiveSaved(activeFile.root, res.modified, res.created, res.sha);
          setReviewRefresh((n) => n + 1);
          showToast(`「${activeFile.name}」を保存しました`, "success");
        } catch (retryErr) {
          showToast(
            `保存に失敗しました: ${(retryErr as Error).message ?? "unknown error"}`,
            "error"
          );
        }
        return;
      }
      showToast(
        `保存に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  // Copy the displayed document as raw Markdown. The AI hint is stripped so
  // the clipboard holds the clean canonical text the user sees, ready to paste
  // elsewhere (e.g. into a chat) without the internal hint comment.
  const handleCopyMarkdown = async () => {
    if (!activeFile) return;
    const raw = stripHint(activeFile.markdown);
    try {
      await navigator.clipboard.writeText(raw);
      showToast("素の Markdown をコピーしました", "success");
    } catch (err) {
      showToast(
        `コピーに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  // Build `mr comments <abs-path>` for the active file and copy it, so the user
  // can paste one command to have the AI check this file's review comments —
  // no need to retype the file name + "コメント確認して" each time. An absolute
  // path (root abs path + root-relative file path) is used so it resolves
  // regardless of the AI's working directory.
  const handleCopyReviewCommand = async () => {
    if (!activeFile) return;
    const rootPath = roots.find((r) => r.name === activeFile.root)?.path ?? "";
    const base = rootPath.replace(/\/+$/, "");
    const abs = base ? `${base}/${activeFile.path}` : activeFile.path;
    const cmd = `mr comments ${abs}`;
    try {
      await navigator.clipboard.writeText(cmd);
      showToast("コメント確認コマンドをコピーしました", "success");
    } catch (err) {
      showToast(
        `コピーに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  const canAddComment = (() => {
    if (!editor) return false;
    const { from, to, empty } = editor.state.selection;
    return !(empty || from === to);
  })();

  const refreshComments = () => setCommentsRefresh((n) => n + 1);

  const commentErr = (action: string, err: unknown) =>
    showToast(
      `${action}に失敗しました: ${(err as Error)?.message ?? "unknown error"}`,
      "error"
    );

  const openAnchoredCommentDialog = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      showToast("コメントを付ける範囲をエディタで選択してください", "info");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    setCommentDialog({
      open: true,
      mode: "anchored",
      snippet: buildTargetSnippet(selectedText),
      range: { from, to },
    });
  };

  const openGlobalCommentDialog = () =>
    setCommentDialog({ open: true, mode: "global", snippet: "" });

  // A comment implies the file is under review, so adding one silently ingests
  // when needed instead of making the user notice a separate "取り込む" step.
  // The user just sees the comment dialog open normally. Ingest is idempotent.
  const ingestThenOpen = async (open: () => void) => {
    if (await handleIngest()) open();
  };

  const handleAddCommentClick = () => {
    if (!editor) return;
    if (!reviewActive) {
      void ingestThenOpen(openAnchoredCommentDialog);
      return;
    }
    openAnchoredCommentDialog();
  };

  const handleAddGlobalClick = () => {
    if (!editor) return;
    if (!reviewActive) {
      void ingestThenOpen(openGlobalCommentDialog);
      return;
    }
    openGlobalCommentDialog();
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextAddComment = () => {
    closeContextMenu();
    handleAddCommentClick();
  };

  // AI-authored comments are read-only to the human reviewer (they can't be
  // deleted from the right-click menu either); see CommentSidePane's
  // isAiAuthored for the same "ai" author marker.
  const contextMenuCommentIsAiAuthored =
    comments.find((c) => c.id === contextMenu?.commentId)?.author === "ai";

  const handleContextDeleteComment = () => {
    const id = contextMenu?.commentId;
    closeContextMenu();
    if (id && !contextMenuCommentIsAiAuthored) void handleDeleteComment(id);
  };

  const closeCommentDialog = () =>
    setCommentDialog({ open: false, mode: "anchored", snippet: "" });

  // Submit a new comment to the sidecar. The anchor(s) are derived from the
  // live ProseMirror doc so they resolve identically server-side against the
  // clean canonical body.
  const handleCommentSubmit = async ({
    body,
    scope,
  }: {
    body: string;
    scope: "inline" | "block" | "global";
  }) => {
    if (!editor || !activeFile) {
      closeCommentDialog();
      return;
    }
    const date = todayISO();
    const path = activeFile.path;
    const root = activeFile.root;

    try {
      if (scope === "global") {
        await createComment(path, { scope: "global", body, author, date }, root);
      } else {
        // anchored inline
        const range = commentDialog.range;
        const anchor = range
          ? computeAnchorFromSelection(editor.state.doc, range.from, range.to)
          : null;
        if (!anchor) {
          showToast("選択範囲のアンカーを特定できませんでした", "warning");
          closeCommentDialog();
          return;
        }
        await createComment(path, { scope: "inline", body, author, date, anchor }, root);
      }
      refreshComments();
    } catch (err) {
      commentErr("コメントの追加", err);
    } finally {
      closeCommentDialog();
    }
  };

  const handleDeleteComment = async (id: string) => {
    if (!activeFile) return;
    try {
      await deleteComment(activeFile.path, id, activeFile.root);
      refreshComments();
    } catch (err) {
      commentErr("コメントの削除", err);
    }
  };

  const handleResolveToggle = async (id: string, next: "open" | "resolved") => {
    if (!activeFile) return;
    try {
      await setCommentStatus(activeFile.path, id, next, activeFile.root);
      refreshComments();
    } catch (err) {
      commentErr("状態の更新", err);
    }
  };

  const handleEditComment = async (id: string, nextBody: string) => {
    if (!activeFile) return;
    try {
      await editCommentBody(activeFile.path, id, nextBody, activeFile.root);
      refreshComments();
    } catch (err) {
      commentErr("コメントの編集", err);
    }
  };

  const handleReplyComment = async (id: string, replyBody: string) => {
    if (!activeFile) return;
    try {
      await replyToComment(
        activeFile.path,
        id,
        { author, date: todayISO(), body: replyBody },
        activeFile.root
      );
      refreshComments();
    } catch (err) {
      commentErr("返信の追加", err);
    }
  };

  const handleEditReply = async (id: string, index: number, nextBody: string) => {
    if (!activeFile) return;
    try {
      await editReply(activeFile.path, id, index, nextBody, activeFile.root);
      refreshComments();
    } catch (err) {
      commentErr("返信の編集", err);
    }
  };

  const handleDeleteReply = async (id: string, index: number) => {
    if (!activeFile) return;
    try {
      await deleteReply(activeFile.path, id, index, activeFile.root);
      refreshComments();
    } catch (err) {
      commentErr("返信の削除", err);
    }
  };

  // Scroll to + flash a comment's inline highlight in the editor.
  const handleJumpToComment = (id: string) => {
    const root = editor?.view?.dom;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>(
      `[data-comment-id="${CSS.escape(id)}"]`
    );
    if (nodes.length === 0) return;
    nodes[0].scrollIntoView({ behavior: "smooth", block: "center" });
    nodes.forEach((el) => {
      el.classList.remove("is-flash");
      void el.offsetWidth; // force reflow so the animation restarts
      el.classList.add("is-flash");
    });
    window.setTimeout(() => {
      nodes.forEach((el) => el.classList.remove("is-flash"));
    }, 1600);
  };

  const canSave = Boolean(activeFile);
  const isSaving = writeFile.isPending;

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {!isSidebarOpen && (
        <Box
          component="aside"
          sx={{
            width: 40,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            pl: 0.5,
            pt: 0.75,
          }}
        >
          <Tooltip title="サイドバーを開く" placement="right">
            <IconButton
              size="small"
              onClick={toggleSidebar}
              aria-label="open sidebar"
              data-testid="sidebar-rail-open"
            >
              <MenuIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      {isSidebarOpen && (
        <Box
          ref={asideRef}
          component="aside"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          <Box
            sx={{
              pl: 0.5,
              pr: 1.5,
              // Fixed (not min) height, shared by all three pane headers, so
              // the header divider stays one continuous line regardless of
              // which pane holds the tallest control (#65, #90). BAR_HEIGHT = 37px.
              height: BAR_HEIGHT,
              flexShrink: 0,
              boxSizing: "border-box",
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Tooltip title="サイドバーを閉じる">
              <IconButton size="small" onClick={toggleSidebar} aria-label="close sidebar">
                <MenuOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={reviewRootName} placement="bottom-start">
              <Typography
                variant="subtitle2"
                sx={{
                  flexGrow: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
                data-testid="sidebar-review-root"
              >
                {reviewRootName}
              </Typography>
            </Tooltip>
            <Tooltip title="ファイル一覧を再読み込み">
              <IconButton
                size="small"
                onClick={handleRefreshTree}
                aria-label="refresh file tree"
                data-testid="sidebar-refresh"
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <RootTabs />
          <Sidebar activePath={activeFile?.path} onSelect={handleSelect} />
          <Box
            onMouseDown={handleResizeMouseDown}
            data-testid="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            sx={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: "5px",
              cursor: "col-resize",
              zIndex: 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          />
        </Box>
      )}

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            // Fixed height shared with the sidebar / comment pane headers so
            // the three dividers form one continuous line (#65, #90). BAR_HEIGHT = 37px.
            height: BAR_HEIGHT,
            flexShrink: 0,
            boxSizing: "border-box",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box
            component="img"
            src="/logo.png"
            alt="markdown-reviewer"
            sx={{
              width: 24,
              height: 24,
              borderRadius: 0.5,
              flexShrink: 0,
            }}
            data-testid="editor-header-logo"
          />
          <Box
            sx={{
              flexGrow: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              overflow: "hidden",
            }}
          >
            <Typography
              variant="body2"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                flexShrink: 1,
              }}
              data-testid="editor-active-path"
            >
              {activeFile ? activeFile.path : "ファイルが選択されていません"}
              {activeFile?.isDirty && " •"}
            </Typography>
            {activeFile && (activeFile.serverCreated || activeFile.serverModified) && (
              <Tooltip
                title={
                  <span data-testid="editor-active-timestamps-tooltip">
                    {activeFile.serverCreated && (
                      <>作成: {formatLocalTimestamp(activeFile.serverCreated)}</>
                    )}
                    {activeFile.serverCreated && activeFile.serverModified && (
                      <br />
                    )}
                    {activeFile.serverModified && (
                      <>更新: {formatLocalTimestamp(activeFile.serverModified)}</>
                    )}
                  </span>
                }
              >
                <IconButton
                  size="small"
                  sx={{ flexShrink: 0, color: "text.secondary" }}
                  data-testid="editor-active-timestamps"
                >
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {activeFile && reviewState === "review" && hasOpenComments && (
              <Typography
                variant="caption"
                sx={{ color: "success.main", flexShrink: 0, whiteSpace: "nowrap" }}
                data-testid="editor-review-indicator"
              >
                レビュー中
              </Typography>
            )}
          </Box>
          {/* No explicit "取り込む" action: a file is ingested transparently the
              first time the user comments on it (see handleIngest / ingestThenOpen).
              Ingesting is internal bookkeeping the user shouldn't have to think about. */}
          {activeFile && reviewState === "review" && (
            <Tooltip title={diffMode ? "差分表示を閉じる" : "前回保存との差分を表示"}>
              <span>
                <IconButton
                  size="small"
                  disabled={revisions.length === 0}
                  onClick={handleToggleDiff}
                  data-testid="editor-diff-toggle"
                  {...(diffMode ? { color: "primary" as const } : {})}
                >
                  <CompareArrowsIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title={centered ? "全幅表示に切替" : "中央寄せに切替"}>
            <IconButton
              size="small"
              onClick={toggleCentered}
              aria-label="toggle width"
              data-testid="editor-toggle-width"
            >
              {centered ? (
                <UnfoldMoreIcon fontSize="small" sx={{ transform: "rotate(90deg)" }} />
              ) : (
                <FormatAlignCenterIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title="AI にコメント確認させる mr コマンドをコピー（mr comments <path>）">
            <span>
              <IconButton
                size="small"
                onClick={handleCopyReviewCommand}
                disabled={!activeFile}
                aria-label="copy review command"
                data-testid="editor-copy-review-command"
              >
                <RateReviewOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="表示中の素の Markdown をクリップボードにコピー">
            <span>
              <IconButton
                size="small"
                onClick={handleCopyMarkdown}
                disabled={!activeFile}
                aria-label="copy raw markdown"
                data-testid="editor-copy-markdown"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={isSaving ? "保存中..." : "保存"}>
            <span>
              <IconButton
                size="small"
                onClick={handleSave}
                disabled={!canSave || isSaving}
                aria-label="save"
                data-testid="editor-save"
              >
                <SaveIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {/* #119 case 4: shown only after the SSE channel has connected at
              least once and then dropped, so a poll-based fallback is
              actually in play — never flashes on initial mount / in
              environments without EventSource, and disappears on its own
              once the channel reconnects. Deliberately a standalone chip
              rather than repurposing an existing header slot (1枠1意味). */}
          {everConnected && !sseConnected && (
            <Tooltip title="サーバとのリアルタイム同期が切断されています。ポーリングで追随中です。">
              <Chip
                size="small"
                color="warning"
                label="未同期"
                data-testid="sse-disconnected-badge"
              />
            </Tooltip>
          )}
        </Box>

        {/*
         * Tab bar is always rendered even with a single open file, so the user
         * always has a visible target for close / switch and the layout stays
         * stable when a second file is opened.
         */}
        <Tabs
          value={activeFile?.id ?? false}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons={false}
          TabIndicatorProps={{ sx: { display: "none" } }}
          sx={{
            minHeight: TAB_CONTENT_HEIGHT,
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            "& .MuiTab-root": {
              minHeight: TAB_CONTENT_HEIGHT,
              textTransform: "none",
              py: 0.5,
              px: 1,
              minWidth: 0,
              width: 180,
              maxWidth: 180,
              flex: "0 0 180px",
              borderTopLeftRadius: 6,
              borderTopRightRadius: 6,
              borderRight: "1px solid",
              borderColor: "divider",
              bgcolor: "action.hover",
              "&:hover": {
                bgcolor: "action.selected",
              },
              "&.Mui-selected": {
                bgcolor: "background.paper",
                borderBottom: "2px solid",
                borderBottomColor: "background.paper",
                mb: "-1px",
              },
            },
          }}
          data-testid="editor-tabs"
        >
          {files.map((f, index) => {
            const isReview = reviewFiles.has(keyOf(f.root, f.path));
            // A tab is a "sibling" when it shares the active file's directory
            // but isn't the active file itself — highlight its frame so files
            // living next to what you're looking at stand out.
            const isSibling =
              activeDir !== null &&
              f.id !== activeFile?.id &&
              dirOf(f.path) === activeDir;
            const isDragging = dragTabId === f.id;
            return (
              <Tab
                key={f.id}
                value={f.id}
                data-testid={`editor-tab-${f.path}`}
                draggable
                onDragStart={(e) => {
                  setDragTabId(f.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragTabId && dragTabId !== f.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!activeRoot || !dragTabId || dragTabId === f.id) return;
                  const fromIndex = files.findIndex((x) => x.id === dragTabId);
                  if (fromIndex !== -1) reorderFiles(activeRoot, fromIndex, index);
                  setDragTabId(null);
                }}
                onDragEnd={() => setDragTabId(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({ x: e.clientX, y: e.clientY, id: f.id });
                }}
                sx={{
                  position: "relative",
                  overflow: "hidden",
                  cursor: isDragging ? "grabbing" : "pointer",
                  opacity: isDragging ? 0.5 : 1,
                  ...(isSibling && {
                    // Inset frame so the colored border doesn't shift layout
                    // or fight the existing 1px right/bottom borders.
                    boxShadow: (theme) =>
                      `inset 0 0 0 2px ${theme.palette.info.main}`,
                  }),
                  ...(isReview && {
                    "&::before": {
                      content: '""',
                      position: "absolute",
                      top: 0,
                      left: 0,
                      borderStyle: "solid",
                      borderWidth: "10px 10px 0 0",
                      borderColor: (theme) =>
                        `${theme.palette.success.main} transparent transparent transparent`,
                    },
                  }),
                }}
                label={
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textAlign: "left",
                      }}
                    >
                      {f.name}
                      {f.isDirty ? " •" : ""}
                    </Box>
                    <CloseIcon
                      fontSize="inherit"
                      role="button"
                      aria-label={`close ${f.name}`}
                      data-testid={`editor-tab-close-${f.path}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeFile(f.id);
                      }}
                      sx={{
                        flexShrink: 0,
                        ml: 0.5,
                        opacity: 0.55,
                        "&:hover": { opacity: 1 },
                      }}
                    />
                  </Box>
                }
              />
            );
          })}
        </Tabs>

        <Menu
          open={tabMenu !== null}
          onClose={() => setTabMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={tabMenu ? { top: tabMenu.y, left: tabMenu.x } : undefined}
        >
          <MenuItem
            disabled={
              !tabMenu || files.findIndex((f) => f.id === tabMenu.id) >= files.length - 1
            }
            onClick={() => {
              if (tabMenu) closeToRight(tabMenu.id);
              setTabMenu(null);
            }}
          >
            右側のタブを閉じる
          </MenuItem>
          <MenuItem
            disabled={!tabMenu || files.length <= 1}
            onClick={() => {
              if (tabMenu) closeOthers(tabMenu.id);
              setTabMenu(null);
            }}
          >
            他のタブを閉じる
          </MenuItem>
        </Menu>

        <Box sx={{ flex: 1, minHeight: 0 }}>
          {activeFile && diffMode ? (
            <DiffView
              oldText={diffBaseText}
              newText={diffLatestText}
              revisions={meaningfulRevisions}
              selectedRevId={selectedRevId}
              onSelectRevision={(id) => void loadRevision(id)}
            />
          ) : activeFile ? (
            <TiptapEditor />
          ) : (
            <Box
              sx={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              data-testid="editor-empty-state"
            >
              <Typography variant="body1" color="text.secondary">
                ファイルを選択
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {isCommentPaneOpen ? (
        <Box
          component="aside"
          sx={{
            width: 320,
            flexShrink: 0,
            borderLeft: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CommentSidePane
            comments={comments}
            reviewActive={reviewActive}
            onClose={toggleCommentPane}
            onRefresh={refreshComments}
            canAddComment={canAddComment}
            onAddComment={handleAddCommentClick}
            onAddGlobal={handleAddGlobalClick}
            onDelete={handleDeleteComment}
            onResolveToggle={handleResolveToggle}
            onReply={handleReplyComment}
            onEdit={handleEditComment}
            onEditReply={handleEditReply}
            onDeleteReply={handleDeleteReply}
            onJump={handleJumpToComment}
          />
        </Box>
      ) : (
        <Box
          component="aside"
          sx={{
            width: 40,
            flexShrink: 0,
            borderLeft: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "flex-end",
            pr: 0.5,
            pt: 0.75,
          }}
        >
          <Tooltip title="コメントペインを開く" placement="left">
            <IconButton
              size="small"
              onClick={toggleCommentPane}
              aria-label="open comment pane"
              data-testid="editor-toggle-comments"
            >
              <CommentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Menu
        open={!!contextMenu}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined
        }
        slotProps={{
          root: { "data-testid": "editor-context-menu" } as Record<string, unknown>,
        }}
      >
        {contextMenu?.commentId ? (
          <MenuItem
            onClick={handleContextDeleteComment}
            disabled={contextMenuCommentIsAiAuthored}
            data-testid="ctx-delete-comment"
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {contextMenuCommentIsAiAuthored ? "AI のコメントは削除できません" : "このコメントを削除"}
            </ListItemText>
          </MenuItem>
        ) : (
          <MenuItem onClick={handleContextAddComment} data-testid="ctx-add-comment">
            <ListItemIcon>
              <AddCommentIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>コメント追加</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <AddCommentDialog
        open={commentDialog.open}
        mode={commentDialog.mode}
        targetSnippet={commentDialog.snippet}
        onClose={closeCommentDialog}
        onSubmit={handleCommentSubmit}
      />

      <ConfirmDialog />
      <ToastViewport />
    </Box>
  );
}
