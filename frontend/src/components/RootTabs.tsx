import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useOpenFiles } from "@/hooks/useOpenFiles";

/**
 * Sidebar header tabs for switching between the configured review roots.
 * Hidden entirely when only one root is configured so single-root setups
 * (legacy REVIEW_ROOT) render identically to before.
 *
 * A dirty indicator (•) appears next to a root's name whenever any of its
 * open files have unsaved edits — useful since switching roots doesn't
 * destroy state, so it's easy to forget about pending work in the other
 * tab.
 */
export function RootTabs() {
  const { active, roots, setActive } = useActiveRoot();
  const files = useOpenFiles((s) => s.files);

  if (roots.length <= 1) return null;

  const dirtyByRoot = new Map<string, boolean>();
  for (const f of files) {
    if (f.isDirty) dirtyByRoot.set(f.root, true);
  }

  return (
    <Box
      sx={{
        borderBottom: "1px solid",
        borderColor: "divider",
        minHeight: 36,
      }}
      data-testid="root-tabs"
    >
      <Tabs
        value={active || false}
        onChange={(_, value) => setActive(value as string)}
        variant="scrollable"
        scrollButtons={false}
        sx={{
          minHeight: 36,
          "& .MuiTab-root": {
            minHeight: 36,
            textTransform: "none",
            py: 0.5,
            px: 1.25,
            minWidth: 0,
          },
        }}
      >
        {roots.map((root) => {
          const dirty = dirtyByRoot.get(root.name) ?? false;
          return (
            <Tab
              key={root.name}
              value={root.name}
              data-testid={`root-tab-${root.name}`}
              label={
                <Tooltip title={root.path} placement="bottom-start">
                  <Box
                    component="span"
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 0.25,
                    }}
                  >
                    {root.name}
                    {dirty && (
                      <Box
                        component="span"
                        aria-label="unsaved changes"
                        sx={{ ml: 0.25 }}
                      >
                        •
                      </Box>
                    )}
                  </Box>
                </Tooltip>
              }
            />
          );
        })}
      </Tabs>
    </Box>
  );
}
