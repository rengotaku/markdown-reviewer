import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { useEditorPrefs } from "@/hooks/useEditorPrefs";
import { splitPreamble, parseFrontmatter } from "@/utils/frontmatter";
import { resolveInternalLink } from "@/utils/internalLink";
import { FrontmatterTable } from "./FrontmatterTable";
import { DocumentTopComments } from "../DocumentTopComments";
import type { CommentJSON } from "@/api";
import { TableMenu } from "./toolbar/TableMenu";
import { BlockCopyButton } from "./toolbar/BlockCopyButton";
import { SlashCommand } from "./extensions/SlashCommand";
import { MermaidBlock } from "./extensions/MermaidBlock";
import { createCodeLowlight } from "./extensions/codeHighlight";
import { MarkdownPaste } from "./extensions/MarkdownPaste";
import { CommentHighlight } from "./extensions/CommentHighlight";
import { DiffGutter } from "./extensions/DiffGutter";
import { LineNumberGutter } from "./extensions/LineNumberGutter";
import { BlankLines } from "./extensions/BlankLines";
import { ExternalLinkDecoration } from "./extensions/ExternalLinkDecoration";
import { MarkdownLink } from "./extensions/MarkdownLink";
import { IndentKeymap } from "./extensions/IndentKeymap";
import { LinkPreviewCard } from "../LinkPreviewCard";
import { LinkHoverGuard } from "./linkHoverGuard";
import { getEditorMarkdown } from "./markdownSerialize";
import { PROGRAMMATIC_TRANSACTION_META } from "./programmaticTransaction";
import { computeBlankLines } from "@/utils/blankLines";
import "./styles/editor.css";

/** Hover delay (ms) before an internal link's preview card opens (#213). */
const LINK_PREVIEW_HOVER_DELAY_MS = 300;
/** Grace period (ms) after the pointer leaves both the link and the card
 *  before the preview card actually closes (#215). */
const LINK_PREVIEW_CLOSE_GRACE_MS = 250;

/**
 * Debounce window (ms) between the last keystroke and re-serializing the
 * whole document to Markdown (#265). getEditorMarkdown() walks every
 * top-level block and re-runs tiptap-markdown's serializer on each one --
 * on a document with thousands of blocks that single call dominates
 * onUpdate (measured ~140ms/keystroke on a 2,600-block doc vs ~10ms with
 * the resync skipped). isDirty is set synchronously in onUpdate regardless
 * (see markActiveDirty) so the unsaved indicator and discard-changes
 * prompts never lag; only the exported `markdown` string is debounced.
 * Save / tab-switch / tab-close / page-unload all flush synchronously
 * first (see flushPendingMarkdown below) so nothing is ever lost.
 */
const MARKDOWN_SYNC_DEBOUNCE_MS = 250;

// Built once per module: registering the grammars is pure setup and the
// instance is stateless across editors.
const codeLowlight = createCodeLowlight();

/**
 * Re-run the decoration passes that the per-keystroke path only maps through
 * the change rather than recomputing (#270): comment-anchor resolution and the
 * external-link scan. Called from the same 250ms debounce that re-serializes
 * the Markdown, so both settle one typing pause after the last keystroke.
 */
function resyncDecorations(ed: Editor): void {
  if (ed.isDestroyed) return;
  ed.commands.resyncCommentHighlights();
  ed.commands.resyncLinkDecorations();
}

export interface TiptapEditorProps {
  /** Full comment list for the active file (all scopes). Only the
   *  global-scope / orphan subset is rendered here, at the top of the
   *  document body (#309) — anchored comments stay in the side pane's rail. */
  comments?: ReadonlyArray<CommentJSON>;
  onDeleteComment?: (id: string) => void;
  onResolveToggleComment?: (id: string, next: "open" | "resolved") => void;
  onReplyComment?: (id: string, body: string) => void;
  onEditComment?: (id: string, body: string) => void;
  onEditCommentReply?: (id: string, index: number, body: string) => void;
  onDeleteCommentReply?: (id: string, index: number) => void;
}

