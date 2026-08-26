import { describe, it, expect } from "vitest";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { type ReactNode } from "react";
import { useActiveRoot } from "./useActiveRoot";

function makeWrapper(opts: {
  roots?: Array<{ name: string; path: string }>;
  initialEntries?: string[];
}) {
  const roots = opts.roots ?? [
    { name: "works", path: "/tmp/works" },
    { name: "rooms", path: "/tmp/rooms" },
  ];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["config"], {
    review_root_name: roots[0]?.name ?? "",
    review_root: roots[0]?.path ?? "",
    review_roots: roots,
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={opts.initialEntries ?? ["/works"]}>
          {/* Both routes render the same children: "/" covers a bare root-less
              URL (nothing has been resolved yet), "/:root/*" covers the normal
              case once a root segment is present. */}
          <Routes>
            <Route path="/" element={children} />
            <Route path="/:root/*" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

// Probe re-exposes useActiveRoot state via the DOM so tests can assert both
// the hook output and the URL state in one render.
function Probe({ targetRoot }: { targetRoot?: string }) {
  const loc = useLocation();
  const { active, activePath, setActive } = useActiveRoot();
  return (
    <button
      data-testid="probe"
      data-active={active}
      data-path={activePath}
      data-pathname={loc.pathname}
      onClick={() => targetRoot && setActive(targetRoot)}
    />
  );
}

describe("useActiveRoot", () => {
  it("defaults to the first configured root when no root is in the URL", () => {
    const wrapper = makeWrapper({ initialEntries: ["/"] });
    const { result } = renderHook(() => useActiveRoot(), { wrapper });
    expect(result.current.active).toBe("works");
    expect(result.current.activePath).toBe("/tmp/works");
    expect(result.current.roots).toHaveLength(2);
  });

  it("honors the root path segment when it matches a configured root", () => {
    const wrapper = makeWrapper({ initialEntries: ["/rooms"] });
    const { result } = renderHook(() => useActiveRoot(), { wrapper });
    expect(result.current.active).toBe("rooms");
    expect(result.current.activePath).toBe("/tmp/rooms");
  });

  it("falls back to the default root and redirects the URL when the root segment is unknown", async () => {
    const Wrapper = makeWrapper({ initialEntries: ["/phantom"] });
    const { getByTestId } = render(
      <Wrapper>
        <Probe />
      </Wrapper>
    );
    await waitFor(() => {
      expect(getByTestId("probe").dataset.active).toBe("works");
      expect(getByTestId("probe").dataset.pathname).toBe("/works");
    });
  });

  it("setActive updates the URL and switches the active root", () => {
    const Wrapper = makeWrapper({});
    const { getByTestId } = render(
      <Wrapper>
        <Probe targetRoot="rooms" />
      </Wrapper>
    );
    const probe = getByTestId("probe");
    expect(probe.dataset.active).toBe("works");
    act(() => probe.click());
    expect(probe.dataset.active).toBe("rooms");
    expect(probe.dataset.pathname).toBe("/rooms");
  });

  it("setActive produces a plain /{root} URL for the default root too (no special-casing)", () => {
    const Wrapper = makeWrapper({ initialEntries: ["/rooms"] });
    const { getByTestId } = render(
      <Wrapper>
        <Probe targetRoot="works" />
      </Wrapper>
    );
    const probe = getByTestId("probe");
    expect(probe.dataset.active).toBe("rooms");
    expect(probe.dataset.pathname).toBe("/rooms");
    act(() => probe.click());
    expect(probe.dataset.active).toBe("works");
    expect(probe.dataset.pathname).toBe("/works");
  });

  it("setActive is a no-op for unknown names", () => {
    const wrapper = makeWrapper({});
    const { result } = renderHook(() => useActiveRoot(), { wrapper });
    act(() => result.current.setActive("phantom"));
    expect(result.current.active).toBe("works");
  });

  it("setActive on the same root is a no-op", () => {
    const wrapper = makeWrapper({});
    const { result } = renderHook(() => useActiveRoot(), { wrapper });
    const before = result.current.active;
    act(() => result.current.setActive("works"));
    expect(result.current.active).toBe(before);
  });

  it("returns empty strings while the config is still loading (no preloaded data)", () => {
    function bareWrapper({ children }: { children: ReactNode }) {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return (
        <QueryClientProvider client={client}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(() => useActiveRoot(), { wrapper: bareWrapper });
    expect(result.current.active).toBe("");
    expect(result.current.activePath).toBe("");
    expect(result.current.roots).toEqual([]);
  });
});
