import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TiptapEditor } from "./TiptapEditor";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useEditorInstance } from "@/hooks/useEditorInstance";
import { TextSelection } from "@tiptap/pm/state";

const ROOT = "mock-root";
const BODY = "# Title\n\nHello world.\n\n- a\n- b\n";

function renderEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${ROOT}`]}>
        <Routes>
          <Route path="/:root/*" element={<TiptapEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Waits out the post-load settle window that suppresses onUpdate (#20). */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 300));
}

function activeFile() {
  const s = useOpenFiles.getState();
  return s.files.find((f) => f.id === s.activeIdByRoot[ROOT]);
}

describe("TiptapEditor dirty tracking", () => {
  beforeEach(() => {
    // jsdom's Element has no scrollTo; the editor scrolls its container to
    // the top on load.
    Element.prototype.scrollTo = () => {};
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useOpenFiles.getState().openServerFile({
      name: "README.md",
      path: "README.md",
      root: ROOT,
      markdown: BODY,
      modified: "",
      created: "",
      sha: "sha1",
    });
  });

  afterEach(() => cleanup());

  // Regression: flushing with nothing pending used to re-serialize the doc on
  // every tab switch / app switch, and tiptap-markdown drops the file's
  // trailing newline — so the rewritten markdown differed from savedMarkdown
  // and an untouched file was flagged dirty ("未保存の変更があります" on the
  // next switch).
  it("keeps an untouched file clean across a flush", async () => {
    renderEditor();
    await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
    await settle();

    useEditorInstance.getState().flushPendingMarkdown();

    expect(activeFile()?.isDirty).toBe(false);
    expect(activeFile()?.markdown).toBe(BODY);
  });

  // The flush is a no-op when no resync is scheduled: with nothing edited
  // there is nothing to serialize, so the store's markdown must be left
  // exactly as it is rather than overwritten with a fresh serialization.
  it("does not rewrite markdown when no resync is pending", async () => {
    renderEditor();
    await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
    await settle();

    const sentinel = `${BODY}\nsentinel\n`;
    useOpenFiles.getState().updateActiveMarkdown(ROOT, sentinel);

    useEditorInstance.getState().flushPendingMarkdown();

    expect(activeFile()?.markdown).toBe(sentinel);
  });

  it("goes clean again when an edit is undone", async () => {
    renderEditor();
    await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
    await settle();

    const editor = useEditorInstance.getState().editor!;
    // insertContentAt is a normal docChanged transaction, so the
    // onUpdate gate treats it as a genuine edit exactly like it would a
    // real keystroke (#293).
    editor.commands.insertContentAt(editor.state.doc.content.size, " more");
    useEditorInstance.getState().flushPendingMarkdown();
    await waitFor(() => expect(activeFile()?.isDirty).toBe(true));

    editor.commands.undo();
    useEditorInstance.getState().flushPendingMarkdown();

    await waitFor(() => expect(activeFile()?.markdown).toBe(BODY));
    expect(activeFile()?.isDirty).toBe(false);
  });

  it("preserves the trailing newline when the user does edit", async () => {
    renderEditor();
    await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());

    await settle();
    const editor = useEditorInstance.getState().editor!;
    editor.commands.insertContentAt(editor.state.doc.content.size, " more");
    useEditorInstance.getState().flushPendingMarkdown();

    await waitFor(() => expect(activeFile()?.isDirty).toBe(true));
    expect(activeFile()?.markdown.endsWith("\n")).toBe(true);
  });

  // #293: opening a file with markdown the schema can't round-trip losslessly
  // (a raw-HTML-looking inline tag, a `>` that gets entity-escaped) must not
  // by itself mark the file dirty, however long it sits open — the editor
  // used to fire onUpdate from editor.setEditable()'s unconditional "update"
  // emission (well before any settle window even opens on the very first
  // render), autosave then wrote the lossy re-serialization over the
  // canonical file with no edit ever having happened.
  describe("does not touch a file that was only opened, never edited (#293)", () => {
    const LOSSY_BODY =
      "# RT\n\n- topic.<name> を参照しました\n- スコア階層: exact > 連結\n";

    beforeEach(() => {
      useOpenFiles.setState({ files: [], activeIdByRoot: {} });
      useOpenFiles.getState().openServerFile({
        name: "lossy.md",
        path: "lossy.md",
        root: ROOT,
        markdown: LOSSY_BODY,
        modified: "",
        created: "",
        sha: "sha-lossy",
      });
    });

    it("stays clean and untouched well past the settle window and the markdown debounce", async () => {
      renderEditor();
      await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());

      // Long past both the 250ms post-load settle window and the 250ms
      // markdown-resync debounce — the old bug depended on neither, so this
      // must not depend on timing either.
      await new Promise((r) => setTimeout(r, 1500));

      expect(activeFile()?.isDirty).toBe(false);
      expect(activeFile()?.userEdited).toBe(false);
      // The store's `markdown` (what autosave would write) must still be
      // the exact bytes that were loaded — not the round-tripped,
      // information-losing re-serialization.
      expect(activeFile()?.markdown).toBe(LOSSY_BODY);
    });
  });

  // codex review (round 1, all 3 observations "must fix"): an earlier version
  // of this fix gated onUpdate on an enumerated allowlist of DOM events /
  // command call sites that count as "the user edited". Three real input
  // paths bypassed that list and silently lost the edit: the very first
  // paste (ProseMirror's own paste handling dispatches synchronously, ahead
  // of any DOM listener this component could add), a task-item checkbox
  // (a native <input> "change" listener owned by @tiptap/extension-list,
  // not by this component), and StarterKit's built-in keymap (Mod-b etc.,
  // dispatched from ProseMirror's internal keydown handler). The fix
  // (see TiptapEditor.tsx's onUpdate) inverts the design: gate on
  // `transaction.docChanged` and exempt only the transactions WE dispatch
  // ourselves (see programmaticTransaction.ts) — every one of these three
  // paths is just a normal docChanged transaction, so no enumeration of
  // input paths is needed for any of them.
  describe("genuine edits from input paths that bypass an enumerated allowlist (#293 codex review)", () => {
    // ProseMirror-view's DOM `paste` handling is not exercisable through a
    // synthetic jsdom `Event` in this project's setup: jsdom has no
    // `ClipboardEvent`/`DataTransfer` constructors (`brokenClipboardAPI`
    // detection aside, `view.pasteHTML`/`pasteText` themselves default to
    // `new ClipboardEvent("paste")` when no event is supplied), and a
    // hand-rolled `{ getData }` stand-in passed via a plain `dispatchEvent`
    // fell through to ProseMirror's `capturePaste` DOM-textarea fallback
    // (real-browser-only; it crashes on jsdom's missing
    // `Element.getClientRects`) instead of the direct clipboard path.
    // `EditorView.pasteText` is the officially documented, non-DOM entry
    // point that runs the *exact same* `doPaste` production code a real
    // paste event invokes (up to and including dispatching the resulting
    // transaction through this editor's `onUpdate`), so it is used here
    // instead of a flaky synthetic DOM event.
    it("marks the file dirty on the very first paste, and the pasted text survives a tab switch", async () => {
      renderEditor();
      await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
      await settle();
      const editor = useEditorInstance.getState().editor!;

      editor.view.pasteText(
        "pasted-text",
        new Event("paste") as unknown as ClipboardEvent
      );

      expect(activeFile()?.isDirty).toBe(true);
      useEditorInstance.getState().flushPendingMarkdown();
      expect(activeFile()?.markdown).toContain("pasted-text");

      // Open a second file and switch to it — mirrors what EditorPage's
      // handleSelect does (flush, then switch activeIdByRoot) — to confirm
      // the paste isn't lost the moment the user looks away.
      useOpenFiles.getState().openServerFile({
        name: "other.md",
        path: "other.md",
        root: ROOT,
        markdown: "# Other\n",
        modified: "",
        created: "",
        sha: "sha-other",
      });
      const firstId = useOpenFiles
        .getState()
        .files.find((f) => f.path === "README.md")!.id;
      const survivedMarkdown = useOpenFiles
        .getState()
        .files.find((f) => f.id === firstId)?.markdown;
      expect(survivedMarkdown).toContain("pasted-text");
    });

    it("marks the file dirty when a task-item checkbox is clicked, and the checked state is saved", async () => {
      useOpenFiles.setState({ files: [], activeIdByRoot: {} });
      useOpenFiles.getState().openServerFile({
        name: "tasks.md",
        path: "tasks.md",
        root: ROOT,
        markdown: "# T\n\n- [ ] one\n- [ ] two\n",
        modified: "",
        created: "",
        sha: "sha-tasks",
      });
      renderEditor();
      await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
      await settle();
      const editor = useEditorInstance.getState().editor!;

      // @tiptap/extension-list's TaskItem node view renders a native
      // <input type="checkbox"> and owns its own "change" listener —
      // outside this component entirely.
      const checkbox = editor.view.dom.querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      expect(checkbox).not.toBeNull();
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));

      expect(activeFile()?.isDirty).toBe(true);
      useEditorInstance.getState().flushPendingMarkdown();
      expect(activeFile()?.markdown).toContain("[x] one");
    });

    it("marks the file dirty when a built-in keymap shortcut (bold) is used", async () => {
      renderEditor();
      await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
      await settle();
      const editor = useEditorInstance.getState().editor!;

      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (from === -1 && node.isText && node.text?.includes("Hello")) {
          from = pos + node.text.indexOf("Hello");
        }
      });
      expect(from).toBeGreaterThan(-1);
      const to = from + "Hello".length;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))
      );

      // StarterKit's built-in keymap binds "Mod-b" to toggleMark("bold") and
      // is invoked from ProseMirror's own keydown handling — not something
      // this component's code dispatches. jsdom reports a non-Mac platform,
      // so "Mod" resolves to Ctrl here (mirrors prosemirror-keymap's own
      // platform check), not Meta.
      const dom = editor.view.dom;
      dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          code: "KeyB",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );

      expect(editor.isActive("bold")).toBe(true);
      expect(activeFile()?.isDirty).toBe(true);
      useEditorInstance.getState().flushPendingMarkdown();
      expect(activeFile()?.markdown).toContain("**Hello**");
    });
  });
});
