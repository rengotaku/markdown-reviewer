import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CloseIcon from "@mui/icons-material/Close";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";
import SaveAsIcon from "@mui/icons-material/SaveAs";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import MenuIcon from "@mui/icons-material/Menu";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddCommentIcon from "@mui/icons-material/AddComment";
import CommentIcon from "@mui/icons-material/Comment";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import Chip from "@mui/material/Chip";
import RateReviewIcon from "@mui/icons-material/RateReview";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
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
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { useUIStore } from "@/hooks/useUIStore";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
import { useCommentAuthor } from "@/hooks/useCommentAuthor";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { dirQueryKey } from "@/hooks/useDir";
import { useQueryClient } from "@tanstack/react-query";
import {
  listDir,
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
  type ReviewState,
  type RevisionMeta,
  type CommentJSON,
} from "@/api";
import { stripHint } from "@/utils/stripHint";
import { formatLocalTimestamp } from "@/utils/formatTimestamp";
import { nextVersionedPath } from "@/utils/versionedPath";
import { computeAnchorFromSelection } from "@/utils/pmAnchor";
import type { HighlightComment } from "@/components/tiptap/extensions/CommentHighlight";

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
  const closeFile = useOpenFiles((s) => s.closeFile);
  const closeOthers = useOpenFiles((s) => s.closeOthers);
  const closeToRight = useOpenFiles((s) => s.closeToRight);

  // Right-click tab menu: anchor position + the tab the menu was opened on.
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(
    null
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

  const activePath = activeFile?.path;
  const activeFileRoot = activeFile?.root;
  const keyOf = (root: string | undefined, path: string) => `${root ?? ""}:${path}`;
  const fileKey = activePath ? keyOf(activeFileRoot, activePath) : "";

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
    setComments([]);
  }

  // Fetch review state + revision list for the active file. Degrades to
  // "draft" with no history on any error so the editor stays usable offline /
  // against an older server. setState only happens after an await, so it does
  // not trigger the synchronous-setState-in-effect lint.
  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    void (async () => {
      try {
        const stat = await statFile(activePath, activeFileRoot);
        if (cancelled) return;
        const state = stat.state ?? "draft";
        setReviewState(state);
        markReviewFile(keyOf(activeFileRoot, activePath), state === "review");
        if (state === "review") {
          const rl = await listRevisions(activePath, activeFileRoot);
          if (!cancelled) setRevisions(rl.revisions);
        } else {
          setRevisions([]);
        }
      } catch {
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
  useEffect(() => {
    if (!activePath || reviewState !== "review") return;
    const handle = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setCommentsRefresh((n) => n + 1);
      }
    }, COMMENTS_POLL_MS);
    return () => window.clearInterval(handle);
  }, [activePath, activeFileRoot, reviewState]);

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

  const handleIngest = async () => {
    if (!activeFile) return;
    try {
      const res = await ingestFile(activeFile.path, activeFile.root);
      setReviewState(res.state);
      markReviewFile(keyOf(activeFile.root, activeFile.path), res.state === "review");
      setReviewRefresh((n) => n + 1);
      showToast(`「${activeFile.name}」をレビュー対象に取り込みました`, "success");
    } catch (err) {
      showToast(
        `取り込みに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
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
    // Always (re)open against the most recent revision so the picker starts on
    // "最新", regardless of any earlier selection.
    await loadRevision(revisions[0].id);
    setDiffMode(true);
  };

  // The "latest 正典" side of the diff is the live editor content, with the
  // server-injected AI hint stripped so it lines up with the hint-stripped
  // snapshots.
  const diffLatestText = useMemo(
    () => (activeFile ? stripHint(activeFile.markdown) : ""),
    [activeFile]
  );

  // Migrate any persisted legacy single-root files onto the default root
  // the first time we learn which root that is. Idempotent — subsequent
  // renders with the same root are no-ops.
  useEffect(() => {
    if (roots.length > 0) reattachLegacyFilesToRoot(roots[0].name);
  }, [roots]);

  useFileWatcher();

  const handleRefreshTree = () => {
    void queryClient.invalidateQueries({ queryKey: ["dir"] });
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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
      });
    } catch (err) {
      showToast(
        `ファイルの読み込みに失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
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

  const handleSave = async () => {
    if (!activeFile) return;
    try {
      const res = await writeFile.mutateAsync({
        path: activeFile.path,
        content: activeFile.markdown,
        root: activeFile.root,
      });
      markActiveSaved(activeFile.root, res.modified, res.created);
      // A save snapshots the previous content into history (review state only),
      // so refresh the revision list backing the diff picker.
      setReviewRefresh((n) => n + 1);
      showToast(`「${activeFile.name}」を保存しました`, "success");
    } catch (err) {
      showToast(
        `保存に失敗しました: ${(err as Error).message ?? "unknown error"}`,
        "error"
      );
    }
  };

  const handleSaveAs = async () => {
    if (!activeFile) return;
    const slash = activeFile.path.lastIndexOf("/");
    const dir = slash === -1 ? "" : activeFile.path.slice(0, slash);
    try {
      const siblings = await listDir(dir, activeFile.root);
      const siblingPaths = siblings.entries.map((e) => e.path);
      const newPath = nextVersionedPath(activeFile.path, siblingPaths);
      const res = await writeFile.mutateAsync({
        path: newPath,
        content: activeFile.markdown,
        root: activeFile.root,
      });
      await queryClient.invalidateQueries({
        queryKey: dirQueryKey(activeFile.root, dir),
      });
      openServerFile({
        name: basename(res.path),
        path: res.path,
        root: activeFile.root,
        markdown: res.content,
        modified: res.modified,
        created: res.created,
      });
      showToast(`「${basename(res.path)}」として保存しました`, "success");
    } catch (err) {
      showToast(
        `別名保存に失敗しました: ${(err as Error).message ?? "unknown error"}`,
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

  const handleAddCommentClick = () => {
    if (!editor) return;
    if (!reviewActive) {
      showToast("先にファイルを「取り込む」とコメントを追加できます", "info");
      return;
    }
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

  const handleAddGlobalClick = () => {
    if (!editor) return;
    if (!reviewActive) {
      showToast("先にファイルを「取り込む」とコメントを追加できます", "info");
      return;
    }
    setCommentDialog({ open: true, mode: "global", snippet: "" });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextAddComment = () => {
    closeContextMenu();
    handleAddCommentClick();
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
          component="aside"
          sx={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            sx={{
              pl: 0.5,
              pr: 1.5,
              py: 1,
              minHeight: 48,
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
            <Tooltip title="ファイルツリーを再読み込み">
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
            py: 1,
            minHeight: 48,
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
              alignItems: "baseline",
              gap: 1.5,
              overflow: "hidden",
            }}
          >
            <Typography
              variant="body2"
              sx={{
                flexGrow: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              data-testid="editor-active-path"
            >
              {activeFile ? activeFile.path : "ファイルが選択されていません"}
              {activeFile?.isDirty && " •"}
            </Typography>
            {activeFile && (activeFile.serverCreated || activeFile.serverModified) && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
                data-testid="editor-active-timestamps"
              >
                {activeFile.serverCreated && (
                  <>作成: {formatLocalTimestamp(activeFile.serverCreated)}</>
                )}
                {activeFile.serverCreated && activeFile.serverModified && " · "}
                {activeFile.serverModified && (
                  <>更新: {formatLocalTimestamp(activeFile.serverModified)}</>
                )}
              </Typography>
            )}
          </Box>
          {activeFile && reviewState === "draft" && (
            <Tooltip title="このファイルをレビュー対象に取り込む（履歴・コメント管理を開始）">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<RateReviewIcon />}
                  onClick={handleIngest}
                  data-testid="editor-ingest"
                >
                  取り込む
                </Button>
              </span>
            </Tooltip>
          )}
          {activeFile && reviewState === "review" && (
            <>
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<RateReviewIcon />}
                label="review 中"
                data-testid="editor-review-indicator"
              />
              <Tooltip title={diffMode ? "差分表示を閉じる" : "前回保存との差分を表示"}>
                <span>
                  <Button
                    variant={diffMode ? "contained" : "outlined"}
                    size="small"
                    startIcon={<CompareArrowsIcon />}
                    disabled={revisions.length === 0}
                    onClick={handleToggleDiff}
                    data-testid="editor-diff-toggle"
                  >
                    差分
                  </Button>
                </span>
              </Tooltip>
            </>
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
          <Button
            variant="contained"
            size="small"
            startIcon={<SaveIcon />}
            disabled={!canSave || isSaving}
            onClick={handleSave}
            data-testid="editor-save"
          >
            {isSaving ? "保存中..." : "保存"}
          </Button>
          <Tooltip title="同じディレクトリに .vN.md 形式でバージョニング保存">
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SaveAsIcon />}
                disabled={!canSave || isSaving}
                onClick={handleSaveAs}
                data-testid="editor-save-as"
              >
                別名保存
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/*
         * Tab bar is always rendered even with a single open file, so the user
         * always has a visible target for close / switch and the layout stays
         * stable when a second file is opened.
         */}
        <Tabs
          value={activeFile?.id ?? false}
          onChange={(_, v) => activeRoot && setActive(activeRoot, v as string)}
          variant="scrollable"
          scrollButtons={false}
          sx={{
            minHeight: 36,
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            "& .MuiTab-root": {
              minHeight: 36,
              textTransform: "none",
              py: 0.5,
              px: 1,
              minWidth: 0,
              width: 180,
              maxWidth: 180,
              flex: "0 0 180px",
            },
          }}
          data-testid="editor-tabs"
        >
          {files.map((f) => (
            <Tab
              key={f.id}
              value={f.id}
              data-testid={`editor-tab-${f.path}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ x: e.clientX, y: e.clientY, id: f.id });
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
                  {reviewFiles.has(keyOf(f.root, f.path)) && (
                    <Tooltip title="レビュー中">
                      <RateReviewIcon
                        sx={{ fontSize: 14, color: "success.main", flexShrink: 0 }}
                        data-testid={`editor-tab-review-${f.path}`}
                      />
                    </Tooltip>
                  )}
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
          ))}
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
              revisions={revisions}
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
            canAddComment={canAddComment}
            onAddComment={handleAddCommentClick}
            onAddGlobal={handleAddGlobalClick}
            onDelete={handleDeleteComment}
            onResolveToggle={handleResolveToggle}
            onReply={handleReplyComment}
            onEdit={handleEditComment}
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
        <MenuItem onClick={handleContextAddComment} data-testid="ctx-add-comment">
          <ListItemIcon>
            <AddCommentIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>コメント追加</ListItemText>
        </MenuItem>
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
