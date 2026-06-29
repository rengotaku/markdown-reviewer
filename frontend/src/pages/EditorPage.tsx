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
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
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
  EditCommentDialog,
  CommentSidePane,
  DiffView,
} from "@/components";
import {
  useOpenFiles,
  reattachLegacyFilesToRoot,
} from "@/hooks/useOpenFiles";
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
  type ReviewState,
  type RevisionMeta,
} from "@/api";
import { stripHint } from "@/utils/stripHint";
import { formatLocalTimestamp } from "@/utils/formatTimestamp";
import { generateCommentId } from "@/utils/commentId";
import { nextVersionedPath } from "@/utils/versionedPath";
import { collectHeadings } from "@/utils/headings";
import { collectComments } from "@/utils/collectComments";
import { computeCrossSectionRanges } from "@/utils/crossSectionRanges";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const TARGET_SNIPPET_LENGTH = 60;
const SELECT_FILE_PARAM = "select_file";

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

  const activePath = activeFile?.path;
  const activeFileRoot = activeFile?.root;
  const fileKey = activePath ? `${activeFileRoot ?? ""}:${activePath}` : "";

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
    mode: "anchored" | "block" | "global" | "cross-section";
    snippet: string;
    /**
     * For block-mode submissions only. The text range to apply the
     * scope=block comment to. Captured at the moment the drag-handle menu
     * is invoked so it survives the dialog focus dance.
     */
    blockRange?: { from: number; to: number };
    headings: ReadonlyArray<{
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      pos: number;
    }>;
  }>({ open: false, mode: "anchored", snippet: "", headings: [] });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null
  );
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    id: string;
    scope: string;
    target: string;
    body: string;
  }>({ open: false, id: "", scope: "", target: "", body: "" });
  // Right-click on an existing comment range surfaces this menu.
  const [commentMenu, setCommentMenu] = useState<{
    x: number;
    y: number;
    id: string;
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

  // Right-click handling: two distinct menus share one listener.
  //   1. On an existing comment range → 編集 / 削除 menu (commentMenu state).
  //      Detected via `[data-comment-id]` closest() lookup so it catches both
  //      wrapping marks (inline / block) and standalone nodes (global /
  //      cross-section).
  //   2. On a non-empty selection that isn't on a comment → コメント追加 menu
  //      (contextMenu state).
  // The editor `view` may not be mounted at the moment the editor object
  // lands in the store, so we attach lazily and retry on the "create" event.
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
        const target = (ev.target as HTMLElement | null)?.closest?.(
          "[data-comment-id]"
        ) as HTMLElement | null;
        const commentId = target?.getAttribute("data-comment-id") ?? "";
        if (commentId) {
          ev.preventDefault();
          setCommentMenu({ x: ev.clientX, y: ev.clientY, id: commentId });
          return;
        }
        const sel = editor.state.selection;
        if (sel.empty || sel.from === sel.to) return;
        if (editor.isActive("comment")) return;
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
    const target = state.files.find(
      (f) => f.path === path && f.root === activeRoot
    );

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
    if (empty || from === to) return false;
    return !editor.isActive("comment");
  })();

  const handleAddCommentClick = () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty || from === to) {
      showToast("コメントを付ける範囲をエディタで選択してください", "info");
      return;
    }
    if (editor.isActive("comment")) {
      showToast("コメント内にコメントを追加することはできません", "warning");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    setCommentDialog({
      open: true,
      mode: "anchored",
      snippet: buildTargetSnippet(selectedText),
      headings: [],
    });
  };

  const handleAddGlobalClick = () => {
    if (!editor) return;
    setCommentDialog({
      open: true,
      mode: "global",
      snippet: "",
      headings: [],
    });
  };

  const handleAddCrossSectionClick = () => {
    if (!editor) return;
    const headings = collectHeadings(editor, [1, 2, 3, 4, 5, 6]);
    if (headings.length === 0) {
      showToast(
        "横断コメントを付ける見出しが見つかりません。先に見出しを追加してください。",
        "info"
      );
      return;
    }
    setCommentDialog({
      open: true,
      mode: "cross-section",
      snippet: "",
      headings,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextAddComment = () => {
    closeContextMenu();
    handleAddCommentClick();
  };

  const closeCommentDialog = () =>
    setCommentDialog({
      open: false,
      mode: "anchored",
      snippet: "",
      headings: [],
    });

  const handleCommentSubmit = ({
    body,
    scope,
    selectedHeadings,
  }: {
    body: string;
    scope: "inline" | "block" | "cross-section" | "global";
    selectedHeadings?: ReadonlyArray<{
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
      pos: number;
    }>;
  }) => {
    if (!editor) {
      closeCommentDialog();
      return;
    }
    const id = generateCommentId();
    const date = todayISO();
    const blockRange = commentDialog.blockRange;

    // Capture the cursor position to restore (collapsed) once the chain
    // finishes, so the user isn't left with a highlighted selection after
    // submitting.
    const collapseAt = editor.state.selection.from;

    // Note on focus(): we intentionally don't call .focus() in these chains.
    // Combined with `disableRestoreFocus` on the dialog, this keeps the
    // contenteditable element from receiving DOM focus on submit — the
    // browser scrolls the caret into view on focus, which can yank the
    // viewport to the top if the caret was at doc start.
    if (scope === "global") {
      // Standalone — not anchored to text; appended as a block node.
      editor
        .chain()
        .addStandaloneComment({
          id,
          author,
          date,
          target: "",
          body,
          scope: "global",
        })
        .setTextSelection(collapseAt)
        .run();
    } else if (scope === "cross-section") {
      // For each selected heading, anchor a block-scope marker around the
      // heading's text. All markers share one `groupId` so the side pane can
      // fold them back into a single logical comment, while on-disk each
      // section gets a self-contained block comment that an AI reviewer can
      // read without following references.
      if (!selectedHeadings || selectedHeadings.length === 0) {
        closeCommentDialog();
        return;
      }
      const groupId = id; // reuse the freshly-minted id as the shared group key
      // Resolve heading ranges first, then mutate the doc in reverse document
      // order so positions captured earlier don't shift under us. The range
      // computation is extracted to a pure helper for unit testing — see
      // utils/crossSectionRanges.ts.
      const ranges = computeCrossSectionRanges(
        selectedHeadings,
        (pos) => {
          const node = editor.state.doc.nodeAt(pos);
          return node ? { name: node.type.name, nodeSize: node.nodeSize } : null;
        },
        generateCommentId
      );
      if (ranges.length === 0) {
        closeCommentDialog();
        return;
      }
      let chain = editor.chain();
      for (let i = ranges.length - 1; i >= 0; i--) {
        const r = ranges[i];
        chain = chain
          .setTextSelection({ from: r.from, to: r.to })
          .setComment({
            id: r.id,
            author,
            date,
            body,
            scope: "block",
            groupId,
          });
      }
      // Collapse to the start of the first heading range so the document
      // doesn't end with a multi-section highlighted band.
      chain.setTextSelection(ranges[0].from).run();
    } else if (scope === "block" && blockRange) {
      // Block-scope wrap: apply the comment mark to the entire block's text
      // range captured when the drag-handle menu was opened. The selection
      // may have moved while the dialog was up, so set it explicitly.
      editor
        .chain()
        .setTextSelection({ from: blockRange.from, to: blockRange.to })
        .setComment({ id, author, date, body, scope: "block" })
        .setTextSelection(blockRange.to)
        .run();
    } else {
      // Anchored inline — wraps the current selection.
      editor
        .chain()
        .setComment({ id, author, date, body, scope: "inline" })
        .setTextSelection(collapseAt)
        .run();
    }

    closeCommentDialog();
  };

  const handleDeleteComment = (id: string) => {
    if (!editor) return;
    // Try the wrapping-mark removal first; standalone comments share the same
    // id space, so fall back to node removal if no mark was touched.
    // Same rationale as handleEditCommentSubmit: skip .focus() so the browser
    // doesn't scroll the caret back into view when the dialog/menu closes.
    const removed = editor.chain().unsetCommentById(id).run();
    if (!removed) {
      editor.chain().removeStandaloneCommentById(id).run();
    }
  };

  const handleEditComment = (c: {
    id: string;
    scope: string;
    target: string;
    body: string;
  }) => {
    setEditDialog({
      open: true,
      id: c.id,
      scope: c.scope,
      target: c.target,
      body: c.body,
    });
  };

  const closeCommentMenu = () => setCommentMenu(null);

  // Resolve the right-clicked comment to its current (id, scope, target, body)
  // by walking the doc. Done lazily on menu-action click so we always see the
  // freshest body — the user may have edited it via the side pane in between.
  const lookupComment = (id: string) => {
    if (!editor) return null;
    const all = collectComments(editor);
    // For grouped (cross-section) comments any member id maps back to the
    // same logical row in the side pane; aggregate target across members so
    // the edit dialog shows the full heading list, not just the clicked one.
    const hit = all.find((c) => c.id === id);
    if (!hit) return null;
    if (hit.groupId) {
      const members = all.filter((c) => c.groupId === hit.groupId);
      return {
        id: members[0].id,
        scope: "cross-section",
        target: members.map((m) => m.target).filter(Boolean).join("\n"),
        body: members[0].body,
      };
    }
    return {
      id: hit.id,
      scope: hit.scope,
      target: hit.target,
      body: hit.body,
    };
  };

  const handleCommentMenuEdit = () => {
    if (!commentMenu) return;
    const c = lookupComment(commentMenu.id);
    closeCommentMenu();
    if (!c) return;
    handleEditComment(c);
  };

  const handleCommentMenuDelete = () => {
    if (!commentMenu || !editor) {
      closeCommentMenu();
      return;
    }
    const all = collectComments(editor);
    const hit = all.find((c) => c.id === commentMenu.id);
    closeCommentMenu();
    if (!hit) return;
    // Sweep every grouped member; non-grouped comments collapse to a single id.
    const memberIds = hit.groupId
      ? all.filter((c) => c.groupId === hit.groupId).map((c) => c.id)
      : [hit.id];
    for (const id of memberIds) {
      handleDeleteComment(id);
    }
  };

  const closeEditDialog = () =>
    setEditDialog({ open: false, id: "", scope: "", target: "", body: "" });

  const handleEditCommentSubmit = (body: string) => {
    if (!editor) {
      closeEditDialog();
      return;
    }
    // Deliberately do NOT call .focus() here. TipTap's `scrollIntoView: false`
    // only suppresses ProseMirror's own tr.scrollIntoView(); the underlying
    // view.focus() still moves DOM focus into the contenteditable, and the
    // browser independently scrolls the caret into view. Editing a comment
    // doesn't need editor focus (the doc isn't being typed into), so we just
    // dispatch the mark/node update.
    const updated = editor
      .chain()
      .updateCommentBodyById(editDialog.id, body)
      .run();
    if (!updated) {
      editor
        .chain()
        .updateStandaloneCommentBodyById(editDialog.id, body)
        .run();
    }
    closeEditDialog();
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
              <Tooltip
                title={diffMode ? "差分表示を閉じる" : "前回保存との差分を表示"}
              >
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
          ))}
        </Tabs>

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
            editor={editor}
            onDelete={handleDeleteComment}
            onEdit={handleEditComment}
            onClose={toggleCommentPane}
            canAddComment={canAddComment}
            onAddComment={handleAddCommentClick}
            onAddGlobal={handleAddGlobalClick}
            onAddCrossSection={handleAddCrossSectionClick}
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

      <Menu
        open={!!commentMenu}
        onClose={closeCommentMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          commentMenu ? { top: commentMenu.y, left: commentMenu.x } : undefined
        }
        slotProps={{
          root: {
            "data-testid": "editor-comment-context-menu",
          } as Record<string, unknown>,
        }}
      >
        <MenuItem
          onClick={handleCommentMenuEdit}
          data-testid="ctx-edit-comment"
        >
          <ListItemIcon>
            <EditOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>コメントを編集</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={handleCommentMenuDelete}
          data-testid="ctx-delete-comment"
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>コメントを削除</ListItemText>
        </MenuItem>
      </Menu>

      <AddCommentDialog
        open={commentDialog.open}
        mode={commentDialog.mode}
        targetSnippet={commentDialog.snippet}
        headings={commentDialog.headings}
        onClose={closeCommentDialog}
        onSubmit={handleCommentSubmit}
      />

      <EditCommentDialog
        open={editDialog.open}
        scope={editDialog.scope}
        target={editDialog.target}
        defaultBody={editDialog.body}
        onClose={closeEditDialog}
        onSubmit={handleEditCommentSubmit}
      />

      <ConfirmDialog />
      <ToastViewport />
    </Box>
  );
}

