import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { HTTPError } from "ky";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import Popper from "@mui/material/Popper";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Chip from "@mui/material/Chip";
import CloseIcon from "@mui/icons-material/Close";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CommentIcon from "@mui/icons-material/Comment";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { TiptapEditor } from "@/components/tiptap/TiptapEditor";
import {
  Sidebar,
  RootSelect,
  ToastViewport,
  ConfirmDialog,
  AddCommentDialog,
  CommentSidePane,
  DiffView,
  NameTooltip,
} from "@/components";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useRecentOpened } from "@/hooks/useRecentOpened";
import { useReadFile, useWriteFile } from "@/hooks/useFileContent";
import { useFileWatcher } from "@/hooks/useFileWatcher";
import { useDirChangeWatcher } from "@/hooks/useDirChangeWatcher";
import { useChangedPaths } from "@/hooks/useChangedPaths";
import { useServerEvents } from "@/hooks/useServerEvents";
import { useServerConnection } from "@/hooks/useServerConnection";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
import { computeLineNumbers } from "@/utils/lineNumbers";
import { useUIStore } from "@/hooks/useUIStore";
import { useHoverPanel } from "@/hooks/useHoverPanel";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useCommentAuthor } from "@/hooks/useCommentAuthor";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useQueryClient } from "@tanstack/react-query";
import {
  statFile,
  statBatch,
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
import { firstH1 } from "@/utils/firstH1";
import { formatLocalTimestamp } from "@/utils/formatTimestamp";
import { computeAnchorsFromSelection, resolveAnchorInDoc } from "@/utils/pmAnchor";
import { lineDiff, hasChanges } from "@/utils/lineDiff";
import { dirOf } from "@/utils/dirOf";
import { splitPreamble } from "@/utils/frontmatter";
import { computeDiffGutterMarks } from "@/utils/diffGutterMarks";
import { computeDisplayVersion } from "@/utils/revisionVersion";
import {
  commentIdsInRange,
  type HighlightComment,
} from "@/components/tiptap/extensions/CommentHighlight";
import { BAR_HEIGHT, TAB_CONTENT_HEIGHT } from "@/theme/dimensions";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const TARGET_SNIPPET_LENGTH = 60;
/** Pointer dwell before a comment highlight opens its 編集 / 削除 menu. */
const COMMENT_HOVER_OPEN_MS = 150;
/** Grace period after the pointer leaves the text or the menu. */
const COMMENT_HOVER_CLOSE_MS = 250;
/** Minimum gap between pointer samples — posAtCoords per mousemove is wasteful. */
const HOVER_SAMPLE_MS = 60;
/** How much of a comment body to quote when naming the delete target. */
const COMMENT_SUMMARY_LENGTH = 40;
const COMMENT_ID_PARAM = "comment_id";

/** Suffix on the browser tab title; matches the <title> in index.html. */
const APP_TITLE = "markdown-reviewer";
// How often to re-poll the active review file's comments for out-of-band
// changes (mr CLI / API / other viewers). Matches the file-tree cadence.
const COMMENTS_POLL_MS = 30_000;

/** One-line preview of a comment body, for naming what is about to be deleted. */
function commentSummary(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > COMMENT_SUMMARY_LENGTH
    ? `${oneLine.slice(0, COMMENT_SUMMARY_LENGTH)}…`
    : oneLine;
}

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

/** The text a comment is anchored to, for the edit dialog's target preview.
 *  Global comments have no anchor and show nothing. */
function commentTargetText(c: CommentJSON): string {
  return c.anchor?.snippet ?? c.anchors?.[0]?.snippet ?? "";
}

export function EditorPage() {
  const { active: activeRoot, roots, activePath: activeRootPath } = useActiveRoot();
  // The ad-hoc root (#240) holds exactly one file, so there is no tree to
  // browse: the sidebar stays collapsed and its hover/open affordances are
  // switched off rather than opening an empty panel.
  const isEphemeralRoot =
    roots.find((r) => r.name === activeRoot)?.ephemeral === true;

  // #219: `isSidebarOpen` now only tracks the transient hover overlay (see
  // useUIStore.ts). Whether the sidebar is visible at all is `isSidebarShown`
  // below, which also accounts for `sidebarPinned`.
  const isHoverOverlayOpen = useUIStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const sidebarPinned = useUIStore((s) => s.sidebarPinned);
  const setSidebarPinned = useUIStore((s) => s.setSidebarPinned);
  const isCommentPaneOpen = useUIStore((s) => s.isCommentPaneOpen);
  const toggleCommentPane = useUIStore((s) => s.toggleCommentPane);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);

  // Pinned => always shown (push layout). Unpinned => shown only while the
  // hover-panel guard has the overlay open.
  const isSidebarShown = !isEphemeralRoot && (sidebarPinned || isHoverOverlayOpen);

  const { hotZoneHandlers, panelHandlers } = useHoverPanel({
    onOpen: () => setSidebarOpen(true),
    onClose: () => setSidebarOpen(false),
    disabled: sidebarPinned || isEphemeralRoot,
  });

  /** Header-row hamburger (#219): toggles the pin, and — going by the
   *  keyboard-accessibility note in #219 — is always the pin control, not
   *  just a hover side-effect. Un-pinning also force-closes the overlay
   *  immediately rather than waiting for the hover-out grace period, since
   *  an explicit click is an unambiguous "hide it now". */
  const handleTogglePin = () => {
    if (sidebarPinned) {
      setSidebarPinned(false);
      setSidebarOpen(false);
    } else {
      setSidebarPinned(true);
    }
  };

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
  // "Recently" history for the sidebar (#229): the open-tab list itself is no
  // longer restored across reloads, so this is the only thing that carries
  // "what was I looking at last session" over.
  const recordRecentOpened = useRecentOpened((s) => s.record);

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

  // Browser tab title mirrors the editor tab you are looking at (#245), so
  // several markdown-reviewer windows are tellable apart from the OS tab bar
  // alone. The document's own h1 wins over the file name when it has one
  // (#247): names like `summary.md` repeat across roots and say nothing about
  // the contents. Keep the dirty marker identical to the editor tab's.
  useEffect(() => {
    if (!activeFile) {
      document.title = APP_TITLE;
      return;
    }
    const name = firstH1(activeFile.markdown) ?? activeFile.name;
    document.title = `${name}${activeFile.isDirty ? " •" : ""} — ${APP_TITLE}`;
    // Leaving the editor entirely (e.g. back-navigating onto NotFoundPage)
    // would otherwise leave the last file's name on a page that no longer
    // shows it.
    return () => {
      document.title = APP_TITLE;
    };
  }, [activeFile]);

  const readFile = useReadFile();
  const writeFile = useWriteFile();
  const confirm = useConfirm((s) => s.confirm);
  const showToast = useToast((s) => s.show);
  const showLineNumbers = useEditorPrefs((s) => s.showLineNumbers);
  const toggleLineNumbers = useEditorPrefs((s) => s.toggleLineNumbers);
  // Passive "unread change" tracking (#178) — replaces the old toast-based
  // dir-change notifications with sidebar dots. markChanged is the primary
  // path (SSE `tree` events, see onTree below — round 3); clearChanged runs
  // whenever a file becomes the active tab; registerSelfWrite tags this
  // app's own saves so the mark sources don't flag a self-save as external.
  const markChanged = useChangedPaths((s) => s.mark);
  const clearChanged = useChangedPaths((s) => s.clear);
  const isSelfWrite = useChangedPaths((s) => s.isSelfWrite);
  const registerSelfWrite = useChangedPaths((s) => s.registerSelfWrite);
  const editor = useEditorInstance((s) => s.editor);
  const centered = useEditorPrefs((s) => s.centered);
  const toggleCentered = useEditorPrefs((s) => s.toggleCentered);
  const { author } = useCommentAuthor();
  const queryClient = useQueryClient();

  // --- Managed-review session state (ingest / revision diff) ---------------
  // Kept local to the editor rather than in the open-files store: it is a view
  // concern derived from the server, refetched whenever the active file or a
  // save/ingest changes it. `reviewRefresh` is bumped to force a refetch.
  const [reviewState, setReviewState] = useState<ReviewState | undefined>(undefined);
  const [revisions, setRevisions] = useState<RevisionMeta[]>([]);
  const [revContents, setRevContents] = useState<Record<string, string>>({});
  // #143 round 3: whether the header version badge (v{N}) can be computed
  // correctly for the active file yet. See the readiness effect below for
  // the exact conditions; gating on this (rather than deriving straight from
  // `revisions`) is what stops a stale/guessed v1 from flashing before the
  // real revision list has loaded.
  const [versionReady, setVersionReady] = useState(false);
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
  const [commentsLoadedForPath, setCommentsLoadedForPath] = useState<string | null>(null);
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
  // Pending clear for the shared comment-flash decoration (#167), so a second
  // jump within the flash window does not get cut short by the first timer.
  const flashTimerRef = useRef<number | null>(null);

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

  // Absolute path of a tab's file, mirroring the sidebar's context menu so
  // both places hand out the same string (#232).
  const fullPathOf = (path: string): string => {
    if (!activeRootPath) return path;
    return `${activeRootPath.replace(/\/+$/, "")}/${path}`;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label}をコピーしました: ${text}`, "success");
    } catch (err) {
      showToast(
        `クリップボードへのコピーに失敗しました: ${(err as Error).message ?? "unknown"}`,
        "error"
      );
    }
  };

  // --- Server-push events (#112) --------------------------------------------
  // Bumped every time an SSE `file` event matches the active file, so
  // useFileWatcher can run its external-edit reconcile immediately instead
  // of waiting for its own interval (which is disabled once SSE is
  // connected — see the `paused` arg passed to useFileWatcher below).
  const [fileEventTrigger, setFileEventTrigger] = useState(0);
  const setSseConnected = useServerConnection((s) => s.setConnected);
  const { connected: sseConnected, suspended: sseSuspended } = useServerEvents({
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
      // #178 round 3: the primary "unread mark" source. Unlike the dir-diff
      // fallback (useDirChangeWatcher), this carries the exact changed
      // file's path regardless of the sidebar tree's expand/collapse state,
      // so a collapsed-and-deeply-nested file's change is never missed.
      // `ev.path` is empty for the server's ErrEventOverflow fallback (it
      // couldn't enumerate exactly what changed under a root) — skip those,
      // same as useDirChangeWatcher skips entries it can't attribute.
      // `ev.mtime` is empty when the server's os.Stat failed while building
      // the event (round 4 — typically the file was deleted; internal/
      // events/watcher.go) — skip marking there too: if the file is gone,
      // an ancestor directory could never clear this mark via the dir-diff
      // fallback (that path only clears marks it can see disappear from a
      // listing it's actually watching), so it would otherwise linger
      // forever. We don't know the file's true state here, and an unmarked
      // path is the safe default either way.
      if (ev.path && ev.mtime && !isSelfWrite(ev.root, ev.path, ev.mtime)) {
        markChanged(ev.root, ev.path);
      }
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
    // The stream is dropped while the tab is hidden (#183), so `tree` events
    // fired in that window never arrived. Re-read the listings the same way
    // onTree does — without a path to attribute them to, the only safe
    // assumption is that anything under any root may have moved.
    //
    // A `comments` event dropped in that window is invisible to every other
    // path: the two COMMENTS_POLL_MS intervals below only tick while the tab
    // is visible, so nothing re-reads the sidecar on its own. Without these
    // bumps the active file's comment list and the tabs' review badges stay
    // stale until the next event or a file switch.
    //
    // The active tab's *body* is covered separately by the reconcile on
    // sseConnected false->true below (#173).
    onResume: () => {
      void queryClient.invalidateQueries({ queryKey: ["dir"] });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      // A tab stat-404'd before we went hidden (#114) is normally un-excluded
      // by the `file`/`tree` event for its path — exactly the events that got
      // dropped. The sweep below skips excluded paths, so without clearing
      // the set first, a file re-created while hidden would stay unchecked
      // until it changed again or its tab was reactivated. We have no path to
      // attribute the resume to, so clear the whole set and let the sweep
      // re-derive it.
      missingStatFilesRef.current.clear();
      setCommentsRefresh((n) => n + 1);
      setReviewRefresh((n) => n + 1);
    },
  });
  useEffect(() => {
    setSseConnected(sseConnected);
  }, [sseConnected, setSseConnected]);

  // Re-sync the active tab on every SSE (re)connect (#173). The push channel
  // can only carry changes that happen *while* it is connected, so anything
  // that changed while the page was closed — or during a drop (laptop sleep,
  // server restart) — never produces a `file` event. useOpenFiles persists
  // markdown/savedMarkdown to localStorage, so without a reconcile on
  // rehydrate the tab keeps rendering its old buffer indefinitely (a hard
  // reload doesn't help: localStorage survives it), and saving from that
  // stale baseline would overwrite the external change.
  //
  // Nothing else covers this window: on mount fileEventTrigger is still 0 (so
  // useFileWatcher's trigger path doesn't fire) and the interval fallback is
  // cleared the instant `sseConnected` flips true, before its first +5s tick.
  // Bumping the trigger here runs the same reconcile the SSE onFile handler
  // uses (sha compare -> silent reload + toast when clean, confirm dialog when
  // dirty), which is a no-op whenever the sha still matches. Inactive tabs are
  // covered by the existing revalidate-on-reactivation path (#119 case 6).
  const prevSseConnectedRef = useRef(false);
  useEffect(() => {
    const wasConnected = prevSseConnectedRef.current;
    prevSseConnectedRef.current = sseConnected;
    if (sseConnected && !wasConnected) {
      setFileEventTrigger((n) => n + 1);
    }
  }, [sseConnected]);

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
    // #143 round 3: the previous file's version number must never linger
    // for even one frame on the newly-active tab.
    setVersionReady(false);
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
          if (!cancelled) {
            setRevisions(rl.revisions);
            // #143 round 3: a review file with no saved revisions yet has no
            // history to wait on — v1 is exact. A non-empty list still needs
            // the newest revision's content (the revContents-fetch effect
            // below resolves versionReady once that lands), so it is left
            // unresolved here to avoid flashing a guess.
            if (rl.revisions.length === 0) setVersionReady(true);
          }
        } else {
          setRevisions([]);
          // Draft has no revision history, so v1 is exact the instant we
          // know the file isn't under review — no need to wait on anything
          // else (#143 round 3).
          if (!cancelled) setVersionReady(true);
        }
      } catch (err) {
        if (err instanceof HTTPError && err.response.status === 404) {
          missingStatFilesRef.current.add(activeKey);
        }
        if (!cancelled) {
          setReviewState("draft");
          setRevisions([]);
          // #143 round 3: a failed stat/list must not silently freeze the
          // badge on a guessed version — leave it unresolved (hidden)
          // instead of defaulting to v1.
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
        if (!cancelled) {
          setComments(res.comments);
          setCommentsLoadedForPath(activePath);
        }
      } catch {
        if (!cancelled) {
          setComments([]);
          setCommentsLoadedForPath(activePath);
        }
      }
    })();
    return () => {
      cancelled = true;
      setCommentsLoadedForPath(null);
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
        // One request for the whole sweep (#174). Issuing a statFile per tab
        // in parallel put up to 191 requests on the wire at once, and with
        // only 6 connections per origin the active file's own body fetch
        // queued behind them until it timed out.
        const results = await statBatch(
          snapshot.map((f) => ({ root: f.root, path: f.path }))
        );
        if (cancelled) return;
        for (const r of results) {
          const key = keyOf(r.root, r.path);
          if (!r.error) {
            markReviewFile(key, r.hasOpenComments ?? false);
            continue;
          }
          // not_found means this tab's path no longer exists server-side —
          // remember it so future sweeps skip it (#114). Any other per-item
          // error is transient (or a malformed entry we shouldn't act on),
          // so it's ignored without marking the tab missing.
          //
          // Guard against the activation race: if the user activated this
          // exact tab while the batch was in flight, the per-active-file
          // stat effect owns its missing/present state from here on —
          // recording a late not_found would immediately re-exclude a tab
          // that effect just decided to (re)check.
          if (r.error === "not_found" && key !== currentActiveKey()) {
            missingStatFilesRef.current.add(key);
            markReviewFile(key, false);
          }
        }
      } catch {
        // A failed batch is transient (network blip, 5xx) and says nothing
        // about any individual file — leave every badge as-is, same as the
        // old per-file path did for non-404 errors.
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

  // Fetch every revision's content into the revContents cache so the diff
  // gutter (below) can find the previous round — the newest revision whose
  // body actually differs from the current saved markdown. `revisions[0]` is
  // often identical to savedMarkdown (AppendRevision snapshots pre-save), so
  // we need the full history to find one that differs. Skips fetches for
  // revisions we already have; cache is cleared on file switch.
  //
  // Also resolves the header version badge (#143 round 3) once the newest
  // revision's content is available — either just fetched below or already
  // cached from an earlier run of this effect — because computeDisplayVersion
  // needs that content to tell apart the two ways a revision gets appended
  // (browser save vs. external/AI edit sync; see computeDisplayVersion's
  // docstring). The draft case and the review-with-zero-revisions case are
  // resolved eagerly by the stat/revisions effect above instead, since
  // neither needs revision content. Deliberately one-way (never resets
  // versionReady back to false itself): only the file-switch reset above does
  // that, so periodic stat/comment polling doesn't flicker the badge once
  // resolved. setState only happens after an await — including the
  // microtask yield on the already-cached path — so it does not trigger the
  // synchronous-setState-in-effect lint.
  //
  // IMPORTANT (#143 round 4 — regression fix): this effect must keep fetching
  // whenever `missing` is non-empty, even after versionReady has already
  // resolved to true. The diff gutter (below) and `newestRevisionContent`
  // both depend on revContents staying complete for every revision the app
  // learns about later (e.g. a `SyncExternalEdit`-appended revision arriving
  // via polling while the tab is open) — not just the ones needed to resolve
  // the badge once. Gating the whole effect on `!versionReady` silently
  // stopped fetching new revisions' content after the first resolution,
  // leaving the gutter stuck on a stale baseline and letting
  // `newestRevisionContent` fall back to `undefined` (→ a wrong `+1` on the
  // badge — the very bug round 3 fixed). Only skip the effect entirely when
  // there is truly nothing to do: no missing content AND the badge is
  // already resolved.
  useEffect(() => {
    if (!activePath) return;
    if (revisions.length === 0) return;
    const missing = revisions.filter((r) => !(r.id in revContents));
    if (missing.length === 0 && versionReady) return;
    let cancelled = false;
    (async () => {
      let fetchedIds: string[] = [];
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(async (r) => {
            try {
              const rev = await getRevision(activePath, r.id, activeFileRoot);
              return [r.id, rev.content] as [string, string];
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        setRevContents((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const item of fetched) {
            if (item && !(item[0] in next)) {
              next[item[0]] = item[1];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        fetchedIds = fetched
          .filter((item): item is [string, string] => item !== null)
          .map((item) => item[0]);
      } else {
        // Nothing left to fetch this run (the newest revision's content is
        // already cached from a prior run) — still yield to a microtask so
        // the versionReady check below stays async.
        await Promise.resolve();
      }
      if (cancelled) return;
      // #143 round 3: check both the pre-existing cache and anything just
      // fetched above — the newest revision may have already been cached by
      // an earlier run of this effect (the `missing` filter above excludes
      // it), so relying on `fetchedIds` alone would miss that case.
      const latestId = revisions[0].id;
      if (latestId in revContents || fetchedIds.includes(latestId)) {
        setVersionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, activeFileRoot, revisions, revContents, versionReady]);

  // Compute and push diff-gutter marks for the active file. The gutter mirrors
  // DiffView's comparison axis: baseline = the newest revision whose body
  // actually differs from what's on disk (== the "previous round"); current =
  // the saved markdown (unsaved edits do NOT flow into the gutter — the user
  // wants to see the delta from the last round, not their own in-flight
  // edits). Empty marks when nothing has been fetched yet or no revision
  // differs, so unsaved-only edits and pristine files both show a clean
  // gutter.
  const diffGutterPayload = useMemo(() => {
    if (!activeFile) return { marks: [], blockCount: 0 };
    if (revisions.length === 0) return { marks: [], blockCount: 0 };
    const currentBody = splitPreamble(stripHint(activeFile.savedMarkdown)).body;
    const baselineRev = revisions.find((r) => {
      const raw = revContents[r.id];
      if (raw === undefined) return false;
      const body = splitPreamble(stripHint(raw)).body;
      return hasChanges(lineDiff(body, currentBody));
    });
    if (!baselineRev) return { marks: [], blockCount: 0 };
    const baselineBody = splitPreamble(stripHint(revContents[baselineRev.id])).body;
    return computeDiffGutterMarks(baselineBody, currentBody);
  }, [activeFile, revisions, revContents]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setDiffGutter(diffGutterPayload);
  }, [editor, diffGutterPayload]);

  // Line numbers for the left gutter (#234). Computed from the file as saved
  // (not the in-flight buffer) for the same reason the diff gutter is: the
  // numbers should match what a reviewer reads out of the file on disk, and
  // recomputing on every keystroke would churn the whole decoration set.
  const lineNumberPayload = useMemo(() => {
    if (!showLineNumbers || !activeFile) return { lines: [], blockCount: 0 };
    const raw = activeFile.savedMarkdown;
    const body = splitPreamble(stripHint(raw)).body;
    return computeLineNumbers(raw, body);
  }, [showLineNumbers, activeFile]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setLineNumbers(lineNumberPayload);
  }, [editor, lineNumberPayload]);

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

  // #143 round 3: newest revision's raw content (hint-stripped), used by
  // computeDisplayVersion to tell the external-edit path (content already
  // matches — no `+1`) apart from the browser-save path (content is one
  // save behind — `+1`). undefined while still being fetched — see
  // displayVersion below, which refuses to call computeDisplayVersion until
  // this is defined (for files with any revision history).
  const newestRevisionContent =
    revisions.length > 0 && revisions[0].id in revContents
      ? stripHint(revContents[revisions[0].id])
      : undefined;
  // #143 round 4 codex review: `versionReady` alone isn't enough once a file
  // is under review with history — it can be true from an *earlier* newest
  // revision while the current one's content is still in flight (a new
  // revision just landed in `revisions` but the revContents-fetch effect
  // hasn't resolved it yet, or its getRevision call failed and never will).
  // Recomputing from a stale/undefined newestRevisionContent would either
  // show yesterday's version for a beat or, on a failed fetch, wrongly and
  // permanently guess `+1` (versionReady never resets to false on its own).
  // So for files with revision history, only compute once *both* the badge
  // is otherwise ready AND the newest revision's content has actually
  // arrived; a history-less file (draft, or review with zero revisions) has
  // nothing to wait on beyond versionReady itself.
  const displayVersion =
    versionReady && (revisions.length === 0 || newestRevisionContent !== undefined)
      ? computeDisplayVersion(revisions, newestRevisionContent, currentEditorText)
      : undefined;

  // Why the diff toggle can't be used right now, or null when it can (#194).
  // The button is always rendered, so this doubles as its tooltip text.
  const diffDisabledReason = !activeFile
    ? "ファイルを開くと前回保存との差分を表示できます"
    : reviewState !== "review"
      ? "このファイルはまだレビュー対象ではありません"
      : revisions.length === 0
        ? "比較できる過去リビジョンがまだありません"
        : null;
  // While the diff view is open the button must stay clickable — it's the way
  // back out — even if the reason above has since become non-null (e.g. the
  // file was closed underneath it).
  const canToggleDiff = diffMode || diffDisabledReason === null;

  // Fallback poll is disabled while SSE is connected; the onFile callback
  // above bumps fileEventTrigger to drive the same reconcile logic instead.
  //
  // Also paused while the stream is suspended (#183): unlike the two
  // COMMENTS_POLL_MS intervals above, this one doesn't check visibility
  // itself, so treating a hidden tab's deliberate hang-up as a plain
  // disconnect would start a 5s /api/stat poll in every background tab —
  // trading the one SSE connection this PR frees for a steady drip of
  // requests. The reconcile it would have run is covered on return by the
  // sseConnected false->true bump below.
  useFileWatcher(undefined, {
    paused: sseConnected || sseSuspended,
    trigger: fileEventTrigger,
  });

  const handleRefreshTree = () => {
    // The sidebar has two data sources — the lazy tree ("dir") and the flat
    // recent list ("files") — refresh both so the button works in either
    // view mode (#68). Also bump reviewRefresh so tab badges reflect any
    // out-of-band review-state changes that happened since the last poll.
    void queryClient.invalidateQueries({ queryKey: ["dir"] });
    void queryClient.invalidateQueries({ queryKey: ["files"] });
    setReviewRefresh((n) => n + 1);
  };

  useDirChangeWatcher();

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeParams = useParams<{ root?: string; "*"?: string }>();
  // The splat only carries a path once react-router has actually matched
  // `/:root/*` — a bare `/:root` match leaves it undefined. react-router's
  // `useParams` already percent-decodes the value (`%2F` segments come back
  // as real `/`, escaped spaces/multibyte/a literal `%` are already
  // resolved) — do NOT decode it again: a file named e.g. `100% done.md`
  // round-trips to `useParams` as `"100% done.md"`, and re-running
  // `decodeURIComponent` on that throws `URIError: URI malformed`
  // (`% d` isn't a valid escape), crashing the whole page.
  const initialFilePathRef = useRef(routeParams["*"] || null);
  const initialCommentIdRef = useRef(searchParams.get(COMMENT_ID_PARAM));

  // Keep the URL path in sync with the active tab so the current view is
  // bookmarkable / shareable. Runs on every active-file change (tab click,
  // sidebar open, close-last-tab → undefined). The query string (comment_id,
  // the sidebar's filter) is carried over unchanged — only the path segment
  // that names the open file changes here.
  useEffect(() => {
    if (!activeRoot) return;
    const base = `/${encodeURIComponent(activeRoot)}`;
    const next = activeFile?.path
      ? `${base}/${encodeURIComponent(activeFile.path)}`
      : base;
    if (location.pathname === next) return;
    navigate({ pathname: next, search: location.search }, { replace: true });
  }, [activeRoot, activeFile?.path, location.pathname, location.search, navigate]);

  const [commentDialog, setCommentDialog] = useState<{
    open: boolean;
    mode: "anchored" | "global" | "edit";
    snippet: string;
    /**
     * The editor selection captured when the dialog opened (anchored mode).
     * Held so the anchor is computed against the exact range the user picked,
     * even if focus shifts to the dialog.
     */
    range?: { from: number; to: number };
    /** Set in "edit" mode: the comment whose body the dialog rewrites. */
    editingId?: string;
    /** Set in "edit" mode: the body the dialog opens with. */
    defaultBody?: string;
  }>({ open: false, mode: "anchored", snippet: "" });
  // Whether a pointer gesture in the editor is still in progress — the
  // selection bubble stays hidden until the drag ends.
  const pointerIsDown = useRef(false);
  // Comment whose DELETE is in flight, if any (see handleBubbleDeleteComment).
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // Set while the pointer rests on the menu itself, so the grace timer armed
  // when it left the text does not close it out from under them.
  const hoverMenuHeld = useRef(false);
  // What the pointer was last resting on, so repeated samples over the same
  // thing do not re-arm the timers. A component-level ref rather than an
  // effect-local variable because every path that closes the menu has to
  // clear it too — otherwise returning to the same spot is deduped away and
  // the menu never reopens.
  const hoverKey = useRef<string | null>(null);
  // What the pointer is resting on in the editor, with the rect to anchor the
  // menu to. Hover is the *only* trigger: resting on a comment highlight
  // offers 編集 / 削除, resting inside the current selection offers コメント追加,
  // and a selection inside a comment offers all three from the one menu.
  const [hoverTarget, setHoverTarget] = useState<{
    commentId?: string;
    /** Pointer is inside the live (non-empty) selection. */
    canAdd: boolean;
    top: number;
    left: number;
    bottom: number;
    right: number;
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

  // Pointer position → the comment menu. Decorations are not React elements,
  // so the listeners live on the editor's DOM and the menu is anchored to a
  // rect. A dwell before opening and a grace period after leaving keep it from
  // flickering as the pointer crosses text; the grace also covers the gap the
  // pointer has to travel to reach the menu.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let lastAt = 0;
    let lastEvent: MouseEvent | null = null;
    const clearTimers = () => {
      if (openTimer) clearTimeout(openTimer);
      if (closeTimer) clearTimeout(closeTimer);
      openTimer = undefined;
      closeTimer = undefined;
    };

    type Target = NonNullable<typeof hoverTarget>;
    const targetAt = (ev: MouseEvent): Target | null => {
      const markEl = (ev.target as HTMLElement | null)?.closest?.(
        "[data-comment-id]"
      ) as HTMLElement | null;
      let pos: { pos: number } | null = null;
      try {
        pos = editor.view.posAtCoords({ left: ev.clientX, top: ev.clientY });
      } catch {
        pos = null; // no layout (jsdom) — fall back to the DOM below
      }
      // Overlapping highlights render as split spans whose merged attributes
      // keep only one id, so ask the decoration set which comment sits under
      // the pointer (innermost first) and fall back to the attribute.
      const commentId =
        (pos ? commentIdsInRange(editor.state, pos.pos, pos.pos + 1)[0] : undefined) ??
        markEl?.getAttribute("data-comment-id") ??
        undefined;
      const { from, to, empty } = editor.state.selection;
      const canAdd =
        !empty && from !== to && !!pos && pos.pos >= from && pos.pos <= to;
      if (!commentId && !canAdd) return null;
      const r = markEl
        ? markEl.getBoundingClientRect()
        : new DOMRect(ev.clientX, ev.clientY, 0, 0);
      return {
        commentId,
        canAdd,
        top: r.top,
        left: r.left,
        bottom: r.bottom,
        right: r.right,
      };
    };

    const update = (ev: MouseEvent) => {
      const next = targetAt(ev);
      const key = next ? `${next.commentId ?? ""}|${next.canAdd}` : null;
      if (key === hoverKey.current) return;
      hoverKey.current = key;
      clearTimers();
      if (!next) {
        closeTimer = setTimeout(() => {
          if (!hoverMenuHeld.current) {
            setHoverTarget(null);
            hoverKey.current = null;
          }
        }, COMMENT_HOVER_CLOSE_MS);
        return;
      }
      openTimer = setTimeout(() => setHoverTarget(next), COMMENT_HOVER_OPEN_MS);
    };

    const onMove = (e: Event) => {
      const ev = e as MouseEvent;
      lastEvent = ev;
      // Mid-drag the selection is still being made and the menu would chase
      // the cursor, so wait for the release (handled in onPointerUp).
      if (pointerIsDown.current) return;
      const now = performance.now();
      if (now - lastAt < HOVER_SAMPLE_MS) return;
      lastAt = now;
      update(ev);
    };

    const onLeave = () => {
      clearTimers();
      closeTimer = setTimeout(() => {
        if (!hoverMenuHeld.current) {
          setHoverTarget(null);
          // Forget what was last under the pointer, or coming back to the
          // same highlight would be deduped away and never reopen.
          hoverKey.current = null;
        }
      }, COMMENT_HOVER_CLOSE_MS);
    };

    const onPointerDown = () => {
      pointerIsDown.current = true;
      clearTimers();
      hoverKey.current = null;
      setHoverTarget(null);
    };
    // A drag-select ends with the pointer sitting on the new selection and no
    // further mousemove, so re-evaluate from the last known position.
    const onPointerUp = () => {
      if (!pointerIsDown.current) return;
      pointerIsDown.current = false;
      if (lastEvent) update(lastEvent);
    };

    let dom: HTMLElement | undefined;
    const attach = () => {
      if (dom) return;
      try {
        dom = editor.view.dom as HTMLElement;
      } catch {
        return; // view not ready yet
      }
      // Capture phase for pointerdown: ProseMirror handles it itself, so the
      // flag has to be set before it runs.
      dom.addEventListener("pointerdown", onPointerDown, true);
      dom.addEventListener("mousemove", onMove);
      dom.addEventListener("mouseleave", onLeave);
    };
    attach();
    editor.on("create", attach);
    // On window, so a release outside the editor still ends the gesture.
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);

    return () => {
      clearTimers();
      editor.off("create", attach);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      dom?.removeEventListener("pointerdown", onPointerDown, true);
      dom?.removeEventListener("mousemove", onMove);
      dom?.removeEventListener("mouseleave", onLeave);
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
      // #178 round 2: cancelling here means the user never actually saw
      // `path` — leave its unread mark alone (clearing only below, once a
      // switch/open has actually happened) so it isn't silently hidden.
      if (!ok) return;
      // Roll the active file back to its saved baseline so its in-memory
      // edits aren't persisted to localStorage and don't reappear when the
      // user navigates back to it.
      discardActiveChanges(activeRoot);
    }

    if (target) {
      setActive(activeRoot, target.id);
      recordRecentOpened(activeRoot, target.path, target.name);
      // Re-activating an already-open tab (#119 case 6) can be stale if it
      // changed on disk while some other tab was active — the file watcher
      // was only checking whichever tab was active at the time. Bump the
      // same trigger the SSE onFile handler uses so it revalidates this tab
      // right now instead of waiting for the next interval/push event.
      setFileEventTrigger((n) => n + 1);
      // The switch actually happened — only now has the user "seen" it.
      clearChanged(activeRoot, path);
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
      recordRecentOpened(activeRoot, res.path, basename(res.path));
      // The read succeeded and the tab is now open — only now clear the
      // mark (#178 round 2: a failed readFile below must leave it in place,
      // since the user still hasn't actually seen the file).
      clearChanged(activeRoot, path);
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
    // Activating a tab is "opening" it just as much as a sidebar click, so
    // clear its unread mark the same way handleSelect does (#178).
    const target = files.find((f) => f.id === v);
    if (target) clearChanged(activeRoot, target.path);
    if (changed) {
      setFileEventTrigger((n) => n + 1);
    }
  };

  // Deeplink: `/{root}/{path}` opens that file on first mount. Held in a ref
  // so subsequent URL changes (e.g. user editing the sidebar filter, or the
  // tab-sync effect above rewriting the path) don't re-trigger the open, and
  // StrictMode's double-invoke is a no-op the second time. We wait until
  // activeRoot is non-empty so the read is scoped to the correct root from
  // the start.
  useEffect(() => {
    const path = initialFilePathRef.current;
    if (!path) return;
    if (!activeRoot) return;
    initialFilePathRef.current = null;
    void handleSelect(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoot]);

  // jump target is now resolved from the comment's own anchor(s) via
  // resolveAnchorInDoc, independent of whether a decoration exists:
  //  - open comment (decoration present): scroll to + flash that decoration,
  //    exactly as before.
  //  - resolved comment (no decoration): scroll to the live anchor position
  //    via editor.view.domAtPos and flash it with a transient decoration
  //    (CommentHighlight.flashCommentRanges) instead.
  //  - orphan (no anchor resolves): do nothing, as before — canJump already
  //    keeps the label from being clickable in this case.
  const handleJumpToComment = (id: string) => {
    if (!editor || editor.isDestroyed) return;
    const comment = comments.find((c) => c.id === id);
    if (!comment) return;

    // Both fields, not one or the other: a multi-line inline comment (#162)
    // keeps its first block in `anchor` and the rest in `anchors`, and
    // cross_section carries `anchors` only.
    const anchors = [
      ...(comment.anchor ? [comment.anchor] : []),
      ...(comment.anchors ?? []),
    ];
    const ranges = anchors
      .map((a) => resolveAnchorInDoc(editor.state.doc, a))
      .filter((r): r is { from: number; to: number } => r !== null)
      .sort((a, b) => a.from - b.from);
    if (ranges.length === 0) return; // orphan: no anchor resolves.

    // Retire any in-flight flash before starting a new jump, whichever branch
    // it came from: the flash decoration set and its timer are shared, so a
    // pending clear would cut this jump short and a stale flash would blink
    // alongside the new target.
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
      editor.commands.clearCommentFlash();
    }

    const root = editor.view.dom;
    const decorated = root.querySelectorAll<HTMLElement>(
      `[data-comment-id="${CSS.escape(id)}"]`
    );
    if (decorated.length > 0) {
      decorated[0].scrollIntoView({ behavior: "smooth", block: "center" });
      decorated.forEach((el) => {
        el.classList.remove("is-flash");
        void el.offsetWidth; // force reflow so the animation restarts
        el.classList.add("is-flash");
      });
      window.setTimeout(() => {
        decorated.forEach((el) => el.classList.remove("is-flash"));
      }, 1600);
      return;
    }

    const { node } = editor.view.domAtPos(ranges[0].from);
    const target =
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    editor.commands.flashCommentRanges(ranges);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      if (!editor || editor.isDestroyed) return;
      editor.commands.clearCommentFlash();
    }, 1600);
  };

  // Deeplink: `?comment_id=<id>` jumps to that comment once the file and comments land.
  useEffect(() => {
    const commentId = initialCommentIdRef.current;
    if (!commentId) return;
    if (!activePath || reviewState !== "review") return;
    if (commentsLoadedForPath !== activePath) return;
    if (!editor || editor.isDestroyed) return;

    initialCommentIdRef.current = null;
    handleJumpToComment(commentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, reviewState, commentsLoadedForPath, editor, comments]);

  // In-app link navigation (#213): TiptapEditor's click handler and
  // LinkPreviewModal's "Open" button both raise a request rather than
  // opening the file themselves, so this single subscriber is what actually
  // routes into handleSelect — reusing its unsaved-changes confirm, tab
  // reactivation and read-failure toast instead of duplicating them.
  const openPathRequest = useEditorInstance((s) => s.openPathRequest);
  const clearOpenPathRequest = useEditorInstance((s) => s.clearOpenPathRequest);
  useEffect(() => {
    if (!openPathRequest) return;
    clearOpenPathRequest();
    // Reacting to a request raised by another component (TiptapEditor's
    // click handler / LinkPreviewModal's "Open" button) is exactly what an
    // effect subscribing to external store state is for; there's no render
    // to derive this from. Mirrors the identical, pre-existing deeplink
    // effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handleSelect(openPathRequest.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPathRequest, clearOpenPathRequest]);

  // Save conflict (#119 case 5): the server rejects the write with 412 when
  // `If-Match` no longer matches the on-disk sha — i.e. the file changed on
  // disk since we last read/wrote it — and writes nothing. Offer to
  // overwrite (retry without If-Match, legacy last-write-wins) or cancel
  // (the file watcher's next tick will independently offer to take the
  // external change, since the on-disk sha now differs from ours).
  // Shared by both overwrite prompts below so the wording can't drift apart.
  const confirmOverwrite = (name: string) =>
    confirm({
      title: "保存の競合",
      message: `「${name}」は他の場所で更新されているため、まだ保存していません。\n外部の変更を上書きして保存しますか？`,
      confirmLabel: "上書き保存",
      cancelLabel: "キャンセル",
    });

  const handleSave = async () => {
    if (!activeFile) return;
    // #202: the 412 path below is what normally forces an explicit overwrite
    // decision, but it only exists when we have a baseline sha to send as
    // If-Match. A tab with none (rehydrated from a pre-sha session, or a
    // server that doesn't report one) writes unconditionally — so if the
    // user has already dismissed an external change on this tab, ask here
    // instead of silently clobbering it.
    if (activeFile.ignoredExternal && !activeFile.serverSha) {
      const overwrite = await confirmOverwrite(activeFile.name);
      if (!overwrite) return;
    }
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
      // The save itself shouldn't leave the file "unread" (#178), and its
      // resulting mtime is this app's own write — the tree watcher's next
      // dir-poll diff for the same root/path/mtime is its echo, not an
      // external change, so consume it silently instead of marking it.
      clearChanged(activeFile.root, activeFile.path);
      registerSelfWrite(activeFile.root, activeFile.path, res.modified);
      showToast(`「${activeFile.name}」を保存しました`, "success");
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 412) {
        const overwrite = await confirmOverwrite(activeFile.name);
        if (!overwrite) return;
        try {
          const res = await writeFile.mutateAsync({
            path: activeFile.path,
            content: activeFile.markdown,
            root: activeFile.root,
          });
          markActiveSaved(activeFile.root, res.modified, res.created, res.sha);
          setReviewRefresh((n) => n + 1);
          clearChanged(activeFile.root, activeFile.path);
          registerSelfWrite(activeFile.root, activeFile.path, res.modified);
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

  // One menu, one trigger: whatever the pointer is resting on decides which
  // entries it carries. Anchored under the hovered highlight when there is
  // one, otherwise at the pointer inside the selection.
  const menuAnchor = hoverTarget
    ? {
        rect: new DOMRect(
          hoverTarget.left,
          hoverTarget.top,
          hoverTarget.right - hoverTarget.left,
          hoverTarget.bottom - hoverTarget.top
        ),
        placement: "bottom-start" as const,
      }
    : null;
  // Looked up from the live list rather than cached with the trigger, so a
  // delete elsewhere makes the entries disappear.
  const bubbleComment = comments.find((c) => c.id === hoverTarget?.commentId);
  const menuCanAdd = !!hoverTarget?.canAdd && canAddComment;
  const menuOpen = !!menuAnchor && (menuCanAdd || !!bubbleComment);
  const bubbleCommentIsAiAuthored = bubbleComment?.author === "ai";
  // Resolved comments are read-only until reopened — the backend rejects a
  // body edit with 409, so the bubble mirrors the side pane and disables it.
  const bubbleCommentIsResolved = bubbleComment?.status === "resolved";
  const bubbleEditDisabledReason = bubbleCommentIsAiAuthored
    ? "AI のコメントは編集できません"
    : bubbleCommentIsResolved
      ? "解決済みのため編集できません"
      : null;
  const bubbleDeleteDisabledReason = bubbleCommentIsAiAuthored
    ? "AI のコメントは削除できません"
    : null;

  // Two guards the right-click menu did not need:
  //  - a confirmation naming the comment. The bubble's buttons sit next to
  //    「コメント追加」 and the target is implicit (with nested highlights the
  //    innermost one wins), so a misclick would silently drop someone's
  //    comment.
  //  - one in-flight delete per comment. The bubble stays up while the DELETE
  //    runs (the menu closed on click), so a double-click fired it twice and
  //    the second one 404'd into a failure toast for a delete that succeeded.
  const handleBubbleDeleteComment = () => {
    const target = bubbleComment;
    if (!target || bubbleDeleteDisabledReason || deletingCommentId === target.id) {
      return;
    }
    setDeletingCommentId(target.id);
    void (async () => {
      try {
        const ok = await confirm({
          title: "コメントを削除しますか？",
          message: `「${commentSummary(target.body)}」を削除します。元に戻せません。`,
          confirmLabel: "削除",
        });
        if (ok) {
        await handleDeleteComment(target.id);
        setHoverTarget(null);
        hoverKey.current = null;
      }
      } finally {
        setDeletingCommentId(null);
      }
    })();
  };

  // Edit the selected comment without leaving the editor: the same dialog used
  // to add a comment, seeded with the stored body and switched to "edit".
  const handleBubbleEditComment = () => {
    const target = bubbleComment;
    if (!target || bubbleEditDisabledReason) return;
    setHoverTarget(null);
    hoverKey.current = null;
    setCommentDialog({
      open: true,
      mode: "edit",
      snippet: buildTargetSnippet(commentTargetText(target)),
      editingId: target.id,
      defaultBody: target.body,
    });
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
    scope?: "inline" | "block" | "global";
  }) => {
    if (!editor || !activeFile) {
      closeCommentDialog();
      return;
    }
    // "edit" mode rewrites an existing body; the scope was fixed at creation
    // and the dialog emits none.
    const editingId = commentDialog.editingId;
    if (editingId) {
      try {
        await handleEditComment(editingId, body);
      } finally {
        closeCommentDialog();
      }
      return;
    }
    const date = todayISO();
    const path = activeFile.path;
    const root = activeFile.root;

    try {
      if (scope === "global") {
        await createComment(path, { scope: "global", body, author, date }, root);
      } else {
        // anchored inline — anchor(s) cover every block the selection
        // touches (#162), not just the block holding the selection start.
        const range = commentDialog.range;
        const anchors = range
          ? computeAnchorsFromSelection(editor.state.doc, range.from, range.to)
          : [];
        if (anchors.length === 0) {
          showToast("選択範囲のアンカーを特定できませんでした", "warning");
          closeCommentDialog();
          return;
        }
        await createComment(
          path,
          { scope: "inline", body, author, date, anchor: anchors[0], anchors: anchors.slice(1) },
          root
        );
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

  // Scroll to + flash a comment's target in the editor.
  //
  // #167: this used to key off the CommentHighlight decoration
  // (`[data-comment-id]`) alone, so resolved comments — which intentionally
  // carry no decoration (#96/#97) — silently did nothing when clicked. The
  // jump target is now resolved from the comment's own anchor(s) via
  const canSave = Boolean(activeFile);
  const isSaving = writeFile.isPending;

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* #219: unpinned + hidden state now has zero width — no permanent
          rail — so the editor gets the full window width back. The only
          way back in is the 8px hot zone below (or the persistent "open
          sidebar" button in the main header once it's fully hidden).
          Bug fix (post-review): this must stay mounted for the whole time
          the sidebar is unpinned, *including while the overlay is open* —
          it used to only render while hidden, so unmounting it the instant
          the overlay opened dropped the pointer's `mouseleave` on the
          floor. HoverPanelGuard's "still over the hot zone" flag was then
          stuck true forever (nothing ever told it otherwise), so leaving
          the panel could never satisfy "both regions empty" and the
          close-grace timer never got armed — the overlay stayed open for
          good. Keeping the hot zone element (and its data-testid) present
          throughout — it's a thin strip the aside's fixed overlay simply
          draws on top of — means every mouseleave reaches the guard. */}
      {!sidebarPinned && (
        <Box
          data-testid="sidebar-hot-zone"
          onMouseEnter={hotZoneHandlers.onMouseEnter}
          onMouseLeave={hotZoneHandlers.onMouseLeave}
          sx={{
            position: "fixed",
            top: 0,
            left: 0,
            bottom: 0,
            width: 8,
            // Kept strictly above the overlay aside's z-index (below) so
            // this strip keeps receiving raw pointer enter/leave events for
            // its 8px column even while the overlay sits on top of it —
            // otherwise the aside would swallow those events the moment it
            // renders, and a boundary crossing at x=8 wouldn't fire a real
            // mouseleave on this element (see the bug note above).
            zIndex: (theme) => theme.zIndex.drawer + 2,
          }}
        />
      )}
      {isSidebarShown && (
        <Box
          ref={asideRef}
          component="aside"
          onMouseEnter={panelHandlers.onMouseEnter}
          onMouseLeave={panelHandlers.onMouseLeave}
          sx={{
            width: sidebarWidth,
            // Pinned: part of the flex row, pushing the editor over.
            // Unpinned (hover overlay): fixed so it floats above the
            // content instead of shifting it (#219 — Notion-style reveal).
            flexShrink: 0,
            position: sidebarPinned ? "relative" : "fixed",
            top: sidebarPinned ? undefined : 0,
            left: sidebarPinned ? undefined : 0,
            bottom: sidebarPinned ? undefined : 0,
            zIndex: sidebarPinned ? undefined : (theme) => theme.zIndex.drawer + 1,
            boxShadow: sidebarPinned ? "none" : 4,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            // The overlay slides in from the edge; pinned mode never
            // animates (it's laid out by flex from the first render, and
            // toggling pin on/off shouldn't visually "slide" a push panel).
            ...(sidebarPinned
              ? {}
              : {
                  animation: "sidebar-slide-in 120ms ease-out",
                  "@keyframes sidebar-slide-in": {
                    from: { transform: "translateX(-100%)" },
                    to: { transform: "translateX(0)" },
                  },
                  "@media (prefers-reduced-motion: reduce)": {
                    animation: "none",
                  },
                }),
          }}
        >
          <Box
            sx={{
              pl: 0.5,
              pr: 1.5,
              // #143, #158: この 1 行目の下線は廃止した。BAR_HEIGHT 固定は、
              // 直下の Sidebar フィルタバー（2 行目 — multi-root では root
              // 切替がヘッダーの RootSelect に移り、RootTabs は廃止された）
              // のディバイダを他ペインの 2 行目と揃えて 1 本の連続線にする
              // ために引き続き必要（#65, #90）。オーバーレイ表示時もこの
              // 高さ・見た目を崩さない（#219）。
              height: BAR_HEIGHT,
              flexShrink: 0,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            {/* #219: この 1 個のボタンがピン留めのトグル。マウスホバーだけ
                がサイドバーへの唯一の導線にならないよう、開いている間は
                常にここからクリックでピン留めの on/off ができる。 */}
            <Tooltip title={sidebarPinned ? "サイドバーのピン留めを解除" : "サイドバーをピン留め"}>
              <IconButton
                size="small"
                onClick={handleTogglePin}
                aria-label={sidebarPinned ? "close sidebar" : "pin sidebar"}
                data-testid="sidebar-pin-toggle"
              >
                {sidebarPinned ? (
                  <MenuOpenIcon fontSize="small" />
                ) : (
                  <MenuIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
            <RootSelect />
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
            // #143: この 1 行目の下線は廃止した。BAR_HEIGHT 固定は、直下の
            // タブバー（2 行目、editor-tabs の borderBottom）のディバイダを
            // 他ペインの 2 行目と揃えて 1 本の連続線にするために引き続き
            // 必要（#65, #90）。
            height: BAR_HEIGHT,
            flexShrink: 0,
            boxSizing: "border-box",
          }}
        >
          {/* #219: persistent keyboard/click entry point back into the
              sidebar once it's fully hidden (no pin, pointer not hovering
              the hot zone). Reopens it pinned, matching the old rail
              button's behavior, but doesn't reserve permanent sidebar
              width the way that rail did. */}
          {/* #223: while unpinned, this button always occupies its slot in
              the header row — it's only made invisible once the hover
              overlay covers it. Unmounting it (the original #219 shape)
              removed its 38px footprint (30px button + 8px flex gap) the
              moment the overlay opened, so the logo and the filename after
              it jumped left every time the pointer touched the hot zone. */}
          {!sidebarPinned && !isEphemeralRoot && (
            <Tooltip title="サイドバーを開く">
              <IconButton
                size="small"
                onClick={() => setSidebarPinned(true)}
                aria-label="open sidebar"
                data-testid="sidebar-open-button"
                // The overlay draws its own hamburger at the same spot, so
                // hide this one while the overlay is up — and take it out
                // of the tab order / a11y tree with it, since an invisible
                // control must not be focusable.
                aria-hidden={isSidebarShown}
                tabIndex={isSidebarShown ? -1 : undefined}
                // #221: this button stands in for the sidebar header's own
                // hamburger while the sidebar is hidden, so it must sit at
                // the same x. The sidebar header uses pl: 0.5 (4px) while
                // this header uses px: 2 (16px), so shift it left by the
                // 12px difference. `transform` rather than a negative
                // margin, so the button's own footprint in the flex row is
                // unchanged and the logo (and everything after it) keeps
                // the header's own padding.
                sx={{
                  transform: "translateX(-12px)",
                  visibility: isSidebarShown ? "hidden" : "visible",
                  pointerEvents: isSidebarShown ? "none" : undefined,
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
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
            {/* #143: 現在の内容がどの版にあたるかを算出して表示する。
                revision は「保存前の内容」(ブラウザ保存 PUT /api/files) と
                「現在の内容そのもの」(外部編集同期 SyncExternalEdit、AI の
                in-place 編集が主用途) の 2 経路で追加され、どちらだったかで
                現在の版が「最新 revision と同じ」か「その1つ先」かが変わる
                （判定ロジックは computeDisplayVersion 参照）。
                また revisions.length ではなく最新 revision の ID から算出する
                のは、history.jsonl が MaxRevisions=20 でトリムされ配列長が
                頭打ちになっても ID は単調増加し続けるため（codex レビュー
                round 2 指摘）。
                読み込み完了 (versionReady) までバッジ自体を出さない（誤った
                v1 の一瞬表示や取得失敗時の固定表示を防ぐ。codex レビュー
                round 3 指摘）。既存の枠（パス / ⓘ / レビュー中）を上書きせず
                独立した表示枠として追加する（1枠1意味）。 */}
            {activeFile && displayVersion !== undefined && (
              <Tooltip
                title={
                  revisions.length > 0
                    ? `現在は v${displayVersion}（最新 revision: ${revisions[0].id}）`
                    : "保存済み revision なし → 現在は v1"
                }
              >
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", flexShrink: 0, whiteSpace: "nowrap" }}
                  data-testid="editor-active-version"
                >
                  v{displayVersion}
                </Typography>
              </Tooltip>
            )}
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
          {/* Always rendered (#194): the button used to disappear whenever the
              file wasn't under review, which moved every icon to its right and
              hid the feature's existence. Now it stays put and unavailability is
              expressed with disabled + a tooltip saying why. */}
          <Tooltip
            title={
              diffMode
                ? "差分表示を閉じる"
                : (diffDisabledReason ?? "前回保存との差分を表示")
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={!canToggleDiff}
                onClick={handleToggleDiff}
                aria-label="toggle diff"
                data-testid="editor-diff-toggle"
                {...(diffMode ? { color: "primary" as const } : {})}
              >
                <CompareArrowsIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
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
          <Tooltip title={showLineNumbers ? "行番号を非表示" : "行番号を表示"}>
            <IconButton
              size="small"
              onClick={toggleLineNumbers}
              aria-label="toggle line numbers"
              color={showLineNumbers ? "primary" : "default"}
              data-testid="editor-toggle-line-numbers"
            >
              <FormatListNumberedIcon fontSize="small" />
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
            // #158: Tabs のルートは（Tailwind preflight により）border-box なので
            // minHeight には枠線込みの BAR_HEIGHT を渡す。TAB_CONTENT_HEIGHT
            // （= BAR_HEIGHT - 1）を渡すとバー全体が 36px になり、他ペインの
            // 2 行目（height: BAR_HEIGHT の border-box）に対して下線が 1px
            // 上にずれる。内容高さは Tab 側の minHeight で 36px を保つ。
            minHeight: BAR_HEIGHT,
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
                    {/* Tooltip wraps the label span, not the Tab itself: Tabs
                        reads `value` off its direct children, so wrapping the
                        Tab would make it fall back to the index and break
                        selection (#192). */}
                    <NameTooltip name={f.name} placement="bottom">
                      <Box
                        component="span"
                        data-testid={`editor-tab-label-${f.path}`}
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
                    </NameTooltip>
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
            onClick={() => {
              const target = files.find((f) => f.id === tabMenu?.id);
              setTabMenu(null);
              if (target) void copyToClipboard(target.name, "名前");
            }}
            data-testid="tab-ctx-copy-name"
          >
            名前をクリップボードにコピー
          </MenuItem>
          <MenuItem
            onClick={() => {
              const target = files.find((f) => f.id === tabMenu?.id);
              setTabMenu(null);
              if (target) void copyToClipboard(fullPathOf(target.path), "フルパス");
            }}
            data-testid="tab-ctx-copy-path"
          >
            フルパスをコピー
          </MenuItem>
          <Divider />
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
            root={activeFileRoot}
            filePath={activePath}
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

      {menuOpen && menuAnchor && (
        <Popper
          open
          placement={menuAnchor.placement}
          // Anchored to a rect (a selection range, or the hovered mark) rather
          // than an element — a virtual anchor keeps Popper's flip/shift
          // behavior near a viewport edge without one.
          anchorEl={{ getBoundingClientRect: () => menuAnchor.rect }}
          modifiers={[{ name: "offset", options: { offset: [0, 6] } }]}
          sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
          data-testid="editor-comment-menu"
          // The pointer has to cross the gap between the highlight and the
          // menu, so the menu itself keeps the hover alive.
          onMouseEnter={() => {
            hoverMenuHeld.current = true;
          }}
          onMouseLeave={() => {
            hoverMenuHeld.current = false;
            setHoverTarget(null);
            hoverKey.current = null;
          }}
        >
          <Paper elevation={4} sx={{ p: 0.5, minWidth: 180 }}>
            {bubbleComment && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", px: 1, pt: 0.25, pb: 0.5 }}
                data-testid="editor-comment-menu-target"
              >
                {commentSummary(bubbleComment.body)}
              </Typography>
            )}
            {menuCanAdd && (
              <Button
                size="small"
                fullWidth
                startIcon={<CommentIcon fontSize="small" />}
                sx={{ justifyContent: "flex-start" }}
                // Keep the selection alive: focusing the button would collapse
                // it in some browsers before the handler reads from/to.
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddCommentClick}
                data-testid="editor-menu-add-comment"
              >
                コメント追加
              </Button>
            )}
            {bubbleComment && (
              <>
                <Tooltip title={bubbleEditDisabledReason ?? ""} placement="right">
                  {/* A disabled MUI Button swallows hover events, so the
                      tooltip carrying the reason needs a live wrapper. */}
                  <span>
                    <Button
                      size="small"
                      fullWidth
                      startIcon={<EditOutlinedIcon fontSize="small" />}
                      sx={{ justifyContent: "flex-start" }}
                      disabled={!!bubbleEditDisabledReason}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleBubbleEditComment}
                      data-testid="editor-menu-edit-comment"
                    >
                      コメント編集
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={bubbleDeleteDisabledReason ?? ""} placement="right">
                  <span>
                    <Button
                      size="small"
                      fullWidth
                      color="error"
                      startIcon={<DeleteOutlineIcon fontSize="small" />}
                      sx={{ justifyContent: "flex-start" }}
                      disabled={
                        !!bubbleDeleteDisabledReason ||
                        deletingCommentId === bubbleComment.id
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleBubbleDeleteComment}
                      data-testid="editor-menu-delete-comment"
                    >
                      コメント削除
                    </Button>
                  </span>
                </Tooltip>
              </>
            )}
          </Paper>
        </Popper>
      )}

      <AddCommentDialog
        open={commentDialog.open}
        mode={commentDialog.mode}
        targetSnippet={commentDialog.snippet}
        defaultBody={commentDialog.defaultBody}
        onClose={closeCommentDialog}
        onSubmit={handleCommentSubmit}
      />

      <ConfirmDialog />
      <ToastViewport />
    </Box>
  );
}
