import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commentsEqual } from "@/utils/commentsEqual";
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
  CommentSidePane,
  CommentComposerPopover,
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
import { useActiveRoot, OPEN_PARAM } from "@/hooks/useActiveRoot";
import { useQueryClient } from "@tanstack/react-query";
import {
  statFile,
  statBatch,
  ingestFile,
  listRevisions,
  createRevision,
  getRevision,
  restoreRevision,
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
import { popoverFrame } from "@/utils/popoverFrame";
import { scrollTableIntoView } from "@/utils/scrollTableIntoView";
import type {
  ComposerMode,
  ComposerSubmit,
} from "@/components/CommentComposerPopover";
import { BAR_HEIGHT, TAB_CONTENT_HEIGHT } from "@/theme/dimensions";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const TARGET_SNIPPET_LENGTH = 60;
/** Pointer dwell before the selection's "コメント追加" menu opens. */
const COMMENT_HOVER_OPEN_MS = 150;
/** Grace period after the pointer leaves the selection or the menu. */
const COMMENT_HOVER_CLOSE_MS = 250;
/** Minimum gap between pointer samples — posAtCoords per mousemove is wasteful. */
const HOVER_SAMPLE_MS = 60;
const COMMENT_ID_PARAM = "comment_id";

/** Suffix on the browser tab title; matches the <title> in index.html. */
const APP_TITLE = "markdown-reviewer";
// How often to re-poll the active review file's comments for out-of-band
// changes (mr CLI / API / other viewers). Matches the file-tree cadence.
const COMMENTS_POLL_MS = 30_000;
// Idle time before an edited buffer is written to disk (#280). Long enough
// that a pause mid-sentence doesn't churn the file (every write re-injects the
// AI hint and wakes the file watcher), short enough that a crash or a closed
// laptop loses at most a few seconds of typing.
const AUTOSAVE_IDLE_MS = 10_000;

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

/** Shallow key/value equality for the anchorTops map (#298): avoids a state
 *  update — and the render + effect cascade it triggers — when a recompute
 *  produced the same positions as last time. */
function shallowEqualRecord(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

// Walks up from `el` to find the nearest ancestor that actually scrolls
// (`overflow-y: auto|scroll` and content taller than its box). The DOM
// structure between the ProseMirror root and its real scroll container
// isn't fixed — TiptapEditor wraps it in one or more plain divs before the
// `overflow: auto` Box that does the scrolling (and centered-layout toggles
// swap which wrapper that is) — so the caller can't assume a fixed ancestor
// depth like "parentElement".
function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function EditorPage() {
  const { active: activeRoot, roots, activePath: activeRootPath } = useActiveRoot();
  // Mirrors `activeRoot` into a ref so async handlers created at click time
  // (e.g. handleRestoreRevision's isStillActiveTab guard) can read the root
  // the page is *currently* showing after an await, rather than the stale
  // value closed over at the moment they were defined. Same rationale as
  // TiptapEditor's own `activeRootRef` (#282 follow-up P2: switching to a
  // different root doesn't clear the old root's `activeIdByRoot` entry, so
  // an id-only check can't tell "still this tab" apart from "switched root
  // entirely, but that root's map still happens to point at the same id").
  const activeRootRef = useRef(activeRoot);
  useEffect(() => {
    activeRootRef.current = activeRoot;
  }, [activeRoot]);
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
  const markFileSaved = useOpenFiles((s) => s.markFileSaved);
  const applyExternalReload = useOpenFiles((s) => s.applyExternalReload);
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
  // True while a restore-to-this-version request (#282) is in flight for the
  // active file. Drives DiffView's restoring prop so the button can't be
  // double-clicked into two concurrent writes.
  const [restoringRevision, setRestoringRevision] = useState(false);
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
  // --- Autosave (#280) ----------------------------------------------------
  // Ids with an autosave request in flight, so a scheduled save and a flush
  // (tab switch / close) can't both write the same buffer concurrently.
  const autosaveInFlight = useRef<Set<string>>(new Set());

  /**
   * Persist one file's buffer without any dialog. Returns true when the file
   * ends up clean on disk (including "was already clean").
   *
   * Deliberately silent on success: a toast every 10 seconds is noise, and the
   * tab's dirty marker already reports the state. The only thing it speaks up
   * about is a write it refused or failed.
   */
  const autosave = useCallback(async (fileId: string): Promise<boolean> => {
    const file = useOpenFiles.getState().files.find((f) => f.id === fileId);
    if (!file) return false;
    if (!file.isDirty) return true;
    // Fail-closed backstop (#293), independent of the onUpdate gate that
    // sets `isDirty` in the first place: never write a buffer to disk that
    // the user never actually typed/pasted/toolbar-edited into, even if
    // some other bug left it dirty. Nothing was lost — the buffer just
    // never diverged from the user's intent — so this is reported as
    // "already clean" rather than a failure.
    if (!file.userEdited) return true;
    if (autosaveInFlight.current.has(fileId)) return false;
    // An un-reconciled external change means there is no baseline we can
    // honestly claim to be building on. Overwriting it is a decision, so leave
    // it to the explicit save (which prompts) and keep the buffer dirty.
    if (file.ignoredExternal) return false;
    const content = file.markdown;
    autosaveInFlight.current.add(fileId);
    try {
      const res = await writeFile.mutateAsync({
        path: file.path,
        content,
        root: file.root,
        ifMatch: file.serverSha,
      });
      // `content`, not the current buffer: the user may have typed on while
      // this request was out, and those keystrokes are not on disk yet.
      markFileSaved(file.id, content, res.modified, res.created, res.sha);
      // This write is our own; don't let the tree watcher report its echo as
      // an external change (see handleSave).
      clearChanged(file.root, file.path);
      registerSelfWrite(file.root, file.path, res.modified);
      return true;
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 412) {
        // No modal mid-typing: say what happened and let the user decide via
        // the save button (which prompts for the overwrite).
        showToast(
          `「${file.name}」はエディタ外で変更されているため自動保存を中止しました。保存ボタンで上書きできます`,
          "warning"
        );
        return false;
      }
      showToast(
        `自動保存に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
      return false;
    } finally {
      autosaveInFlight.current.delete(fileId);
    }
  }, [writeFile, markFileSaved, clearChanged, registerSelfWrite, showToast]);


  const closeFile = (id: string) => {
    // Flush before closing (#265) so a tab closed within the debounce
    // window doesn't lose its last keystroke from the store.
    useEditorInstance.getState().flushPendingMarkdown();
    const target = useOpenFiles.getState().files.find((f) => f.id === id);
    // Autosave (#280) reads the buffer synchronously before the await, so
    // firing it here still sees the tab that is about to be dropped.
    void autosave(id);
    closeFileRaw(id);
    if (target) missingStatFilesRef.current.delete(keyOf(target.root, target.path));
  };
  const closeOthers = (id: string) => {
    useEditorInstance.getState().flushPendingMarkdown();
    const target = useOpenFiles.getState().files.find((f) => f.id === id);
    const closed = target
      ? useOpenFiles.getState().files.filter((f) => f.root === target.root && f.id !== id)
      : [];
    // See closeFile (#280).
    for (const f of closed) void autosave(f.id);
    closeOthersRaw(id);
    for (const f of closed) missingStatFilesRef.current.delete(keyOf(f.root, f.path));
  };
  const closeToRight = (id: string) => {
    // See closeFile (#265).
    useEditorInstance.getState().flushPendingMarkdown();
    const target = useOpenFiles.getState().files.find((f) => f.id === id);
    const closed = (() => {
      if (!target) return [];
      const sameRoot = useOpenFiles.getState().files.filter((f) => f.root === target.root);
      const index = sameRoot.findIndex((f) => f.id === id);
      return index === -1 ? [] : sameRoot.slice(index + 1);
    })();
    // See closeFile (#280).
    for (const f of closed) void autosave(f.id);
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
          // Keep the previous array when the sidecar came back unchanged
          // (#270). A comment write triggers this fetch twice — once from the
          // mutation handler, once from the SSE echo of our own review.json
          // write — and without this the identical second response still
          // re-ran every `comments` consumer, including the full re-resolve of
          // every comment anchor over the whole document.
          setComments((prev) =>
            commentsEqual(prev, res.comments) ? prev : res.comments
          );
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

  // Restore-to-this-version (#282), wired from DiffView's confirm dialog.
  // The server writes the revision's content back onto the canonical file
  // and snapshots what was there before as a new revision, so this is treated
  // exactly like the app's own write: reload the tab's buffer from the
  // response (same shape as PUT /api/files) rather than re-fetching, tag the
  // resulting mtime as a self-write so the external-change watcher doesn't
  // immediately re-prompt about it, and re-pull the revision list so the
  // picker/diff gutter see the new snapshot.
  const handleRestoreRevision = async (id: string) => {
    if (!activeFile) return;
    // Capture identity up front and re-check it (via the store, not this
    // closure) after every await below. Revision ids are per-file, so a
    // slow response landing after the user has switched to a different tab
    // must not clobber that tab's diff-view state (revisions/revContents/
    // selectedRevId/diffBaseText) — otherwise file B's screen ends up
    // showing file A's baseline, and pressing "戻す" again restores the
    // wrong file's revision (codex review, #282 follow-up P1). Mirrors the
    // "re-read from the store instead of trusting captured state" pattern
    // `autosave` already uses above.
    const fileId = activeFile.id;
    const filePath = activeFile.path;
    const fileRoot = activeFile.root;
    // Root must match too (#282 follow-up P2): `activeIdByRoot` keeps a
    // separate entry per root and switching roots doesn't clear the old
    // one, so an id-only check still reports "still active" after the user
    // has navigated to an entirely different root whose own active tab
    // happens to share this file's id.
    const isStillActiveTab = () =>
      activeRootRef.current === fileRoot &&
      useOpenFiles.getState().activeIdByRoot[fileRoot] === fileId;

    setRestoringRevision(true);
    // #282 follow-up P1: lock the editor read-only for this exact file for
    // the duration of the request (see TiptapEditor's restoringFileId
    // effect) so a keystroke made while waiting on the response can't be
    // silently discarded when applyExternalReload lands.
    useEditorInstance.getState().setRestoringFileId(fileId);
    try {
      // Restoring overwrites the whole document, and the server only ever
      // snapshots what's currently *on disk* as the "before" revision —
      // applyExternalReload below then discards whatever is in the buffer
      // unconditionally. An unsaved edit sitting on top of the last save
      // would otherwise vanish with no trace, contradicting the confirm
      // dialog's "戻す前の内容は新しいリビジョンとして残ります" (codex
      // review, #282 follow-up P1). Flush + autosave first so any pending
      // edit lands on disk — and therefore in that snapshot — before restore
      // runs. Bail out without restoring if the save itself didn't land.
      useEditorInstance.getState().flushPendingMarkdown();
      const saved = await autosave(fileId);
      if (!saved) {
        showToast(
          "未保存の変更を保存できなかったため、復元を中止しました",
          "error"
        );
        return;
      }

      const res = await restoreRevision(filePath, id, fileRoot);
      applyExternalReload(fileId, res.content, res.modified, res.created, res.sha);
      clearChanged(fileRoot, filePath);
      registerSelfWrite(fileRoot, filePath, res.modified);
      showToast(`リビジョン ${id} の内容へ戻しました`, "success");

      // The restore itself always lands (the write above already applied it
      // to the correct file by id, regardless of which tab is active now).
      // Only the diff-view reselection below is tab-scoped UI state, so it's
      // the part that needs the active-tab guard.
      if (!isStillActiveTab()) return;

      // The restore snapshots what was on disk *before* it as a new revision
      // (server-side), so the list just grew by one and `selectedRevId`
      // (the baseline the user restored *from*) may no longer be the most
      // useful thing to show — or, once the reviewRefresh-triggered relist
      // below lands, may not even still resolve to a picker option the user
      // recognizes as "what just happened". Fetch the fresh list here and
      // reselect the newest "meaningful" revision — the same rule
      // handleToggleDiff uses (first revision whose content still differs
      // from what's now on screen) — so the picker always lands on a
      // revision that exists and the diff reads as "what did restoring just
      // change" (#282 follow-up).
      const latestText = stripHint(res.content);
      const rl = await listRevisions(filePath, fileRoot);
      if (!isStillActiveTab()) return;
      const contents: Record<string, string> = { ...revContents };
      const meaningful: RevisionMeta[] = [];
      for (const r of rl.revisions) {
        let content = contents[r.id];
        if (content === undefined) {
          try {
            const rev = await getRevision(filePath, r.id, fileRoot);
            if (!isStillActiveTab()) return;
            content = rev.content;
            contents[r.id] = content;
          } catch {
            continue;
          }
        }
        if (hasChanges(lineDiff(content, latestText))) meaningful.push(r);
      }
      if (!isStillActiveTab()) return;
      setRevisions(rl.revisions);
      setRevContents(contents);
      // Prefer the newest revision that actually differs from the restored
      // content; fall back to the newest revision at all (e.g. restoring
      // happened to land back on content identical to the newest snapshot)
      // so the picker is never left pointing at nothing.
      const reselected = meaningful[0] ?? rl.revisions[0];
      if (reselected) {
        setSelectedRevId(reselected.id);
        setDiffBaseText(contents[reselected.id] ?? "");
      } else {
        setSelectedRevId(null);
        setDiffBaseText("");
      }

      setReviewRefresh((n) => n + 1);
    } catch (err) {
      showToast(
        `この版への復元に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    } finally {
      setRestoringRevision(false);
      useEditorInstance.getState().setRestoringFileId(null);
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
  // memoized (#265 follow-up): lineDiff is an O(n·m) LCS over every line of
  // the document, run once per revision. Unmemoized, this reran on *every*
  // EditorPage render — not just on save — because nothing here changes
  // only when `revisions`/`revContents`/`diffLatestText` actually change.
  // On a multi-thousand-line document (a real meeting transcript, not the
  // small synthetic fixtures this went unnoticed with) that is a 1000ms+
  // stall per render, and dwarfed the TiptapEditor onUpdate debounce this
  // issue otherwise fixed: typing still re-renders EditorPage (e.g. the
  // isDirty flip), so debouncing the *editor's* update doesn't touch this
  // page-level cost. See also diffLatestText / diffGutterPayload above,
  // which already avoid this by memoizing.
  const meaningfulRevisions = useMemo(
    () =>
      revisions.filter((r) => {
        const c = revContents[r.id];
        return c !== undefined && hasChanges(lineDiff(c, diffLatestText));
      }),
    [revisions, revContents, diffLatestText]
  );

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
      ? computeDisplayVersion(revisions, newestRevisionContent, diffLatestText)
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
  // Repeated `open=<rel>` params (#289): extra files to open as background
  // tabs alongside the path-addressed main file. Read once on mount, same
  // as the two refs above — later URL changes (tab-sync effect, sidebar
  // filter edits) must not re-trigger this.
  const initialExtraPathsRef = useRef(searchParams.getAll(OPEN_PARAM));

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

  // The composer, and what it will write. Anchored beside its target like the
  // thread is (#252) — a new comment no longer opens a modal over the document.
  const [composer, setComposer] = useState<{
    mode: ComposerMode;
    /** Quoted target text. Empty in "global" mode. */
    snippet: string;
    /** What the popover hangs off: the selection, or the button pressed. */
    rect: DOMRect;
    /**
     * The editor selection captured when the composer opened (anchored mode).
     * Held so the anchor is computed against the exact range the user picked,
     * even once focus moves into the composer.
     */
    range?: { from: number; to: number };
    /** Set in "edit" mode: the comment whose body is being rewritten. */
    editingId?: string;
  } | null>(null);
  const [composerDraft, setComposerDraft] = useState("");
  const composerRef = useRef<typeof composer>(null);
  const composerDraftRef = useRef("");

  const closeComposer = () => {
    setComposer(null);
    setComposerDraft("");
  };

  // Whether a pointer gesture in the editor is still in progress — the
  // selection bubble stays hidden until the drag ends.
  const pointerIsDown = useRef(false);

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
  // "コメント追加" menu to. Hover is the *only* trigger, and the only entry
  // this menu still has is a live (non-empty) selection — a highlight click
  // always selects that comment's rail card directly (#304 removed the
  // hover-preview / click-to-open-popover path this used to also serve).
  const [hoverTarget, setHoverTarget] = useState<{
    canAdd: boolean;
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null>(null);

  useEffect(() => {
    composerRef.current = composer;
    composerDraftRef.current = composerDraft;
  }, [composer, composerDraft]);

  // The comment card the pane highlights as selected: a highlight click, a
  // pane row click, a deep link, or the jump-to-comment path all land here
  // (#304 — the pane is always open, so there is no popover to open instead).
  const [railSelectedId, setRailSelectedId] = useState<string | null>(null);

  // Viewport top (px) of each anchored comment's first decoration, keyed by
  // comment id — what the rail's paragraph-aligned layout positions cards
  // against (#298). Comments with no live anchor (global/orphan) never get an
  // entry and stay in the pane's pinned section.
  const [anchorTops, setAnchorTops] = useState<Record<string, number>>({});
  const anchorRafRef = useRef<number | null>(null);
  const recomputeAnchorTops = () => {
    if (!editor || editor.isDestroyed) return;
    const root = editor.view.dom;
    const next: Record<string, number> = {};
    for (const c of comments) {
      if (c.scope === "global" || c.orphan) continue;
      const el = root.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(c.id)}"]`);
      if (el) next[c.id] = el.getBoundingClientRect().top;
    }
    // Skip the state update (and the render + downstream effects it would
    // trigger) when nothing actually moved — a `transaction` fires on every
    // keystroke/selection change, most of which don't shift any decoration.
    setAnchorTops((prev) => (shallowEqualRecord(prev, next) ? prev : next));
  };
  // #306 root cause: `scheduleAnchorRecalc` coalesces bursts of triggers onto
  // a single rAF via `anchorRafRef` — but the callback closed over
  // `recomputeAnchorTops` at *schedule* time. When `comments` arrives and
  // `editor` mounts within the same rAF window (the common case opening a
  // file with existing comments), the first call schedules the frame while
  // `editor` is still null; every later call in that window (once `editor`
  // is set, `comments` included) sees `anchorRafRef.current` already
  // occupied and no-ops. The one frame that does run reads the *stale*
  // closure — `editor` still null, or `comments` still `[]` — finds nothing,
  // and nothing else ever re-triggers a recompute on an untouched file (no
  // edit/scroll/resize). Routing the callback through a ref that is kept
  // current every render (like `scheduleAnchorRecalcRef` below) means
  // whichever render's request wins the coalescing race, the frame that
  // actually fires always reads the latest `editor`/`comments`.
  const recomputeAnchorTopsRef = useRef(recomputeAnchorTops);
  useEffect(() => {
    recomputeAnchorTopsRef.current = recomputeAnchorTops;
  });
  const scheduleAnchorRecalc = () => {
    if (anchorRafRef.current !== null) return;
    anchorRafRef.current = requestAnimationFrame(() => {
      anchorRafRef.current = null;
      recomputeAnchorTopsRef.current();
    });
  };
  const scheduleAnchorRecalcRef = useRef(scheduleAnchorRecalc);
  useEffect(() => {
    scheduleAnchorRecalcRef.current = scheduleAnchorRecalc;
  });
  // Recompute whenever the decorations could have moved: the comment list
  // changed, the document was edited, the reader scrolled the body, the
  // viewport resized, or the centered-layout width changed. Coalesced onto a
  // single rAF (#298 forbids re-reading every comment's rect per scroll
  // event) rather than firing the DOM read synchronously from each listener.
  useEffect(() => {
    scheduleAnchorRecalcRef.current();
  }, [comments, editor, centered]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onUpdate = () => scheduleAnchorRecalcRef.current();
    editor.on("transaction", onUpdate);
    return () => {
      if (editor.isDestroyed) return;
      editor.off("transaction", onUpdate);
    };
  }, [editor]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onScrollOrResize = () => scheduleAnchorRecalcRef.current();
    // The nearest scrollable ancestor of the ProseMirror DOM node is
    // TiptapEditor's actual scroll container (`overflow-y: auto`) — but it
    // isn't a fixed number of hops up (plain non-scrolling wrapper divs sit
    // in between, and centered-layout toggles swap which wrapper ends up
    // scrolling), so it's found by walking up rather than assumed to be
    // `parentElement`. Listening there instead of capturing every `scroll`
    // in the document keeps this from re-running on unrelated scrolling
    // elsewhere in the app (menus, listboxes, ...).
    const scrollEl = findScrollableAncestor(editor.view.dom);
    scrollEl?.addEventListener("scroll", onScrollOrResize);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      scrollEl?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [editor, centered]);
  useEffect(() => {
    return () => {
      if (anchorRafRef.current !== null) cancelAnimationFrame(anchorRafRef.current);
    };
  }, []);

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
      let pos: { pos: number } | null = null;
      try {
        pos = editor.view.posAtCoords({ left: ev.clientX, top: ev.clientY });
      } catch {
        pos = null; // no layout (jsdom) — fall back to the DOM below
      }
      const { from, to, empty } = editor.state.selection;
      const canAdd =
        !empty && from !== to && !!pos && pos.pos >= from && pos.pos <= to;
      if (!canAdd) return null;
      return {
        canAdd,
        top: ev.clientY,
        left: ev.clientX,
        bottom: ev.clientY,
        right: ev.clientX,
      };
    };

    const update = (ev: MouseEvent) => {
      const next = targetAt(ev);
      const key = next ? `${next.canAdd}` : null;
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

    // Clicking a highlight selects its card in the rail (#304: the pane is
    // always open, so there is no popover to fall back to). The id comes
    // from the decoration set first for the same reason the hover path does
    // it: nested highlights merge into one span whose attribute keeps a
    // single id.
    const selectAt = (el: HTMLElement, pos: number | null) => {
      const commentId =
        (pos !== null ? commentIdsInRange(editor.state, pos, pos + 1)[0] : undefined) ??
        el.getAttribute("data-comment-id") ??
        undefined;
      if (!commentId) return;
      clearTimers();
      setRailSelectedId(commentId);
    };

    const onClick = (e: Event) => {
      const ev = e as MouseEvent;
      const el = (ev.target as HTMLElement | null)?.closest?.(
        "[data-comment-id]"
      ) as HTMLElement | null;
      if (!el) return;
      let pos: number | null = null;
      try {
        pos = editor.view.posAtCoords({ left: ev.clientX, top: ev.clientY })?.pos ?? null;
      } catch {
        pos = null; // no layout (jsdom) — the attribute below is enough
      }
      selectAt(el, pos);
    };

    const onKeyDown = (e: Event) => {
      const ev = e as KeyboardEvent;
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const el = (ev.target as HTMLElement | null)?.closest?.(
        "[data-comment-id]"
      ) as HTMLElement | null;
      if (!el) return;
      ev.preventDefault();
      selectAt(el, null);
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
      dom.addEventListener("click", onClick);
      dom.addEventListener("keydown", onKeyDown);
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
      dom?.removeEventListener("click", onClick);
      dom?.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);

  // Mark the selected card's highlight so it's obvious which one a paragraph
  // carrying several comments is being read against (#304: this used to
  // track the open thread popover; there is no popover anymore, so it
  // tracks the rail's own selection instead).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setActiveComment(railSelectedId);
  }, [editor, railSelectedId]);

  // Cancelling asks before throwing away a body, and never asks when there is
  // nothing to lose. In "edit" the baseline is the stored body, so closing an
  // untouched edit is silent.
  const requestCloseComposer = async () => {
    const seed =
      composer?.mode === "edit"
        ? (comments.find((c) => c.id === composer.editingId)?.body ?? "")
        : "";
    if (composerDraft.trim() === seed.trim()) {
      closeComposer();
      return;
    }
    const ok = await confirm({
      title: "コメントを破棄しますか？",
      message: "入力中のコメントは保存されません。",
      confirmLabel: "破棄する",
      cancelLabel: "編集を続ける",
    });
    if (ok) closeComposer();
  };
  const requestCloseComposerRef = useRef(requestCloseComposer);
  useEffect(() => {
    requestCloseComposerRef.current = requestCloseComposer;
  });

  // Same dismissal contract as the thread (#251): a click outside is ignored
  // while there is unsent text, and Esc asks before discarding it.
  useEffect(() => {
    if (!composer) return;

    const onDocMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-testid="comment-composer-popover"]')) return;
      // Confirm dialogs and tooltips render in portals of their own.
      if (el?.closest?.('[role="dialog"], [role="tooltip"]')) return;
      if (composerDraftRef.current.trim()) {
        showToast("入力中のコメントがあります。Esc で破棄できます", "info");
        return;
      }
      closeComposer();
    };

    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      void requestCloseComposerRef.current();
    };

    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onDocKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer]);

  // The composer belongs to one file: switching tabs leaves it anchored to a
  // rect in a layout that is gone, and a rail selection from the previous
  // file has nothing to mean here either. Keyed on the path rather than on
  // review state — adding the first comment to a draft *ingests* it, and
  // closing on that transition would shut the composer the ingest just
  // opened.
  useEffect(() => {
    // Synchronous on purpose: it has to go in the same commit as the switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    closeComposer();
    setRailSelectedId(null);
  }, [activePath]);

  // Review state is deliberately *not* a trigger. Adding the first comment to
  // a draft ingests the file, so the state flips while the composer is opening
  // — closing on it shut the composer that same click. A thread whose comment
  // disappears is already handled where the comment is looked up.

  const handleSelect = async (path: string) => {
    if (!activeRoot) return;
    // Flush the debounced Markdown resync (#265) before reading `isDirty` /
    // deciding whether to prompt to discard — a switch fired within the
    // debounce window must not race the resync it triggers.
    useEditorInstance.getState().flushPendingMarkdown();
    // Autosave the outgoing buffer first (#280), so the discard prompt below
    // only fires for a buffer autosave actually refused to write (an
    // un-reconciled external change) rather than for ordinary unsaved edits.
    const outgoingId = useOpenFiles.getState().activeIdByRoot[activeRoot];
    if (outgoingId) await autosave(outgoingId);
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

  // Opens `path` as a background tab (#289's `?open=`) without activating
  // it. Deliberately doesn't reuse handleSelect: handleSelect always makes
  // its target the active tab, and briefly activating every background
  // path in turn (then activating the main path again once done) used to
  // route each one through the single shared TiptapEditor instance — which
  // raced its post-load settle window and debounced Markdown resync
  // (#265) and left the last one activated-then-deactivated spuriously
  // dirty. A background tab never needs its content in the editor until
  // the user actually clicks it, so this only ever touches `files`, never
  // `activeIdByRoot`.
  const handleOpenInBackground = async (path: string) => {
    if (!activeRoot) return;
    const requestRoot = activeRoot;
    const alreadyOpen = useOpenFiles
      .getState()
      .files.some((f) => f.root === requestRoot && f.path === path);
    if (alreadyOpen) return;
    try {
      const res = await readFile.mutateAsync({ path, root: requestRoot });
      // Lightweight guard (#289 follow-up 3): if the user switched root
      // while this read was in flight, activeRootRef has already moved on
      // — writing the response under requestRoot now would add a tab to a
      // root the page isn't even showing anymore, and the error branch
      // below would toast a failure onto whatever root *is* now showing.
      // Not a full cancellation (no AbortController on the request itself,
      // no signal threaded into useReadFile) — deferred, see the deeplink
      // effect's own comment.
      if (activeRootRef.current !== requestRoot) return;
      openServerFile(
        {
          name: basename(res.path),
          path: res.path,
          root: requestRoot,
          markdown: res.content,
          modified: res.modified,
          created: res.created,
          sha: res.sha,
        },
        { activate: false }
      );
    } catch (err) {
      if (activeRootRef.current !== requestRoot) return;
      // Fail-soft (issue #289): one unreadable extra path must not stop the
      // others, same contract as handleSelect's own read failure.
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
    // See handleSelect (#265).
    useEditorInstance.getState().flushPendingMarkdown();
    const outgoingId = useOpenFiles.getState().activeIdByRoot[activeRoot];
    // Fire-and-forget (#280): no prompt hangs off this path, so there is
    // nothing to await before switching.
    if (outgoingId && outgoingId !== v) void autosave(outgoingId);
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
    const extras = initialExtraPathsRef.current;
    initialExtraPathsRef.current = [];
    const expandingRoot = activeRoot;
    void (async () => {
      await handleSelect(path);
      // Sequential, not parallel: keeps read failures/toasts in a
      // predictable order and avoids piling concurrent calls onto the one
      // readFile mutation instance. Each extra is opened in the background
      // (handleOpenInBackground) rather than activated, so — unlike an
      // activate-then-deactivate loop — nothing here ever changes which
      // file is active; `path` stays active throughout.
      for (const extra of extras) {
        // Lightweight guard (#289 follow-up 3): the user switched root
        // while an earlier extra's read was still in flight. Stop opening
        // further extras under a root the page has already left — a full
        // cancellation (AbortController threaded through useReadFile,
        // StrictMode-safe cleanup of this ref-driven effect) is a bigger
        // redesign than this deeplink-expansion race warrants; deferred
        // (tracked outside this codebase, not as a code TODO).
        if (activeRootRef.current !== expandingRoot) break;
        if (extra === path) continue; // already open (and active) from above
        await handleOpenInBackground(extra);
      }
    })();
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
      // #310: `scrollIntoView`'s vertical centering doesn't reliably pull a
      // highlight out from a wide table's own horizontal scroll region
      // (#152) — bring it inside that container's visible width too.
      scrollTableIntoView(decorated[0]);
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
    if (target) scrollTableIntoView(target);
    editor.commands.flashCommentRanges(ranges);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      if (!editor || editor.isDestroyed) return;
      editor.commands.clearCommentFlash();
    }, 1600);
  };

  /**
   * Open a comment from the list (#253): scroll to it, flash its highlight,
   * and select its card in the rail (#304: the pane is always open, so there
   * is nothing left to "open" beyond that — no popover, and the card itself
   * stays collapsed until the reader expands it). Comments the jump cannot
   * resolve (global, orphan) never reach here; the pane keeps those operable
   * in its own section.
   */
  const handleSelectComment = (id: string) => {
    handleJumpToComment(id);
    setRailSelectedId(id);
  };

  // Deeplink: `?comment_id=<id>` jumps to that comment once the file and comments land.
  useEffect(() => {
    const commentId = initialCommentIdRef.current;
    if (!commentId) return;
    if (!activePath || reviewState !== "review") return;
    if (commentsLoadedForPath !== activePath) return;
    if (!editor || editor.isDestroyed) return;

    initialCommentIdRef.current = null;
    // A shared link exists to show one comment, so open it rather than making
    // the reader hunt for the highlight that just flashed (#253).
    handleSelectComment(commentId);
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

  // Write the active buffer once it has been still for AUTOSAVE_IDLE_MS. The
  // timer restarts on every buffer change, so this fires after typing stops,
  // not on a fixed wall-clock cadence. Edits reach `markdown` through the
  // debounced resync (#265), so the effective delay is that debounce + this.
  const activeFileMarkdown = activeFile?.markdown;
  const activeFileDirty = activeFile?.isDirty ?? false;
  const activeFileIdForSave = activeFile?.id;
  useEffect(() => {
    if (!activeFileIdForSave || !activeFileDirty) return;
    const id = activeFileIdForSave;
    const timer = window.setTimeout(() => {
      void autosave(id);
    }, AUTOSAVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeFileIdForSave, activeFileDirty, activeFileMarkdown, autosave]);


  const handleSave = async () => {
    if (!activeFile) return;
    // The editor's Markdown resync is debounced for perf on large documents
    // (#265) — force it current before reading `markdown` below so a save
    // fired within the debounce window still includes the latest keystroke.
    useEditorInstance.getState().flushPendingMarkdown();
    const activeMarkdown =
      useOpenFiles.getState().files.find((f) => f.id === activeFile.id)?.markdown ??
      activeFile.markdown;
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
        content: activeMarkdown,
        root: activeFile.root,
        ifMatch: activeFile.serverSha,
      });
      markActiveSaved(activeFile.root, res.modified, res.created, res.sha);
      // A save can flip a draft file to review state (auto-ingest), so the
      // revision list backing the diff picker is worth re-reading. The save
      // itself no longer adds a revision (#280).
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
            content: activeMarkdown,
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
    // See handleSave: the debounced resync (#265) may not have caught up
    // with the very latest keystroke yet.
    useEditorInstance.getState().flushPendingMarkdown();
    const activeMarkdown =
      useOpenFiles.getState().files.find((f) => f.id === activeFile.id)?.markdown ??
      activeFile.markdown;
    const raw = stripHint(activeMarkdown);
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
    // Copying this command is the handoff to the AI, so it is also the version
    // boundary (#280). Get the buffer on disk first, then snapshot it: the
    // newest revision is then exactly what the AI is about to read, which
    // makes the diff empty right now and fills it with whatever the human
    // edits next. Saves themselves no longer snapshot — autosave would burn
    // through the 20-revision cap and evict this very baseline.
    useEditorInstance.getState().flushPendingMarkdown();
    const saved = await autosave(activeFile.id);
    if (saved) {
      try {
        const res = await createRevision(activeFile.path, activeFile.root);
        // Only worth re-reading the list when a version actually landed.
        if (res.created) setReviewRefresh((n) => n + 1);
      } catch (err) {
        // The command itself is still valid and still worth copying — the AI
        // reads the file, not the history. Report the missing baseline and
        // carry on.
        showToast(
          `バージョンの記録に失敗しました（コマンドはコピーします）: ${(err as Error).message ?? "unknown error"}`,
          "warning"
        );
      }
    } else {
      // Autosave refused (external change) or failed: the AI would read
      // something other than what is on screen, and a snapshot here would
      // record the wrong baseline. It has already said why in its own toast.
      showToast(
        "未保存の変更があるため、バージョンは記録していません（保存してから再度コピーしてください）",
        "warning"
      );
    }
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

  const openComposer = (
    next: NonNullable<typeof composer>,
    initialDraft = ""
  ) => {
    hoverKey.current = null;
    setHoverTarget(null);
    setComposerDraft(initialDraft);
    setComposer(next);
  };

  const openAnchoredComposer = (rect: DOMRect) => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      showToast("コメントを付ける範囲をエディタで選択してください", "info");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    openComposer({
      mode: "anchored",
      snippet: buildTargetSnippet(selectedText),
      rect,
      range: { from, to },
    });
  };

  const openGlobalComposer = (rect: DOMRect) =>
    openComposer({ mode: "global", snippet: "", rect });

  // A comment implies the file is under review, so adding one silently ingests
  // when needed instead of making the user notice a separate "取り込む" step.
  // The user just sees the composer open normally. Ingest is idempotent.
  const ingestThenOpen = async (open: () => void) => {
    if (await handleIngest()) open();
  };

  const handleAddCommentClick = (rect: DOMRect) => {
    if (!editor) return;
    if (!reviewActive) {
      void ingestThenOpen(() => openAnchoredComposer(rect));
      return;
    }
    openAnchoredComposer(rect);
  };

  const handleAddGlobalClick = (rect: DOMRect) => {
    if (!editor) return;
    if (!reviewActive) {
      void ingestThenOpen(() => openGlobalComposer(rect));
      return;
    }
    openGlobalComposer(rect);
  };

  // The only entry left on this menu is "コメント追加" (#304 removed the
  // hover-preview entry it used to also carry for an existing highlight).
  // Anchored at the pointer, inside the live selection.
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
  const menuCanAdd = !!hoverTarget?.canAdd && canAddComment;
  const menuOpen = !!menuAnchor && menuCanAdd;

  const composerFrame = popoverFrame(composer?.rect ?? null);

  // Submit a new comment to the sidecar. The anchor(s) are derived from the
  // live ProseMirror doc so they resolve identically server-side against the
  // clean canonical body.
  const handleCommentSubmit = async ({ body, scope }: ComposerSubmit) => {
    if (!editor || !activeFile) {
      closeComposer();
      return;
    }
    // "edit" mode rewrites an existing body; the scope was fixed at creation
    // and the dialog emits none.
    const editingId = composer?.editingId;
    if (editingId) {
      try {
        await handleEditComment(editingId, body);
      } finally {
        closeComposer();
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
        const range = composer?.range;
        const anchors = range
          ? computeAnchorsFromSelection(editor.state.doc, range.from, range.to)
          : [];
        if (!range || anchors.length === 0) {
          showToast("選択範囲のアンカーを特定できませんでした", "warning");
          closeComposer();
          return;
        }
        await createComment(
          path,
          { scope: "inline", body, author, date, anchor: anchors[0], anchors: anchors.slice(1) },
          root
        );
        // The selection has done its job. Left standing it covers the very
        // highlight it just produced, and hovering there reads as "pointer is
        // inside a selection" — so the new comment answered with 「コメント追加」
        // instead of showing itself.
        editor.commands.setTextSelection(range.to);
      }
      refreshComments();
    } catch (err) {
      commentErr("コメントの追加", err);
    } finally {
      closeComposer();
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
              onRestoreRevision={(id) => handleRestoreRevision(id)}
              restoring={restoringRevision}
            />
          ) : activeFile ? (
            <TiptapEditor
              comments={comments}
              onDeleteComment={handleDeleteComment}
              onResolveToggleComment={handleResolveToggle}
              onReplyComment={handleReplyComment}
              onEditComment={handleEditComment}
              onEditCommentReply={handleEditReply}
              onDeleteCommentReply={handleDeleteReply}
            />
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
          onSelect={handleSelectComment}
          selectedId={railSelectedId}
          anchorTops={anchorTops}
        />
      </Box>

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
          {/* Resting inside a selection is the only thing left on this menu
              (#304 removed the hover-preview entry it used to carry for an
              existing highlight — that highlight's click now selects its
              rail card directly instead). */}
          <Paper elevation={4} sx={{ p: 0.5, minWidth: 180 }}>
            <Button
              size="small"
              fullWidth
              startIcon={<CommentIcon fontSize="small" />}
              sx={{ justifyContent: "flex-start" }}
              // Keep the selection alive: focusing the button would collapse
              // it in some browsers before the handler reads from/to.
              onMouseDown={(e) => e.preventDefault()}
              // Anchored to the selection's own bubble, so the composer
              // opens where the user was already looking.
              onClick={(e) =>
                handleAddCommentClick(e.currentTarget.getBoundingClientRect())
              }
              data-testid="editor-menu-add-comment"
            >
              コメント追加
            </Button>
          </Paper>
        </Popper>
      )}

      {composer && (
        <Popper
          open
          placement={composerFrame.placement}
          anchorEl={{ getBoundingClientRect: () => composer.rect }}
          modifiers={[
            { name: "offset", options: { offset: [0, 8] } },
            { name: "preventOverflow", options: { padding: 8 } },
          ]}
          sx={{ zIndex: (theme) => theme.zIndex.modal }}
          data-testid="editor-comment-composer"
        >
          <CommentComposerPopover
            mode={composer.mode}
            targetSnippet={composer.snippet}
            maxHeight={composerFrame.maxHeight}
            draft={composerDraft}
            onDraftChange={setComposerDraft}
            onSubmit={handleCommentSubmit}
            onCancel={requestCloseComposer}
          />
        </Popper>
      )}

      <ConfirmDialog />
      <ToastViewport />
    </Box>
  );
}
