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
import { LinkPreviewCard } from "../LinkPreviewCard";
import { LinkHoverGuard } from "./linkHoverGuard";
import { getEditorMarkdown } from "./markdownSerialize";
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

export function TiptapEditor() {
  const centered = useEditorPrefs((s) => s.centered);
  const { active: activeRoot } = useActiveRoot();
  const activeId = useOpenFiles((s) =>
    activeRoot ? (s.activeIdByRoot[activeRoot] ?? null) : null
  );
  const scrollToTopToken = useEditorInstance((s) => s.scrollToTopToken);
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
   * Timestamp (ms) until which onUpdate should be ignored. setContent's
   * `emitUpdate: false` only suppresses the direct dispatch; extensions like
   * autolink fire follow-up transactions via appendTransaction that re-emit
   * onUpdate. Without this settle window, the post-load extension passes mark
   * the freshly-opened file dirty even though the user didn't edit. Issue #20.
   */
  const settleUntilRef = useRef(0);
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
    onUpdate: ({ editor: ed }) => {
      if (!activeRoot) return;
      if (!useOpenFiles.getState().activeIdByRoot[activeRoot]) return;
      // Drop updates fired by post-setContent extension transactions
      // (e.g. autolink) so an untouched file isn't flagged dirty.
      if (Date.now() < settleUntilRef.current) return;
      // isDirty must react on every keystroke (unsaved dot, discard-changes
      // confirm) — only the expensive Markdown resync below is debounced
      // (#265). No-ops once already dirty, so this doesn't add a
      // store update (and re-render) per keystroke beyond the first.
      useOpenFiles.getState().markActiveDirty(activeRoot);
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
      // immediately after opening a freshly-loaded file. See issue #20.
      editor.commands.setContent(body, { emitUpdate: false });
      // Open the settle window *before* any further programmatic
      // transactions, not after. setBlankLinesBefore below dispatches
      // synchronously, which runs onUpdate synchronously too — if the
      // window were opened after that call (as it originally was), onUpdate
      // would read the *previous* load's now-expired settleUntilRef, slip
      // past the suppression, and mark a freshly-opened file dirty (#259
      // regression of the #20 fix). Same reasoning applies to any other
      // post-setContent extension transaction (autolink, etc.).
      settleUntilRef.current = Date.now() + 250;
      // Push the blank-line counts markdown-it saw in `body` onto the
      // freshly loaded doc's top-level blocks (#259) — an attribute-only,
      // addToHistory:false transaction (BlankLines.ts), so it rides along
      // in the settle window opened above, same as setContent itself.
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
