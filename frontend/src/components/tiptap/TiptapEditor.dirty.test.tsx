import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TiptapEditor } from "./TiptapEditor";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useEditorInstance } from "@/hooks/useEditorInstance";

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
});
