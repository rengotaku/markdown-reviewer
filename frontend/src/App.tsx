import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { EditorPage, NotFoundPage } from "@/pages";
import { useConfig } from "@/hooks/useConfig";
import { theme } from "@/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

/**
 * Handles the bare `/` route.
 *
 * Two jobs, both resolved with a single `replace` navigation once
 * /api/config has landed (never before — an empty `review_roots` just means
 * "still loading", not "no roots configured", so redirecting early would
 * bounce to a bogus empty-name path):
 *
 *  - Plain `/` (no query): go to the default root (`review_roots[0]`).
 *  - Legacy `?root=X&select_file=Y[&comment_id=Z]` deeplinks (pre path-style
 *    URLs, e.g. from an old `mr open` build or a bookmarked link): translate
 *    into the new `/X/Y[?comment_id=Z]` form. An unknown/absent `root` falls
 *    back to the default root, same as the plain-`/` case.
 */
function RootRedirect() {
  const { data: config } = useConfig();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roots = config?.review_roots ?? [];

  useEffect(() => {
    if (roots.length === 0) return; // config still loading
    const legacyRoot = searchParams.get("root");
    const legacySelectFile = searchParams.get("select_file");
    const commentId = searchParams.get("comment_id");
    const targetRoot =
      (legacyRoot && roots.find((r) => r.name === legacyRoot)?.name) || roots[0]?.name;
    if (!targetRoot) return;
    let path = `/${encodeURIComponent(targetRoot)}`;
    if (legacySelectFile) path += `/${encodeURIComponent(legacySelectFile)}`;
    if (commentId) path += `?comment_id=${encodeURIComponent(commentId)}`;
    navigate(path, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.length, searchParams, navigate]);

  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/:root" element={<EditorPage />} />
            <Route path="/:root/*" element={<EditorPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
