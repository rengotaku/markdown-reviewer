import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { dirQueryKey } from "./useDir";
import { useToast } from "./useToast";
import { useDirChangeWatcher } from "./useDirChangeWatcher";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { Wrapper, client };
}

describe("useDirChangeWatcher", () => {
  beforeEach(() => {
    useToast.setState({ toasts: [] });
  });

  it("treats the first snapshot per dir path as a baseline (no toasts)", async () => {
    const { Wrapper, client } = makeWrapper();
    const onOpenFile = vi.fn();
    const onSelectDir = vi.fn();
    renderHook(() => useDirChangeWatcher({ onOpenFile, onSelectDir }), {
      wrapper: Wrapper,
    });

    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    // Give the subscription a tick to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(useToast.getState().toasts).toEqual([]);
  });

  it("emits a clickable toast when a new file appears on a subsequent snapshot", async () => {
    const { Wrapper, client } = makeWrapper();
    const onOpenFile = vi.fn();
    const onSelectDir = vi.fn();
    renderHook(() => useDirChangeWatcher({ onOpenFile, onSelectDir }), {
      wrapper: Wrapper,
    });

    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
          { name: "b.md", path: "b.md", type: "file", modified: "2026-05-21T00:00:00Z" },
        ],
      });
    });

    await waitFor(() => expect(useToast.getState().toasts).toHaveLength(1));
    const toast = useToast.getState().toasts[0];
    expect(toast.message).toContain("b.md");
    expect(toast.action?.label).toBe("ファイルを開く");
    toast.action?.onClick();
    expect(onOpenFile).toHaveBeenCalledWith("b.md");
  });

  it("emits a folder-flavored toast for new directories that calls onSelectDir", async () => {
    const { Wrapper, client } = makeWrapper();
    const onOpenFile = vi.fn();
    const onSelectDir = vi.fn();
    renderHook(() => useDirChangeWatcher({ onOpenFile, onSelectDir }), {
      wrapper: Wrapper,
    });

    act(() => {
      client.setQueryData(dirQueryKey(""), { entries: [] });
    });
    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "newdir", path: "newdir", type: "dir", modified: "2026-05-21T00:00:00Z" },
        ],
      });
    });

    await waitFor(() => expect(useToast.getState().toasts).toHaveLength(1));
    const toast = useToast.getState().toasts[0];
    expect(toast.action?.label).toBe("フォルダを開く");
    toast.action?.onClick();
    expect(onSelectDir).toHaveBeenCalledWith("newdir");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("emits a toast when an existing entry's mtime advances", async () => {
    const { Wrapper, client } = makeWrapper();
    const onOpenFile = vi.fn();
    const onSelectDir = vi.fn();
    renderHook(() => useDirChangeWatcher({ onOpenFile, onSelectDir }), {
      wrapper: Wrapper,
    });

    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-22T00:00:00Z" },
        ],
      });
    });

    await waitFor(() => expect(useToast.getState().toasts).toHaveLength(1));
    expect(useToast.getState().toasts[0].message).toContain("更新");
  });

  it("does not surface removed entries", async () => {
    const { Wrapper, client } = makeWrapper();
    const onOpenFile = vi.fn();
    const onSelectDir = vi.fn();
    renderHook(() => useDirChangeWatcher({ onOpenFile, onSelectDir }), {
      wrapper: Wrapper,
    });

    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
          { name: "b.md", path: "b.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });
    act(() => {
      client.setQueryData(dirQueryKey(""), {
        entries: [
          { name: "a.md", path: "a.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(useToast.getState().toasts).toEqual([]);
  });
});
