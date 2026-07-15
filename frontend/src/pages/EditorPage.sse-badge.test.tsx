import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { useOpenFiles } from "@/hooks/useOpenFiles";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

/**
 * Minimal EventSource stand-in (mirrors EditorPage.sse-sweep.test.tsx /
 * useServerEvents.test.tsx): jsdom has no native EventSource, so we stub it
 * globally and drive open/error transitions by hand.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitOpen() {
    this.onopen?.();
  }

  emitError() {
    this.onerror?.();
  }

  close() {
    this.closed = true;
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <EditorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("EditorPage SSE-disconnected badge (#119 case 4)", () => {
  beforeEach(() => {
    localStorage.clear();
    useOpenFiles.setState({ files: [], activeIdByRoot: {} });
    useToast.setState({ toasts: [] });
    useConfirm.setState({ pending: null, queue: [] });
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never shows the badge before the first successful connection", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    // Connection never opened (no emitOpen call) — badge must stay absent
    // even though `connected` is currently false.
    expect(screen.queryByTestId("sse-disconnected-badge")).not.toBeInTheDocument();
  });

  it("shows the badge once a previously-connected channel drops, and hides it again on reconnect", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("sidebar-file-README.md")).toBeInTheDocument()
    );
    const instance = MockEventSource.instances[0];

    act(() => instance.emitOpen());
    expect(screen.queryByTestId("sse-disconnected-badge")).not.toBeInTheDocument();

    act(() => instance.emitError());
    await waitFor(() =>
      expect(screen.getByTestId("sse-disconnected-badge")).toBeInTheDocument()
    );

    act(() => instance.emitOpen());
    await waitFor(() =>
      expect(screen.queryByTestId("sse-disconnected-badge")).not.toBeInTheDocument()
    );
  });
});