// Default no-op handlers used when TiptapEditor is mounted without the
// comment props (e.g. existing tests that render `<TiptapEditor />` bare).
// A single untyped no-op cast to each shape avoids unused-parameter lint
// noise from naming parameters no implementation ever reads.
const NOOP_ANY = (() => {}) as unknown;
const NOOP = NOOP_ANY as () => void;
const NOOP_STRING = NOOP_ANY as (id: string, body: string) => void;
const NOOP_INDEXED = NOOP_ANY as (id: string, index: number, body: string) => void;
const NOOP_DELETE_REPLY = NOOP_ANY as (id: string, index: number) => void;
const NOOP_RESOLVE = NOOP_ANY as (id: string, next: "open" | "resolved") => void;

export function TiptapEditor({
  comments = [],
  onDeleteComment = NOOP,
  onResolveToggleComment = NOOP_RESOLVE,
  onReplyComment = NOOP_STRING,
  onEditComment = NOOP_STRING,
  onEditCommentReply = NOOP_INDEXED,
  onDeleteCommentReply = NOOP_DELETE_REPLY,
}: TiptapEditorProps = {}) {
  const centered = useEditorPrefs((s) => s.centered);
  const { active: activeRoot } = useActiveRoot();
  const activeId = useOpenFiles((s) =>
    activeRoot ? (s.activeIdByRoot[activeRoot] ?? null) : null
  );
  const scrollToTopToken = useEditorInstance((s) => s.scrollToTopToken);
  // #282 follow-up P1: read-only while this exact tab's content is being
  // rewritten by an in-flight restore-to-this-version request, so a
  // keystroke made while waiting on the response can't be silently
  // discarded when applyExternalReload lands.
  const restoringFileId = useEditorInstance((s) => s.restoringFileId);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeReloadToken = useOpenFiles((s) => {
    const id = activeRoot ? s.activeIdByRoot[activeRoot] : null;
    const file = id ? s.files.find((f) => f.id === id) : undefined;
    return file ? file.reloadToken : 0;
  });
  const updateActiveMarkdown = useOpenFiles((s) => s.updateActiveMarkdown);
  const activeMarkdown = useOpenFiles((s) => {
    const id = activeRoot ? s.activeIdByRoot[activeRoot] : null;
    const file = id ? s.files.find((f) => f.id === id) : undefined;
    return file ? file.markdown : "";
  });
  // Root-relative path of the file currently open — the base against which
  // in-app link hrefs are resolved (#213).
  const activeFilePath = useOpenFiles((s) => {
    const id = activeRoot ? s.activeIdByRoot[activeRoot] : null;
    const file = id ? s.files.find((f) => f.id === id) : undefined;
    return file ? file.path : "";
  });
  const requestOpenPath = useEditorInstance((s) => s.requestOpenPath);
  const frontmatter = useMemo(
    () => parseFrontmatter(splitPreamble(activeMarkdown).frontmatterYaml),
    [activeMarkdown]
  );
  const lastLoadedKeyRef = useRef<string | null>(null);
  // Track the editor instance that recorded `lastLoadedKeyRef`. If TipTap
  // hands us a fresh editor (StrictMode dev unmount-remount, HMR, etc.) the
  // stale key would make us skip setContent on the new instance and the
  // user would see an empty editor until they switched tabs. Reset the
  // tracking ref when the editor identity changes.
  const lastLoadedEditorRef = useRef<unknown>(null);
  /**
   * The active file's non-editable preamble (AI hint + YAML frontmatter). It is
   * stripped before the body is loaded into the editor, then re-prepended to
   * the editor's markdown output so saving never drops or reorders it. Kept in
   * a ref so onUpdate can read the latest value without re-subscribing.
   */
  const preambleRef = useRef("");
  /**
   * Whether the file as loaded from disk ended with a trailing newline.
   * tiptap-markdown's serializer never emits one, so without re-appending it
   * the flushed Markdown differs from `savedMarkdown` for essentially every
   * file on disk — which marked untouched files dirty and popped the
   * "unsaved changes" dialog on the next tab switch (and silently dropped
   * the final newline on save).
   */
  const trailingNewlineRef = useRef(false);
  /**
   * Editor body serialized back to the file's on-disk shape: preamble
   * re-attached and the trailing newline restored when the loaded file had
   * one.
   */
  const composeMarkdown = useCallback((ed: Editor): string => {
    const text = preambleRef.current + getEditorMarkdown(ed);
    if (trailingNewlineRef.current && !text.endsWith("\n")) return text + "\n";
    return text;
  }, []);

  /**
   * Latest `activeRoot`, mirrored into a ref so the debounced flush (fired
   * from a setTimeout, or invoked by EditorPage well after this render)
   * always targets the file that was actually being edited rather than a
   * value captured by a stale closure (#265).
   */
  const activeRootRef = useRef(activeRoot);
  useEffect(() => {
    activeRootRef.current = activeRoot;
  }, [activeRoot]);
  /** Pending debounced Markdown resync, if any (#265). */
  const pendingSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      // codeBlock comes from CodeBlockLowlight instead of StarterKit (#198):
      // same node name and markdown round-trip, plus per-token spans that the
      // stylesheet colours. Registering it twice would throw on duplicate node
      // names, hence the StarterKit opt-out.
      StarterKit.configure({ link: false, codeBlock: false }),
      // Tab inside code blocks + indent-preserving Backspace on emptied list
      // items (#278). Registered with a higher priority than StarterKit so
      // its Backspace handler runs before the default list keymap.
      IndentKeymap,
      CodeBlockLowlight.configure({ lowlight: codeLowlight }),
      Placeholder.configure({
        placeholder: "Start writing, or type / for commands...",
      }),
      MarkdownLink.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
      }),
      Markdown.configure({
        // Render a bare `https://…` in the source as a link (#274). Round-trip
        // safety for that is MarkdownLink's job.
        linkify: true,
        transformPastedText: true,
        transformCopiedText: false,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      SlashCommand,
      MermaidBlock,
      MarkdownPaste,
      CommentHighlight,
      DiffGutter,
      LineNumberGutter,
      BlankLines,
      ExternalLinkDecoration,
    ],
    content: "",
    editable: true,
    onUpdate: ({ editor: ed, transaction, appendedTransactions }) => {
      if (!activeRoot) return;
      if (!useOpenFiles.getState().activeIdByRoot[activeRoot]) return;
      // A genuine user edit is any transaction that actually changed the
      // document and isn't one WE dispatched ourselves (#293). This is
      // deliberately the inverse of an earlier version of this fix, which
      // enumerated the DOM events / commands that count as "the user
      // edited" — codex review found three input paths (first paste, a
      // task-item checkbox, StarterKit's built-in keymap) that bypassed
      // that list and silently lost the edit. Checking `docChanged`
      // instead covers every current and future input path automatically;
      // the only thing that has to stay accurate is the (small, grep-able)
      // set of places that mark their own transactions as programmatic —
      // see programmaticTransaction.ts.
      //
      // `transaction` (the root tr for this dispatch) is checked directly;
      // `appendedTransactions` covers extensions' appendTransaction passes
      // (e.g. autolink) riding along on the same dispatch.
      const isGenuineEdit = (tr: typeof transaction) =>
        tr.docChanged && !tr.getMeta(PROGRAMMATIC_TRANSACTION_META);
      if (!isGenuineEdit(transaction) && !appendedTransactions.some(isGenuineEdit)) {
        return;
      }
      // isDirty must react on every keystroke (unsaved dot, discard-changes
      // confirm) — only the expensive Markdown resync below is debounced
      // (#265). No-ops once already dirty, so this doesn't add a
      // store update (and re-render) per keystroke beyond the first.
      useOpenFiles.getState().markActiveDirty(activeRoot);
      // Layer 2 (EditorPage's autosave) checks this independently of
      // `isDirty` (#293) — set alongside it, from the same genuine-edit
      // determination above, not from a separately maintained flag.
      const editedId = useOpenFiles.getState().activeIdByRoot[activeRoot];
      if (editedId) useOpenFiles.getState().markFileUserEdited(editedId);
      if (pendingSyncTimeoutRef.current !== null) {
        clearTimeout(pendingSyncTimeoutRef.current);
      }
      pendingSyncTimeoutRef.current = setTimeout(() => {
        pendingSyncTimeoutRef.current = null;
        // Re-attach the stripped preamble (AI hint + frontmatter) so the
        // saved markdown matches what was loaded and frontmatter is never
        // lost. `ed` (not the possibly-stale `editor` from the outer
        // closure) is used deliberately: it is the exact editor instance
        // this onUpdate fired for.
        const root = activeRootRef.current;
        if (!root) return;
        if (!useOpenFiles.getState().activeIdByRoot[root]) return;
        updateActiveMarkdown(root, composeMarkdown(ed));
        resyncDecorations(ed);
      }, MARKDOWN_SYNC_DEBOUNCE_MS);
    },
  });

  /**
   * Flush a pending debounced Markdown resync into the store immediately
   * (#265). Idempotent / safe to call with nothing pending. Registered on
   * `useEditorInstance` so callers outside this component (EditorPage's
   * save / tab-switch / tab-close handlers) can force the store's
   * `markdown` field current before reading it, and also used locally for
   * the beforeunload/visibilitychange safety net below.
   */
  const flushPendingMarkdown = useCallback(() => {
    // Nothing scheduled means nothing changed since the last resync.
    // Re-serializing anyway rewrote `markdown` on every tab switch / app
    // switch, and any serializer drift from the on-disk text then read as an
    // unsaved change on a file the user never touched.
    if (pendingSyncTimeoutRef.current === null) return;
    clearTimeout(pendingSyncTimeoutRef.current);
    pendingSyncTimeoutRef.current = null;
    if (!editor) return;
    const root = activeRootRef.current;
    if (!root) return;
    if (!useOpenFiles.getState().activeIdByRoot[root]) return;
    updateActiveMarkdown(root, composeMarkdown(editor));
    resyncDecorations(editor);
  }, [editor, updateActiveMarkdown, composeMarkdown]);

  useEffect(() => {
    useEditorInstance.getState().setEditor(editor ?? null);
    useEditorInstance.getState().setFlushPendingMarkdown(flushPendingMarkdown);
    return () => {
      // Flush before tearing the editor down (e.g. StrictMode dev
      // unmount-remount, HMR) so an in-flight debounced edit isn't
      // silently dropped (#265).
      flushPendingMarkdown();
      useEditorInstance.getState().setEditor(null);
      useEditorInstance.getState().setFlushPendingMarkdown(() => {});
      editor?.destroy();
    };
  }, [editor, flushPendingMarkdown]);

  // #282 follow-up P1: lock the editor read-only for exactly as long as
  // this active tab's content is mid-restore. `restoringFileId` is set by
  // EditorPage.handleRestoreRevision for the file it's restoring and
  // cleared once the request settles either way; comparing against
  // `activeId` (not a bare boolean) means switching to an unrelated file
  // while a restore is still in flight elsewhere doesn't lock that one too.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Toggling read-only doesn't change the document (docChanged: false),
    // so the onUpdate gate above already ignores it — emitUpdate: false is
    // still passed to avoid the unconditional "update" emission entirely
    // (#293: editor.setEditable() otherwise emits "update" regardless of
    // whether the doc changed, which used to slip past the old, narrower
    // gate before this fix).
    editor.setEditable(restoringFileId === null || restoringFileId !== activeId, false);
  }, [editor, restoringFileId, activeId]);

  // Safety net for the two ways a debounced edit could otherwise be lost
  // outside of EditorPage's explicit save/tab-switch/tab-close flush calls
  // (#265): the tab losing visibility (backgrounded, OS app-switch) and the
  // page actually unloading (reload, close tab/window, navigate away).
  useEffect(() => {
    const flush = () => flushPendingMarkdown();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [flushPendingMarkdown]);

  useEffect(() => {
    if (!editor) return;
    // A new editor instance must be re-populated even when activeId hasn't
    // changed (so the "loaded key" check below doesn't short-circuit on a
    // blank editor produced by StrictMode dev double-mount).
    if (lastLoadedEditorRef.current !== editor) {
      lastLoadedEditorRef.current = editor;
      lastLoadedKeyRef.current = null;
    }
    const key = activeId ? `${activeId}:${activeReloadToken}` : null;
    if (lastLoadedKeyRef.current === key) return;
    lastLoadedKeyRef.current = key;
    if (!activeId) return;
    const state = useOpenFiles.getState();
    const file = state.files.find((f) => f.id === activeId);
    if (file) {
      // Keep the non-editable preamble (AI hint + YAML frontmatter) out of the
      // editor — it has no schema for frontmatter and mangles `---` on
      // roundtrip. The preamble is surfaced as a read-only table instead and
      // re-prepended on save (see onUpdate).
      const { preamble, body } = splitPreamble(file.markdown);
      preambleRef.current = preamble;
      trailingNewlineRef.current = file.markdown.endsWith("\n");
      // emitUpdate: false → don't fire onUpdate for the programmatic load.
      // TipTap's Markdown roundtrip can produce a slightly normalized string
      // (e.g. trailing newline tweaks) which would otherwise set isDirty=true
      // immediately after opening a freshly-loaded file. See issue #20. Its
      // own `preventUpdate` meta suppresses "update" entirely (checked on
      // the root transaction, ahead of onUpdate's docChanged gate above),
      // so any appended transaction riding along on this same dispatch
      // (autolink, etc.) is suppressed too.
      editor.commands.setContent(body, { emitUpdate: false });
      // Push the blank-line counts markdown-it saw in `body` onto the
      // freshly loaded doc's top-level blocks (#259) — this dispatches as
      // its own transaction (not part of setContent's suppressed batch)
      // and *does* change the document (it inserts empty paragraphs), so
      // it marks itself programmatic via PROGRAMMATIC_TRANSACTION_META
      // (see BlankLines.ts) rather than relying on a time window to be
      // ignored by onUpdate's gate (#293).
      editor.commands.setBlankLinesBefore(computeBlankLines(body));
    }
  }, [editor, activeId, activeReloadToken]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      containerRef.current?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToTopToken]);

  // Preview card state for hovering an internal link (#213, non-modal
  // hover-card follow-up #215). `path`/`anchorEl` are kept separate from
  // `open` so a pending close (e.g. the grace countdown) still shows the
  // last-hovered file's path/anchor rather than blanking early.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState("");
  const [previewAnchorEl, setPreviewAnchorEl] = useState<Element | null>(null);
  // One guard instance per mounted editor: it owns the hover timer, the
  // reopen-suppression state, and the card's hover stay area (see
  // linkHoverGuard.ts for the bugs it fixes).
  const hoverGuardRef = useRef<LinkHoverGuard>(new LinkHoverGuard());

  // Dismiss the preview (any of: Esc, close button, the "Open" button, the
  // close-grace countdown elapsing). Tells the hover guard so hovering back
  // onto the same, still-under-the-pointer anchor doesn't immediately
  // reopen it. Shared by the click-capture handler below and
  // LinkPreviewCard's onClose/onOpen props in the JSX.
  const closePreview = useCallback(() => {
    hoverGuardRef.current.handleClose();
    setPreviewOpen(false);
  }, []);

  // Keep the external-link decoration in sync with whichever file is open —
  // hrefs are resolved relative to it, same basis as the click/hover
  // handlers below (#215 follow-up).
  useEffect(() => {
    if (!editor) return;
    editor.commands.setLinkBasePath(activeFilePath);
  }, [editor, activeFilePath]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const guard = hoverGuardRef.current;

    // Click capture: internal links navigate in-app instead of following
    // the browser's normal anchor behavior. Registered with `capture: true`
    // and calling stopPropagation() so it runs and wins *before* TipTap's
    // Link extension's own bubble-phase click handler (which calls
    // window.open for openOnClick) ever sees the event.
    const onClickCapture = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const resolved = resolveInternalLink(href, activeFilePath);
      if (!resolved) return;
      e.preventDefault();
      e.stopPropagation();
      closePreview();
      requestOpenPath(resolved);
    };

    // Hover preview: start a timer on hovering an internal link's anchor,
    // cancel it if the pointer leaves before it fires. `mouseover`/`mouseout`
    // (rather than `mouseenter`/`mouseleave`, which don't bubble) let one
    // listener on the editor root cover every link without per-anchor
    // listeners that would need re-wiring on every render. The guard
    // refuses to (re)schedule for an anchor that was just closed while
    // still hovered (#213 follow-up).
    const onMouseOver = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const resolved = resolveInternalLink(href, activeFilePath);
      if (!resolved) return;
      guard.handleMouseOver(anchor, LINK_PREVIEW_HOVER_DELAY_MS, () => {
        setPreviewAnchorEl(anchor);
        setPreviewPath(resolved);
        setPreviewOpen(true);
      });
    };
    const onMouseOut = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      // Cancels the pending open timer (before the card has opened). Once
      // the card is open, this also starts the close-grace countdown
      // (#215) — the card stays open as long as the pointer is over either
      // the anchor or the card itself (see linkHoverGuard.ts), so moving
      // toward the card doesn't dismiss it. Also lifts the reopen
      // suppression once the pointer genuinely leaves the anchor it was
      // set for.
      guard.handleMouseOut(anchor, LINK_PREVIEW_CLOSE_GRACE_MS, closePreview);
    };

    dom.addEventListener("click", onClickCapture, { capture: true });
    dom.addEventListener("mouseover", onMouseOver);
    dom.addEventListener("mouseout", onMouseOut);
    return () => {
      dom.removeEventListener("click", onClickCapture, { capture: true });
      dom.removeEventListener("mouseover", onMouseOver);
      dom.removeEventListener("mouseout", onMouseOut);
      guard.dispose();
    };
  }, [editor, activeFilePath, requestOpenPath, closePreview]);

  return (
    <Box
      ref={containerRef}
      className={centered ? "editor-centered" : undefined}
      sx={{
        height: "100%",
        overflow: "auto",
        position: "relative",
        "& .ProseMirror": { minHeight: "100%" },
      }}
    >
      {editor && <TableMenu editor={editor} />}
      {editor && (
        <BlockCopyButton editor={editor} containerRef={containerRef} />
      )}
      <DocumentTopComments
        root={activeRoot ?? undefined}
        filePath={activeFilePath || undefined}
        comments={comments}
        onDelete={onDeleteComment}
        onResolveToggle={onResolveToggleComment}
        onReply={onReplyComment}
        onEdit={onEditComment}
        onEditReply={onEditCommentReply}
        onDeleteReply={onDeleteCommentReply}
      />
      <FrontmatterTable entries={frontmatter} />
      <EditorContent editor={editor} />
      <LinkPreviewCard
        open={previewOpen}
        anchorEl={previewAnchorEl}
        path={previewPath}
        root={activeRoot}
        onClose={closePreview}
        onOpen={(path) => {
          closePreview();
          requestOpenPath(path);
        }}
        onMouseEnter={() => hoverGuardRef.current.handleCardMouseEnter()}
        onMouseLeave={() =>
          hoverGuardRef.current.handleCardMouseLeave(
            LINK_PREVIEW_CLOSE_GRACE_MS,
            closePreview
          )
        }
      />
    </Box>
  );
}
