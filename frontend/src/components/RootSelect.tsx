import { useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import { useActiveRoot } from "@/hooks/useActiveRoot";
import { useOpenFiles } from "@/hooks/useOpenFiles";

const LABEL_SX = {
  flexGrow: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
} as const;

/**
 * Sidebar header control for switching between configured review roots
 * (#158). Replaces the second-row RootTabs bar that used to sit below the
 * sidebar header — that bar disappears entirely; the root switcher now lives
 * in the header's name label itself.
 *
 * Single-root setups (legacy REVIEW_ROOT) render the exact same inert label
 * as before #158: no button, no `▾`, no Tooltip-with-path — so the common
 * case renders identically.
 *
 * Multi-root setups turn that label into a pressable button that opens a
 * menu listing every configured root (name + absolute path). A dirty
 * indicator (•) mirrors the removed RootTabs behavior: it appears next to a
 * root's name in the menu whenever any of its open files have unsaved
 * edits, and on the header button itself only when a *non-active* root has
 * unsaved edits — the active root's own dirty state is already visible via
 * the editor's file tabs, so repeating it on the button would be redundant.
 */
export function RootSelect() {
  const { active, roots, activePath, setActive } = useActiveRoot();
  const files = useOpenFiles((s) => s.files);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const label = active || "Files";

  if (roots.length <= 1) {
    return (
      <Tooltip title={label} placement="bottom-start">
        <Typography variant="subtitle2" sx={LABEL_SX} data-testid="sidebar-review-root">
          {label}
        </Typography>
      </Tooltip>
    );
  }

  const dirtyByRoot = new Map<string, boolean>();
  for (const f of files) {
    if (f.isDirty) dirtyByRoot.set(f.root, true);
  }
  const dirtyElsewhere = roots.some(
    (r) => r.name !== active && dirtyByRoot.get(r.name)
  );

  const open = Boolean(anchorEl);

  const handleSelect = (name: string) => {
    setActive(name);
    setAnchorEl(null);
  };

  return (
    <>
      <Tooltip title={activePath} placement="bottom-start">
        <ButtonBase
          onClick={(e) => setAnchorEl(e.currentTarget)}
          // MUI Menu は role="menu" / role="menuitem" で描画されるため
          // aria-haspopup も "menu" に揃える。listbox と宣言すると支援技術に
          // 実際とは違うポップアップ種別を予告してしまう（#158 codex review）。
          aria-haspopup="menu"
          aria-expanded={open}
          // ボタンに aria-label を置くと子要素のテキスト（root 名）と
          // `•` の aria-label をまとめて上書きするため、伝えたい情報を
          // すべてここに畳み込む: 現在の root 名（round 2）＋他 root の
          // 未保存状態（round 3）。#158 codex review。
          aria-label={
            dirtyElsewhere
              ? `review root ${label} を切り替え（他の root に未保存の変更あり）`
              : `review root ${label} を切り替え`
          }
          data-testid="sidebar-review-root"
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            py: 0,
            justifyContent: "flex-start",
            // <button> の UA 既定は text-align:center。ラベルは flexGrow で
            // 伸びるので、これを潰さないと #158 以前の左寄せ表示から見た目が
            // 変わってしまう。
            textAlign: "left",
            borderRadius: 1,
          }}
        >
          <Typography variant="subtitle2" sx={LABEL_SX} component="span">
            {label}
          </Typography>
          {dirtyElsewhere && (
            <Box component="span" aria-label="unsaved changes in other roots" sx={{ flexShrink: 0 }}>
              •
            </Box>
          )}
          <ArrowDropDownIcon fontSize="small" sx={{ flexShrink: 0 }} />
        </ButtonBase>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        data-testid="root-select-menu"
      >
        {roots.map((root) => {
          const isActive = root.name === active;
          const dirty = dirtyByRoot.get(root.name) ?? false;
          return (
            <MenuItem
              key={root.name}
              // selected は Mui-selected クラス（見た目）用。role="menuitem"
              // は aria-selected をサポートしないので、現在のルートは
              // aria-current で伝える（#158 codex review）。
              selected={isActive}
              aria-current={isActive || undefined}
              onClick={() => handleSelect(root.name)}
              data-testid={`root-select-item-${root.name}`}
              sx={{ gap: 1 }}
            >
              <Box
                sx={{
                  width: 20,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isActive && <CheckIcon fontSize="small" />}
              </Box>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                  <Typography variant="body2" noWrap>
                    {root.name}
                  </Typography>
                  {dirty && <Box component="span" aria-label="unsaved changes">•</Box>}
                </Box>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {root.path}
                </Typography>
              </Box>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
