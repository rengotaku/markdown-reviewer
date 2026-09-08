// Issue #282 follow-up (codex review round 2, P1): a restore-to-this-version
// request's response (applyExternalReload) overwrites the tab's buffer
// unconditionally. If the user closes the diff view and types while that
// request is still in flight, the keystroke has nowhere safe to land — it
// isn't in the pre-restore autosave (which already ran before the request
// went out) and it gets clobbered the instant the response arrives. The fix
// is to make the editor read-only for exactly the file being restored.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TiptapEditor } from "./TiptapEditor";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useEditorInstance } from "@/hooks/useEditorInstance";

const ROOT = "mock-root";
const BODY = "# Title\n\nHello world.\n";

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

function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 300));
}

describe("TiptapEditor read-only lock during restore (#282 follow-up P1)", () => {
  beforeEach(() => {
    Element.prototype.scrollTo = () => {};
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useEditorInstance.setState({ restoringFileId: null });
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

  afterEach(() => {
    cleanup();
    useEditorInstance.setState({ restoringFileId: null });
  });

  it("goes read-only while restoringFileId names the active tab, and editable again once cleared", async () => {
    renderEditor();
    await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
    await settle();

    const fileId = useOpenFiles.getState().activeIdByRoot[ROOT];
    expect(fileId).toBeTruthy();
    expect(useEditorInstance.getState().editor?.isEditable).toBe(true);

    act(() => {
      useEditorInstance.getState().setRestoringFileId(fileId!);
    });
    await waitFor(() =>
      expect(useEditorInstance.getState().editor?.isEditable).toBe(false)
    );

    act(() => {
      useEditorInstance.getState().setRestoringFileId(null);
    });
    await waitFor(() =>
      expect(useEditorInstance.getState().editor?.isEditable).toBe(true)
    );
  });

  it("stays editable when the in-flight restore is for a different file", async () => {
    renderEditor();
    await waitFor(() => expect(useEditorInstance.getState().editor).not.toBeNull());
    await settle();

    act(() => {
      useEditorInstance.getState().setRestoringFileId("some-other-open-tab-id");
    });

    // Give the effect a tick to (not) fire before asserting it stayed put.
    await new Promise((r) => setTimeout(r, 0));
    expect(useEditorInstance.getState().editor?.isEditable).toBe(true);
  });
});
