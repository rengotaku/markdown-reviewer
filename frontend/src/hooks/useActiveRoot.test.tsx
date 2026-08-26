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
      data-search={loc.search}
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

  it("resolves a root name containing a literal % without throwing (codex review: no double-decode)", () => {
    // useParams already percent-decodes the segment; re-decoding "100%done"
    // (the router's already-decoded value) with decodeURIComponent throws
    // URIError: URI malformed ("%do" isn't a valid escape) and crashes the
    // whole page. Regression test for the double-decode bug.
    const wrapper = makeWrapper({
      roots: [{ name: "100%done", path: "/tmp/100%done" }],
      initialEntries: [`/${encodeURIComponent("100%done")}`],
    });
    const { result } = renderHook(() => useActiveRoot(), { wrapper });
    expect(result.current.active).toBe("100%done");
    expect(result.current.activePath).toBe("/tmp/100%done");
  });

  it("selects a root named with a literal %xx-looking sequence (docs%20archive) without corruption (#236 codex review round 2: fact-locking, not a fix)", () => {
    // Same fact-lock as the "100%done" case above, using the specific name
    // codex round 2 called out (a "%20"-looking literal, not an escaped
    // space) and the same encodeURIComponent a real caller would use.
    // encodeURIComponent("docs%20archive") -> "docs%2520archive"; useParams
    // must decode that exactly once back to "docs%20archive".
    const wrapper = makeWrapper({
      roots: [{ name: "docs%20archive", path: "/tmp/docs%20archive" }],
      initialEntries: [`/${encodeURIComponent("docs%20archive")}`],
    });
    const { result } = renderHook(() => useActiveRoot(), { wrapper });
    expect(result.current.active).toBe("docs%20archive");
    expect(result.current.activePath).toBe("/tmp/docs%20archive");
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

  it("preserves the query string when redirecting an unknown root to the default", async () => {
    const Wrapper = makeWrapper({ initialEntries: ["/phantom?filter=docs"] });
    const { getByTestId } = render(
      <Wrapper>
        <Probe />
      </Wrapper>
    );
    await waitFor(() => {
      expect(getByTestId("probe").dataset.active).toBe("works");
      expect(getByTestId("probe").dataset.pathname).toBe("/works");
      expect(getByTestId("probe").dataset.search).toBe("?filter=docs");
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

  it("setActive preserves the current query string (#236 codex review round 2)", () => {
    const Wrapper = makeWrapper({ initialEntries: ["/works?filter=docs"] });
    const { getByTestId } = render(
      <Wrapper>
        <Probe targetRoot="rooms" />
      </Wrapper>
    );
    const probe = getByTestId("probe");
    expect(probe.dataset.search).toBe("?filter=docs");
    act(() => probe.click());
    expect(probe.dataset.active).toBe("rooms");
    expect(probe.dataset.pathname).toBe("/rooms");
    expect(probe.dataset.search).toBe("?filter=docs");
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
