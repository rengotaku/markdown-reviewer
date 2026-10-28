import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import AddCommentIcon from "@mui/icons-material/AddComment";
import PublicIcon from "@mui/icons-material/Public";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import ReplyIcon from "@mui/icons-material/Reply";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import RefreshIcon from "@mui/icons-material/Refresh";
import LinkIcon from "@mui/icons-material/Link";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import ViewListIcon from "@mui/icons-material/ViewList";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import type { SxProps, Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";
import type { CommentJSON, CommentReply } from "@/api";
import type { CommentRailMode } from "@/hooks/useEditorPrefs";
import { BAR_HEIGHT } from "@/theme/dimensions";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { buildCommentDeepLink } from "@/utils/deeplink";
import { useToast } from "@/hooks/useToast";
import { markdownBodySx } from "./markdownBodySx";
import { contextLabel } from "@/utils/commentContext";
import { isAiAuthored } from "@/utils/commentPresentation";
import { CommentAuthor } from "./CommentAuthor";
import { CommentId } from "./CommentId";
import {
  isPlacedInPane,
  layoutCommentRail,
  RAIL_GAP,
  revealAnchorTop,
  type RailItem,
} from "@/utils/commentRailLayout";
import { groupIconRailEntries, type IconRailEntry } from "@/utils/commentIconGroups";
import { GlobalCommentBadges, type GlobalBadgeKind } from "./GlobalCommentBadges";
import { GlobalCommentsDialog } from "./GlobalCommentsDialog";
import { AgentActivityContext, type AgentCardActivity } from "./agentActivityContext";
import { pulseSx } from "./pulseSx";

/** Placeholder height for a card whose real height hasn't been measured yet
 *  (first paint, before its ResizeObserver fires) — enough to avoid every
 *  card starting stacked at the same spot before layout settles. */
const RAIL_DEFAULT_CARD_HEIGHT = 96;

/** Height of one icon in the rail's icon mode (#332). Fixed, so icons need
 *  no measurement: 18px icon + padding + border. */
const RAIL_ICON_HEIGHT = 28;

/** Characters of each comment's body shown in an icon's hover preview. */
const ICON_PREVIEW_CHARS = 60;

/** AI-authored comments/replies are read-only to the human reviewer: they can
 *  reply, resolve, and jump to them, but not edit the body or delete them. */

/** Comment/reply bodies longer than this are collapsed to a preview in the
 *  side-pane row, each with its own inline link to expand/collapse. The detail
 *  dialog always shows the full text. */
const BODY_PREVIEW_LIMIT = 200;

/** #355: reply/edit fields in the pane scroll inside themselves past this
 *  many rows, so a pasted log can't push their submit buttons out of view. */
const RAIL_FIELD_MAX_ROWS = 12;

/** #364: every card action sits in the header row, so the icons are kept
 *  small enough that six of them fit beside the id and badges. */
const CARD_ICON_SIZE = 14;
/** #364: the 14px icons are hard to aim at; the one under the pointer turns
 *  the primary colour so it is clear which action a click will take. */
const ACTION_HOVER_SX = {
  "& .MuiIconButton-root:not(.Mui-disabled):hover": { color: "primary.main" },
} as const;

/** #364: a non-selected card previews this many of its latest replies. */
const REPLY_PREVIEW_COUNT = 2;

/** CSS-only height clamp for a collapsed long body: unlike slicing the
 *  Markdown source (which breaks mid-syntax — a table or fence cut in half),
 *  the full source is always rendered and only the *visual* height is capped,
 *  with a bottom fade hinting there's more. `maxHeight` is caller-supplied so
 *  the rail's cards (#304: 3 lines, to keep neighbouring cards from being
 *  pushed too far down now that list mode is gone) and the pinned section's
 *  rows (6 lines, unchanged) can clamp to different heights with the same
 *  mechanism. `fade` is off for a clamp applied before anything is known to
 *  be hidden (#330's measured bodies), so short text gets no stray fade. */
function clampSx(theme: Theme, maxHeight: string, fade = true): SystemStyleObject<Theme> {
  if (!fade) return { maxHeight, overflow: "hidden" };
  return {
    maxHeight,
    overflow: "hidden",
    position: "relative",
    "&::after": {
      content: '""',
      position: "absolute",
      insetInline: 0,
      bottom: 0,
      height: "1.5em",
      background: `linear-gradient(to bottom, transparent, ${theme.palette.background.default})`,
      pointerEvents: "none",
    },
  };
}

/** #355: a card's header and action row stay pinned to the edges of whatever
 *  scrolls them (the rail card's own 320px box, or the list's pane) so a
 *  multi-thousand-character body can't push the buttons screens away. A
 *  sticky row needs an opaque fill, but the selected card's tint
 *  (`action.selected`) is translucent — layer it over the paper so the pinned
 *  row matches the card behind it and the body doesn't show through. */
function stickyRowSx(
  edge: "top" | "bottom",
  selected: boolean
): (theme: Theme) => SystemStyleObject<Theme> {
  return (theme) => {
    const paper = theme.palette.background.paper;
    const tint = theme.palette.action.selected;
    return {
      position: "sticky",
      [edge]: 0,
      zIndex: 1,
      background: selected ? `linear-gradient(${tint}, ${tint}), ${paper}` : paper,
    };
  };
}

/** Renders a comment/reply's full Markdown source (#147) and collapses tall
 *  bodies to a CSS-clamped preview with an inline "続きを表示 / 折りたたむ"
 *  toggle below it. Each instance keeps its own expand state, so a comment
 *  body and each of its replies collapse independently. The clamp is purely
 *  visual — the full source is always in the DOM, so mid-syntax truncation
 *  (a half-rendered table/fence) can't happen. Short text renders in full
 *  with no toggle.
 *
 *  #330: `measureOverflow` additionally collapses a body whose *rendered*
 *  height exceeds the clamp even though its source is under
 *  BODY_PREVIEW_LIMIT — in the rail's narrow cards ~130 Japanese characters
 *  wrap to 6–7 lines, so the source-length rule alone never clamped them and
 *  each card grew past the paragraph spacing it is aligned to. Such a body is
 *  clamped from its very first paint, before the measurement lands: the
 *  rail's card observer would otherwise record the full height first, place
 *  (or drop) the card by it, and an unmounted card never re-measures. The
 *  measurement only decides whether the fade and toggle show. `clampDisabled`
 *  shows the full body with no toggle (the rail's selected card).
 *
 *  #148: every body is measured, and once a measurement lands it alone
 *  decides — the source length is only the fallback until then (and in
 *  jsdom, which lays nothing out). A long source that renders short (a link
 *  with a long URL behind a short label) no longer gets a toggle that
 *  reveals nothing. While collapsed, links and buttons wholly below the
 *  clamp are taken out of the tab order, so focus can't land on something
 *  the reader can't see; the visible preview stays readable to assistive
 *  tech, which an `inert` on the whole body would have hidden too. */
function CollapsibleText({
  text,
  testid,
  sx,
  clampHeight = "6em",
  measureOverflow = false,
  clampDisabled = false,
  stickyToggle = false,
}: {
  text: string;
  testid: string;
  sx?: SxProps<Theme>;
  clampHeight?: string;
  measureOverflow?: boolean;
  clampDisabled?: boolean;
  /** #355: pin the expanded "折りたたむ" to the bottom of the scroller. Only
   *  for a card's own body — a reply's toggle only ever shows in a selected
   *  card, whose action row is already pinned there and would cover it. */
  stickyToggle?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setBodyEl, bodyEl] = useClampOverflow(
    !clampDisabled,
    clampHeight,
    text
  );
  const measured = measureOverflow && !clampDisabled;
  const long = !clampDisabled && (overflowing ?? text.length > BODY_PREVIEW_LIMIT);
  const collapsed = long && !expanded;
  useHideClippedFocusables(bodyEl, collapsed);
  // A measured body stays clamped until expanded even while it isn't known
  // to overflow yet — for text that fits, the clamp is a no-op.
  const clamped = collapsed || (measured && !expanded);
  return (
    <Box>
      <Typography
        ref={setBodyEl}
        variant="body2"
        component="div"
        data-testid={testid}
        data-collapsed={String(collapsed)}
        // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
        dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(text) }}
        sx={
          [
            sx ?? false,
            markdownBodySx,
            clamped ? (theme: Theme) => clampSx(theme, clampHeight, collapsed) : false,
          ].filter(Boolean) as SxProps<Theme>
        }
      />
      {long && (
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          // #330: a click reaching the rail card would also select it, and the
          // selected card drops this toggle (full body, no clamp) — the
          // button being pressed would vanish from under the pointer/focus.
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          data-testid={`${testid}-toggle`}
          // #355: once expanded, "折りたたむ" sits at the end of the full body —
          // pin it to the bottom so it can be pressed without scrolling there.
          sx={
            [
              { display: "block", width: "100%", textAlign: "left", mt: 0.25 },
              expanded && stickyToggle ? stickyRowSx("bottom", false) : false,
            ].filter(Boolean) as SxProps<Theme>
          }
        >
          {expanded ? "折りたたむ" : "続きを表示"}
        </Link>
      )}
    </Box>
  );
}

/** Whether an element's natural (unclamped) content height exceeds
 *  `clampHeight`. scrollHeight reports the full content whether or not the
 *  clamp is currently applied, so the result doesn't flip when the toggle
 *  switches between the two states. The clamp is resolved to px through a
 *  throwaway probe inside the element, so `em` uses the element's own font
 *  size exactly as the clamp's `maxHeight` does. null until a measurement
 *  lands; jsdom lays nothing out (every height reads 0), so there it stays
 *  null and the caller's source-length fallback decides. */
function useClampOverflow(
  enabled: boolean,
  clampHeight: string,
  // Re-measure when the body changes: a clamped element keeps the same box
  // when its content grows, so the observer alone wouldn't fire.
  text: string
): readonly [boolean | null, (el: HTMLElement | null) => void, HTMLElement | null] {
  const [value, setValue] = useState<boolean | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const probe = document.createElement("div");
      probe.style.cssText = `position:absolute;visibility:hidden;height:${clampHeight}`;
      el.appendChild(probe);
      const limit = probe.getBoundingClientRect().height;
      probe.remove();
      // +1 absorbs rounding between scrollHeight (integer) and the probe's
      // fractional px.
      setValue(limit > 0 ? el.scrollHeight > limit + 1 : null);
    };
    // The observer's initial callback (fired on observe) does the first
    // measurement; jsdom's no-op stand-in never calls back, see the doc above.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, el, clampHeight, text]);

  // A stale `true` from before the clamp was disabled must not leak through.
  return [enabled ? value : false, setEl, el] as const;
}

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";
/** Marks a node useHideClippedFocusables took out of the tab order; holds the
 *  tabindex it had before ("" for none). */
const CLAMP_HIDDEN = "data-clamp-hidden";
/** The aria-hidden that node had before ("" for none). */
const CLAMP_HIDDEN_ARIA = "data-clamp-hidden-aria";

/** Puts back an attribute saved as "" (absent) or its previous value. */
function restoreAttr(node: HTMLElement, name: string, saved: string | null) {
  if (saved) node.setAttribute(name, saved);
  else node.removeAttribute(name);
}

/** #148: while `collapsed`, gives every focusable inside `el` that starts at
 *  or below the clamp's bottom edge `tabindex="-1"` and `aria-hidden` (so a
 *  screen reader's link list skips it too), and puts back whatever it had
 *  once the body expands. The body is `dangerouslySetInnerHTML`, which
 *  React rewrites on its own re-renders (dropping whatever was set on the old
 *  nodes), so this re-applies after every commit and keeps no state of its
 *  own: a marked node carries its previous tabindex in CLAMP_HIDDEN. It also
 *  re-judges whenever the body's box changes — a card can mount before it is
 *  laid out (zero height), when nothing is below anything yet. jsdom lays
 *  nothing out, so there this only acts on stubbed geometry. */
function useHideClippedFocusables(el: HTMLElement | null, collapsed: boolean) {
  const apply = useCallback(() => {
    if (!el) return;
    // Read every position first and write only what changed, so a commit
    // that leaves the body as it was costs no style invalidation.
    const box = collapsed ? el.getBoundingClientRect() : null;
    const clipped = new Set<HTMLElement>();
    if (box && box.height > 0) {
      for (const node of el.querySelectorAll<HTMLElement>(FOCUSABLE)) {
        if (node.getBoundingClientRect().top >= box.bottom) clipped.add(node);
      }
    }
    for (const node of el.querySelectorAll<HTMLElement>(`[${CLAMP_HIDDEN}]`)) {
      if (clipped.delete(node)) continue; // already marked
      restoreAttr(node, "tabindex", node.getAttribute(CLAMP_HIDDEN));
      restoreAttr(node, "aria-hidden", node.getAttribute(CLAMP_HIDDEN_ARIA));
      node.removeAttribute(CLAMP_HIDDEN);
      node.removeAttribute(CLAMP_HIDDEN_ARIA);
    }
    for (const node of clipped) {
      node.setAttribute(CLAMP_HIDDEN, node.getAttribute("tabindex") ?? "");
      node.setAttribute(CLAMP_HIDDEN_ARIA, node.getAttribute("aria-hidden") ?? "");
      node.setAttribute("tabindex", "-1");
      node.setAttribute("aria-hidden", "true");
    }
  }, [el, collapsed]);

  // Every commit: a re-render may have replaced the body's nodes.
  useLayoutEffect(apply);

  useEffect(() => {
    if (!el || !collapsed || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, collapsed, apply]);
}

const SCOPE_BADGE: Record<string, { label: string; color: string }> = {
  inline: { label: "inline", color: "#fff8c5" },
  block: { label: "block", color: "#fff8c5" },
  cross_section: { label: "横断", color: "#fef3c7" },
  global: { label: "全体", color: "#e0f2fe" },
};

interface Props {
  root?: string;
  filePath?: string;
  comments: ReadonlyArray<CommentJSON>;
  /** The active file is under review (draft files cannot take comments). */
  reviewActive: boolean;
  /** Re-fetch the comment list from the sidecar (e.g. to pick up AI replies
   *  added out-of-band). */
  onRefresh: () => void;
  /** Whether the current editor selection can take an anchored comment. */
  canAddComment: boolean;
  /** Both receive the trigger button's rect: the composer opens beside it
   *  rather than in a centre modal (#252). */
  onAddComment: (anchor: DOMRect) => void;
  onAddGlobal: (anchor: DOMRect) => void;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  /** Edit one threaded reply's body, addressed by its 0-based index. */
  onEditReply: (id: string, index: number, body: string) => void;
  /** Delete one threaded reply, addressed by its 0-based index. */
  onDeleteReply: (id: string, index: number) => void;
  /** Scroll to + flash the comment's highlight in the editor. */
  onJump: (id: string) => void;
  /** Open an anchored comment: the editor scrolls to it and opens its thread
   *  beside the text (#253). Reading and replying happen there, not here. */
  onSelect: (id: string) => void;
  /** #364: close the open card (the card's own ∧ button). */
  onDeselect?: () => void;
  /** The comment whose thread is currently open, if it is one of these. */
  selectedId?: string | null;
  /** Viewport top (px) of each anchored comment's first decoration, keyed by
   *  comment id — what the paragraph-aligned rail layout positions cards
   *  against (#298). The caller (EditorPage) owns the editor DOM this is
   *  measured from. A comment missing an entry here is treated as having no
   *  live anchor for layout purposes. */
  anchorTops?: Readonly<Record<string, number>>;
  /** The editor's document root, measured in the same pass as `anchorTops`
   *  (#338): its viewport `top` / `bottom` and the body's `scrollTop`. The
   *  aligned rail keeps its first card below where the document starts at
   *  rest, and compares its own bottom edge against `bottom` to tell how much
   *  further the body must scroll for the last card to come into view. */
  docBox?: DocBox | null;
  /** Reports how many px the aligned rail reaches past the end of the
   *  document (0 when it doesn't, or when the rail isn't shown), so the
   *  caller can extend the body's scroll range by that much (#338). */
  onRailOverhangChange?: (px: number) => void;
  /** Ids of anchored comments whose anchor the caller could not resolve in
   *  the live document (#328). The server's own `orphan` flag is computed
   *  from the raw markdown lines, so it can say "anchored" for a comment the
   *  editor cannot place; these join the orphan bucket here rather than
   *  falling out of the pane entirely. */
  unresolvedIds?: ReadonlySet<string>;
  /** "aligned" (default): cards level with their paragraphs. "list": every
   *  anchored card in document order in one scrollable column (#333).
   *  "icons": a count icon per line, only the selected card opened (#332). */
  railMode?: CommentRailMode;
  /** Renders the mode switch when given; without it the pane stays aligned. */
  onRailModeChange?: (mode: CommentRailMode) => void;
  /** Filled in by the aligned rail with a {@link RailReveal} for the caller's
   *  jump to use (#339); null while no aligned rail is shown. */
  railRevealRef?: MutableRefObject<RailReveal | null>;
  /** The AI is working on these comments after a send from this editor
   *  (#360): open cards show that a reply is on its way. */
  agentReplying?: boolean;
  /** New AI replies per comment id since that work began (#360). */
  agentNewReplies?: ReadonlyMap<string, number>;
  /** Open comment ids that send handed over (#366); null before any send. */
  agentSentIds?: ReadonlySet<string> | null;
}

const NO_NEW_REPLIES: ReadonlyMap<string, number> = new Map();

/** How many px the body must scroll (positive = down) for a comment's card to
 *  land inside the aligned rail (#339). `undefined` while the rail is still
 *  laying out (worth waiting for); null when it cannot place that card at all
 *  (not worth waiting for — e.g. a pane with no height). */
export type RailReveal = (id: string) => number | null | undefined;

type StatusFilter = "all" | "open" | "resolved";

/** See the `docBox` prop. */
export interface DocBox {
  top: number;
  bottom: number;
  scrollTop: number;
}

/** Stable default for the optional `unresolvedIds` prop: a fresh `new Set()`
 *  in the parameter list would be a new identity every render and defeat the
 *  memos below. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** A card's half-written reply/edit and whether each form is open (#334).
 *  Held by CommentSidePane per comment, not in CommentCard's own state: a card
 *  unmounts whenever icon mode folds it back into an icon, the status filter
 *  hides it, or the rail mode is switched — and its useState went with it,
 *  dropping what was typed without a word. */
interface CardDraft {
  replyOpen: boolean;
  replyBody: string;
  editOpen: boolean;
  editBody: string;
}

const EMPTY_DRAFT: CardDraft = {
  replyOpen: false,
  replyBody: "",
  editOpen: false,
  editBody: "",
};

/** Nothing worth keeping: both forms closed and no reply text (a closed edit
 *  form's text is discarded anyway — startEdit reloads the comment body). */
function isEmptyDraft(d: CardDraft): boolean {
  return !d.replyOpen && !d.replyBody && !d.editOpen;
}

interface CardDrafts {
  get: (id: string) => CardDraft;
  update: (id: string, patch: Partial<CardDraft>) => void;
}

const CardDraftsContext = createContext<CardDrafts | null>(null);

function omitKeys<T>(
  record: Readonly<Record<string, T>>,
  keys: readonly string[]
): Readonly<Record<string, T>> {
  if (!keys.some((k) => Object.hasOwn(record, k))) return record;
  const rest = { ...record };
  for (const k of keys) delete rest[k];
  return rest;
}

function useCardDraft(id: string): [CardDraft, (patch: Partial<CardDraft>) => void] {
  const drafts = useContext(CardDraftsContext);
  if (!drafts) throw new Error("CommentCard must be rendered inside CommentSidePane");
  return [drafts.get(id), (patch) => drafts.update(id, patch)];
}

export function CommentSidePane({
  root,
  filePath,
  comments,
  reviewActive,
  onRefresh,
  canAddComment,
  onAddComment,
  onAddGlobal,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onJump,
  onSelect,
  onDeselect,
  selectedId,
  anchorTops = {},
  docBox = null,
  onRailOverhangChange,
  unresolvedIds = EMPTY_IDS,
  railMode = "aligned",
  onRailModeChange,
  railRevealRef,
  agentReplying = false,
  agentNewReplies = NO_NEW_REPLIES,
  agentSentIds = null,
}: Props) {
  const agentActivity = useMemo<AgentCardActivity>(
    () => ({
      replying: agentReplying,
      newReplies: agentNewReplies,
      sentIds: agentSentIds,
    }),
    [agentReplying, agentNewReplies, agentSentIds]
  );
  const canCopyLink = Boolean(root && filePath);
  const handleCopyLink = async (id: string) => {
    if (!root || !filePath) return;
    const url = buildCommentDeepLink(window.location.origin, root, filePath, id);
    try {
      await navigator.clipboard.writeText(url);
      useToast.getState().show("リンクをコピーしました", "success");
    } catch {
      useToast.getState().show("リンクのコピーに失敗しました", "error");
    }
  };

  // Unresolved by default (#253): the pane exists to show what still needs an
  // answer, and a finished review is mostly resolved rows.
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [detailId, setDetailId] = useState<string | null>(null);
  // Look the comment up live so the dialog reflects refetched replies/edits;
  // if it was deleted out from under us, the dialog simply closes.
  const detailComment = useMemo(
    () => comments.find((c) => c.id === detailId) ?? null,
    [comments, detailId]
  );
  const openCount = useMemo(
    () => comments.filter((c) => c.status === "open").length,
    [comments]
  );
  const resolvedCount = comments.length - openCount;
  const visible = useMemo(
    () => (filter === "all" ? comments : comments.filter((c) => c.status === filter)),
    [comments, filter]
  );
  // Comments with no live anchor (全体スコープ / orphan) cannot open a popover
  // beside the text, so they never get a card in the rail below. #309 used
  // to render them permanently above the document body; #316 replaced that
  // with a pressable one-line badge (count only) at the top of this pane's
  // list, opening GlobalCommentsDialog on click instead.
  // #328: "has no live anchor" is the union of the server's `orphan` flag and
  // the caller's own resolution failures. The server resolves anchors against
  // the raw markdown lines and the editor against the rendered document, so
  // the two can disagree (e.g. a snippet holding a raw table row: the server
  // finds the line, the editor finds no such text because the cells are split
  // into separate nodes). Trusting only the flag left those comments in
  // `anchored` with no position to place them at — no card, no badge, no
  // above/below count: they vanished with the header still counting them.
  const hasNoLiveAnchor = useCallback(
    (c: CommentJSON) => c.orphan || unresolvedIds.has(c.id),
    [unresolvedIds]
  );
  // #333: in document order. The API returns comments in the order they were
  // added (reviewstore appends), so a comment added later near the top would
  // otherwise follow one added earlier near the bottom — wrong for the list,
  // and for the aligned rail's stacking order too. `context.line_range` is
  // the server's resolved position (covering every anchor of a multi-block
  // comment); a comment without one sorts last. Array.sort is stable, so
  // comments on the same line keep their creation order.
  const anchored = useMemo(
    () =>
      visible
        .filter((c) => !(c.scope === "global" || hasNoLiveAnchor(c)))
        .sort(
          (a, b) =>
            (a.context?.line_range[0] ?? Infinity) -
            (b.context?.line_range[0] ?? Infinity)
        ),
    [visible, hasNoLiveAnchor]
  );
  const globalComments = useMemo(
    () => visible.filter((c) => c.scope === "global" && !hasNoLiveAnchor(c)),
    [visible, hasNoLiveAnchor]
  );
  const orphanComments = useMemo(
    () => visible.filter((c) => hasNoLiveAnchor(c)),
    [visible, hasNoLiveAnchor]
  );
  const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
  const [globalDialogTab, setGlobalDialogTab] = useState<GlobalBadgeKind>("global");

  // #226: a comment with no live anchor has no highlight to jump to, so when
  // one is selected (a `?comment_id=` link) open the dialog it lives in, on
  // its tab, with the row marked. A resolved one is hidden by the default
  // "open" filter; widen it so the row is there to mark. Whether an anchored
  // comment is live is only known once the caller has measured it or found
  // it unresolvable (`unresolvedIds` lands a frame after the selection), so a
  // selection stays pending until then. Derived during render so it opens on
  // the same commit that settles it.
  const [selectionSettled, setSelectionSettled] = useState(selectedId);
  if (selectedId !== selectionSettled) {
    const target = selectedId ? comments.find((c) => c.id === selectedId) : undefined;
    const noLiveAnchor =
      !!target && (target.scope === "global" || hasNoLiveAnchor(target));
    if (!selectedId || noLiveAnchor || (target && Object.hasOwn(anchorTops, target.id))) {
      setSelectionSettled(selectedId);
    }
    if (target && noLiveAnchor) {
      if (filter !== "all" && target.status !== filter) setFilter("all");
      setGlobalDialogTab(
        target.scope === "global" && !hasNoLiveAnchor(target) ? "global" : "orphan"
      );
      setGlobalDialogOpen(true);
    }
  }

  // #334: drafts belong to the open file's comments, by id. Ids are only
  // unique within one file's sidecar, and EditorPage keeps this pane mounted
  // when the open file changes, so a file change starts from none. Done during
  // render (React's derived-state pattern) so no card sees the old file's.
  const [drafts, setDrafts] = useState<Readonly<Record<string, CardDraft>>>({});
  const fileKey = JSON.stringify([root ?? "", filePath ?? ""]);
  const [draftsFileKey, setDraftsFileKey] = useState(fileKey);
  if (fileKey !== draftsFileKey) {
    setDraftsFileKey(fileKey);
    setDrafts({});
  }
  // reviewstore numbers a new comment max+1, so once a comment is deleted its
  // id can come back on a different comment — which must not open with the old
  // one's reply, or an edit that would overwrite the new body. A draft whose
  // comment is no longer listed goes.
  const staleDraftIds = Object.keys(drafts).filter(
    (id) => !comments.some((c) => c.id === id)
  );
  if (staleDraftIds.length > 0) setDrafts((prev) => omitKeys(prev, staleDraftIds));
  const cardDrafts = useMemo<CardDrafts>(
    () => ({
      get: (id) => drafts[id] ?? EMPTY_DRAFT,
      update: (id, patch) =>
        setDrafts((prev) => {
          const merged = { ...(prev[id] ?? EMPTY_DRAFT), ...patch };
          return isEmptyDraft(merged) ? omitKeys(prev, [id]) : { ...prev, [id]: merged };
        }),
    }),
    [drafts]
  );
  // Deleted here: drop the draft now rather than wait for the refetch, which
  // may come back with the id already reused (delete + add in one fetch).
  const handleDelete = (id: string) => {
    setDrafts((prev) => omitKeys(prev, [id]));
    onDelete(id);
  };

  const pane = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
      data-testid="comment-side-pane"
    >
      <Box
        sx={{
          pl: 2,
          pr: 0.5,
          // #143: この 1 行目の下線は廃止した。BAR_HEIGHT 固定は、直下の
          // フィルタ行（2 行目）のディバイダを他ペインの 2 行目と揃えて
          // 1 本の連続線にするために引き続き必要（#65, #90）。
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          Comments ({openCount}/{comments.length})
        </Typography>
        <Tooltip title="コメントを再取得">
          <IconButton
            size="small"
            onClick={onRefresh}
            aria-label="refresh comments"
            data-testid="comment-pane-refresh"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {/* #333: in the title row, not the filter row below — that one is
            already measured full (#196: filter ~225px + two add buttons in a
            295px row). */}
        {onRailModeChange && (
          <ToggleButtonGroup
            value={railMode}
            exclusive
            size="small"
            onChange={(_, v) => {
              if (v !== null) onRailModeChange(v as CommentRailMode);
            }}
            aria-label="コメントカードの並べ方"
            data-testid="comment-rail-mode"
            sx={{ flexShrink: 0 }}
          >
            <ToggleButton
              value="aligned"
              aria-label="段落の横に並べる"
              data-testid="comment-rail-mode-aligned"
              sx={{ p: 0.5 }}
            >
              <Tooltip title="段落の横に並べる">
                <ViewAgendaIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="icons"
              aria-label="アイコンだけ"
              data-testid="comment-rail-mode-icons"
              sx={{ p: 0.5 }}
            >
              <Tooltip title="アイコンだけ（クリックで開く）">
                <ChatBubbleOutlineIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton
              value="list"
              aria-label="一覧"
              data-testid="comment-rail-mode-list"
              sx={{ p: 0.5 }}
            >
              <Tooltip title="一覧（文書順に全件）">
                <ViewListIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      {/* Filter + add actions share one row (#196). They used to occupy two
          BAR_HEIGHT rows, which cost 37px of comment list for controls that fit
          side by side once the add buttons drop their labels. The three counts
          stay visible at once — "how many are still open" is the number this
          pane exists to show, so the filter is never collapsed into a select.
          Measured: pane inner width 295px = filter ~225px + two icon buttons. */}
      <Box
        sx={{
          px: 1.5,
          // Fixed height matching the editor file tab bar (BAR_HEIGHT = 37px,
          // border-box), so the second-row dividers form one continuous line
          // across the panes (#65, #90).
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
        data-testid="comment-add-toolbar"
      >
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, v) => {
            if (v !== null) setFilter(v as StatusFilter);
          }}
          aria-label="コメントの表示フィルタ"
          data-testid="comment-status-filter"
          sx={{
            flex: 1,
            minWidth: 0,
            // Let the three buttons share the space evenly and shrink together
            // rather than pushing the icon buttons off the row when the counts
            // grow to two or three digits.
            // The counts are unbounded, so the label must degrade instead of
            // spilling into the neighbouring button. Parentheses are dropped
            // (they cost ~10px and carry no meaning here), and anything that
            // still doesn't fit is ellipsised rather than overlapping.
            // Measured at 12px: content box 67px, "すべて 100" ≈ 57px.
            "& .MuiToggleButton-root": {
              flex: 1,
              minWidth: 0,
              textTransform: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "block",
              textAlign: "center",
              py: 0.5,
              px: 0.5,
              fontSize: "0.75rem",
              lineHeight: 1.2,
            },
          }}
        >
          <ToggleButton value="all" data-testid="comment-filter-all">
            すべて {comments.length}
          </ToggleButton>
          <ToggleButton value="open" data-testid="comment-filter-open">
            未解決 {openCount}
          </ToggleButton>
          <ToggleButton value="resolved" data-testid="comment-filter-resolved">
            解決済 {resolvedCount}
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="選択範囲にコメントを追加（未取り込みなら自動で取り込む）">
          <span>
            <IconButton
              size="small"
              color="primary"
              disabled={!canAddComment}
              onClick={(e) => onAddComment(e.currentTarget.getBoundingClientRect())}
              aria-label="選択範囲にコメントを追加"
              data-testid="editor-add-comment"
              sx={{ flexShrink: 0 }}
            >
              <AddCommentIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="ファイル全体に向けたコメントを追加（選択不要・未取り込みなら自動で取り込む）">
          <span>
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => onAddGlobal(e.currentTarget.getBoundingClientRect())}
              aria-label="ファイル全体にコメントを追加"
              data-testid="editor-add-global-comment"
              sx={{ flexShrink: 0 }}
            >
              <PublicIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {reviewActive && (
          <GlobalCommentBadges
            globalCount={globalComments.length}
            orphanCount={orphanComments.length}
            onOpen={(kind) => {
              setGlobalDialogTab(kind);
              setGlobalDialogOpen(true);
            }}
          />
        )}
        {!reviewActive ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              このファイルはまだレビュー対象ではありません。テキストを選択してこの上のコメント追加ボタン（吹き出しのアイコン／ファイル全体なら地球のアイコン）を押すと、自動で取り込んでレビューを開始します。
            </Typography>
          </Box>
        ) : comments.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              コメントはまだありません。テキストを選択してこの上のコメント追加ボタン（吹き出しのアイコン）を押すと追加できます。
            </Typography>
          </Box>
        ) : visible.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {filter === "open"
                ? "未解決のコメントはありません。"
                : "解決済みのコメントはありません。"}
            </Typography>
          </Box>
        ) : anchored.length === 0 ? (
          // #316: every visible comment is global/orphan (no live anchor) —
          // those surface only via the badge row above, not a card here.
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              本文にひもづくコメントはありません。全体・位置不明のコメントは上部のバッジから確認できます。
            </Typography>
          </Box>
        ) : railMode === "list" ? (
          <CommentList
            comments={anchored}
            selectedId={selectedId ?? null}
            onSelect={onSelect}
            onDeselect={onDeselect}
            onCopyLink={handleCopyLink}
            canCopyLink={canCopyLink}
            onDelete={handleDelete}
            onResolveToggle={onResolveToggle}
            onReply={onReply}
            onEdit={onEdit}
            onEditReply={onEditReply}
            onDeleteReply={onDeleteReply}
            onOpenDetail={setDetailId}
          />
        ) : (
          <AlignedCommentRail
            comments={anchored}
            iconMode={railMode === "icons"}
            anchorTops={anchorTops}
            docBox={docBox}
            onOverhangChange={onRailOverhangChange}
            revealRef={railRevealRef}
            selectedId={selectedId ?? null}
            onSelect={onSelect}
            onDeselect={onDeselect}
            onCopyLink={handleCopyLink}
            canCopyLink={canCopyLink}
            onDelete={handleDelete}
            onResolveToggle={onResolveToggle}
            onReply={onReply}
            onEdit={onEdit}
            onEditReply={onEditReply}
            onDeleteReply={onDeleteReply}
            onOpenDetail={setDetailId}
          />
        )}
      </Box>

      <CommentDetailDialog
        comment={detailComment}
        onClose={() => setDetailId(null)}
        onDelete={(id) => {
          handleDelete(id);
          setDetailId(null);
        }}
        onResolveToggle={onResolveToggle}
        onReply={onReply}
        onEdit={onEdit}
        onEditReply={onEditReply}
        onDeleteReply={onDeleteReply}
        onJump={(id) => {
          onJump(id);
          setDetailId(null);
        }}
        onCopyLink={handleCopyLink}
        canCopyLink={canCopyLink}
      />

      <GlobalCommentsDialog
        open={globalDialogOpen}
        initialTab={globalDialogTab}
        selectedId={selectedId ?? null}
        globalComments={globalComments}
        orphanComments={orphanComments}
        onClose={() => setGlobalDialogOpen(false)}
        onDelete={handleDelete}
        onResolveToggle={onResolveToggle}
        onReply={onReply}
        onEdit={onEdit}
        onEditReply={onEditReply}
        onDeleteReply={onDeleteReply}
        onCopyLink={handleCopyLink}
        canCopyLink={canCopyLink}
        onAddGlobal={onAddGlobal}
      />
    </Box>
  );

  return (
    <CardDraftsContext.Provider value={cardDrafts}>
      <AgentActivityContext.Provider value={agentActivity}>
        {pane}
      </AgentActivityContext.Provider>
    </CardDraftsContext.Provider>
  );
}

interface CardProps {
  comment: CommentJSON;
  selected: boolean;
  onSelect: (id: string) => void;
  onDeselect?: () => void;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onOpenDetail: (id: string) => void;
}

/** One anchored comment as a list entry (#253/#298). Non-selected cards stay
 *  read-only and low (#304: 3-line clamp, replies collapsed to a count) so
 *  neighbouring cards aren't pushed down the rail. #308: the *selected* card
 *  additionally gets the reply/resolve/edit/delete row and full reply bodies
 *  that #304 removed without relocating — restored here instead of in a
 *  popover (#304 deliberately removed CommentThreadPopover; operations live
 *  in the card now). */
/** The nearest ancestor that scrolls its content vertically, if any. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      p.scrollHeight > p.clientHeight
    ) {
      return p;
    }
  }
  return null;
}

/** #364: opening a card scrolls its scroller to the latest reply — that is
 *  what the reader opened the thread to see. The reply's top lands just under
 *  the card's sticky header row, so a long reply reads from its start. Runs
 *  once per opening (not on every new reply), a frame late so the rail has
 *  placed and clamped the now-taller card first. */
function useRevealLatestReply(
  cardRef: MutableRefObject<HTMLDivElement | null>,
  selected: boolean
) {
  useEffect(() => {
    if (!selected) return;
    const raf = requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      const all = card.querySelectorAll<HTMLElement>('[data-testid="comment-reply"]');
      const latest = all[all.length - 1];
      const scroller = latest && scrollParent(card);
      if (!latest || !scroller) return;
      const header = card.firstElementChild as HTMLElement | null;
      const offset =
        latest.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        (header?.offsetHeight ?? 0);
      scroller.scrollTop += offset;
    });
    return () => cancelAnimationFrame(raf);
  }, [selected, cardRef]);
}

function CommentCard({
  comment: c,
  selected,
  onSelect,
  onDeselect,
  onCopyLink,
  canCopyLink = true,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onOpenDetail,
}: CardProps) {
  const badge = SCOPE_BADGE[c.scope];
  const replies = c.replies?.length ?? 0;
  const resolved = c.status === "resolved";
  const aiOwned = isAiAuthored(c.author);
  const agentActivity = useContext(AgentActivityContext);
  const newAiReplies = agentActivity.newReplies.get(c.id) ?? 0;
  // #366: only the comments the send handed over are being answered. One
  // written after it says so instead, or it would wait on a reply that the
  // AI, which never read it, is not writing.
  const sentToAi = agentActivity.sentIds?.has(c.id) ?? false;
  const awaitingAi = agentActivity.replying && sentToAi && !resolved;
  const unsentToAi = agentActivity.replying && !sentToAi && !resolved;

  const [{ replyOpen, replyBody, editOpen, editBody }, updateDraft] = useCardDraft(c.id);
  // #334: focus a form only when the reader opens it. A draft's form also
  // reappears when the card remounts (scroll, mode switch), and autoFocus there
  // would pull focus out of the editor mid-sentence into this field.
  const [focusForm, setFocusForm] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useRevealLatestReply(cardRef, selected);

  const submitReply = () => {
    const body = replyBody.trim();
    if (!body) return;
    onReply(c.id, body);
    updateDraft({ replyBody: "", replyOpen: false });
  };

  const startEdit = () => {
    updateDraft({ editBody: c.body, editOpen: true });
    setFocusForm(true);
  };

  const submitEdit = () => {
    const body = editBody.trim();
    if (!body || body === c.body) {
      updateDraft({ editOpen: false });
      return;
    }
    onEdit(c.id, body);
    updateDraft({ editOpen: false });
  };

  return (
    <Box
      ref={cardRef}
      role="button"
      tabIndex={0}
      data-testid="comment-item"
      data-comment-id={c.id}
      data-comment-status={c.status}
      data-selected={String(selected)}
      onClick={() => onSelect(c.id)}
      onKeyDown={(e) => {
        // #330: Enter/Space on a control inside the card (the body toggle,
        // the link-copy button) belongs to that control — preventDefault here
        // would cancel its own activation and select the card instead.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(c.id);
        }
      }}
      sx={{
        px: 1.5,
        py: 1.25,
        cursor: "pointer",
        borderBottom: "1px solid",
        borderColor: "divider",
        // The open thread's entry stays marked, so the list and the editor
        // agree on what is being looked at.
        borderLeft: "3px solid",
        borderLeftColor: selected ? "primary.main" : "transparent",
        bgcolor: selected ? "action.selected" : undefined,
        opacity: resolved ? 0.6 : 1,
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
      }}
    >
      <Box
        sx={[
          { display: "flex", alignItems: "center", gap: 1, mb: 0.5 },
          // #364: only an open card is tall enough to scroll; a closed one's
          // pinned row would keep the paper colour while the card hovers.
          selected && stickyRowSx("top", true),
        ]}
      >
        {/* #364: the card's open state, made explicit. Selecting a card was the
            only way to open it and there was no way back short of picking
            another one; ∨ opens, ∧ closes. */}
        <Tooltip title={selected ? "閉じる" : "開く"}>
          <span>
            <IconButton
              size="small"
              disabled={selected && !onDeselect}
              onClick={(e) => {
                e.stopPropagation();
                if (selected) onDeselect?.();
                else onSelect(c.id);
              }}
              aria-label={selected ? "close comment" : "open comment"}
              aria-expanded={selected}
              data-testid="comment-toggle"
              sx={{ p: 0.25, ml: -0.75 }}
            >
              {selected ? (
                <ExpandLessIcon sx={{ fontSize: CARD_ICON_SIZE + 2 }} />
              ) : (
                <ExpandMoreIcon sx={{ fontSize: CARD_ICON_SIZE + 2 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <CommentId id={c.id} />
        {/* #364: the badge alone (name on hover). The date and the context
            line live in the detail dialog only, to keep every card low. */}
        <CommentAuthor author={c.author} showName={false} />
        <Box sx={{ flexGrow: 1 }} />
        {badge && (
          <Chip
            label={badge.label}
            size="small"
            sx={{
              height: 18,
              fontSize: "0.65rem",
              bgcolor: badge.color,
              "& .MuiChip-label": { px: 0.75 },
            }}
            data-testid={`comment-scope-${c.scope}`}
          />
        )}
        {resolved && (
          <Chip
            label="resolved"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-status-resolved"
          />
        )}
        {newAiReplies > 0 && (
          <Chip
            label={`新着 ${newAiReplies}`}
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-new-ai-replies"
          />
        )}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            ...ACTION_HOVER_SX,
          }}
        >
          {/* #364: reply / resolve / detail sit in the header on every card, so
            a non-selected card can be acted on without opening it first and
            the selected card no longer needs a row of its own for them. */}
          <Tooltip title={resolved ? "解決済みのため返信できません" : "返信を追加"}>
            <span>
              <IconButton
                size="small"
                disabled={resolved}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!selected) onSelect(c.id);
                  updateDraft({ replyOpen: selected ? !replyOpen : true });
                  setFocusForm(true);
                }}
                aria-label="reply to comment"
                data-testid="comment-reply-toggle"
                sx={{ p: 0.25 }}
              >
                <ReplyIcon sx={{ fontSize: CARD_ICON_SIZE }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={resolved ? "未解決に戻す" : "解決済みにする"}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onResolveToggle(c.id, resolved ? "open" : "resolved");
              }}
              aria-label={resolved ? "reopen comment" : "resolve comment"}
              data-testid="comment-resolve-toggle"
              sx={{ p: 0.25 }}
            >
              {resolved ? (
                <ReplayIcon sx={{ fontSize: CARD_ICON_SIZE }} />
              ) : (
                <CheckCircleOutlineIcon sx={{ fontSize: CARD_ICON_SIZE }} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title="詳細を中央に開く">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(c.id);
              }}
              aria-label="open comment detail"
              data-testid="comment-open-detail"
              sx={{ p: 0.25 }}
            >
              <OpenInFullIcon sx={{ fontSize: CARD_ICON_SIZE }} />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={
              canCopyLink
                ? "リンクをコピー"
                : "ファイルが開かれていないためコピーできません"
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={!canCopyLink}
                // The row itself opens the thread; this button must not.
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyLink(c.id);
                }}
                aria-label="copy comment link"
                data-testid="comment-copy-link"
                sx={{ p: 0.25 }}
              >
                <LinkIcon sx={{ fontSize: CARD_ICON_SIZE }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* #364: the selected card's own comment gets the same bar as its
          replies (author, edit / delete on the right), so the first
          entry of the thread reads and acts like the ones under it. */}
      {selected && (
        <ThreadEntryHeader author={c.author} testid="comment-main-header">
          {!editOpen && (
            <>
              <Tooltip
                title={
                  aiOwned
                    ? "AI のコメントは編集できません"
                    : resolved
                      ? "解決済みのため編集できません"
                      : "コメントを編集"
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={resolved || aiOwned}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit();
                    }}
                    aria-label="edit comment"
                    data-testid="comment-edit"
                    sx={{ p: 0.25 }}
                  >
                    <EditOutlinedIcon sx={{ fontSize: CARD_ICON_SIZE }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip
                title={aiOwned ? "AI のコメントは削除できません" : "コメントを削除"}
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={aiOwned}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    aria-label="delete comment"
                    data-testid="comment-delete"
                    sx={{ p: 0.25 }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: CARD_ICON_SIZE }} />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        </ThreadEntryHeader>
      )}

      {selected && editOpen && !resolved ? (
        <Box sx={{ mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
          <TextField
            value={editBody}
            onChange={(e) => updateDraft({ editBody: e.target.value })}
            multiline
            minRows={2}
            maxRows={RAIL_FIELD_MAX_ROWS}
            fullWidth
            size="small"
            autoFocus={focusForm}
            inputProps={{ "data-testid": "comment-edit-input" }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
            <Button size="small" onClick={() => updateDraft({ editOpen: false })}>
              キャンセル
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitEdit}
              disabled={!editBody.trim()}
              data-testid="comment-edit-submit"
            >
              更新
            </Button>
          </Box>
        </Box>
      ) : (
        <CollapsibleText
          text={c.body}
          testid="comment-body"
          sx={{ mt: 0.5, wordBreak: "break-word" }}
          // #304: clamp to ~2 lines instead of the pinned section's 6 — with
          // list mode gone, every anchored comment renders as this card, so a
          // tall body pushes its neighbours further down the rail. #330: judged
          // by rendered height (a short source still wraps tall in this
          // narrow column), and the selected card shows its body in full.
          clampHeight="3em"
          measureOverflow
          clampDisabled={selected}
          stickyToggle
        />
      )}

      {selected ? (
        <>
          {replies > 0 && c.replies && (
            <Box sx={{ mt: 1 }}>
              {c.replies.map((r, i) => (
                <ReplyRow
                  key={i}
                  reply={r}
                  index={i}
                  commentId={c.id}
                  resolved={resolved}
                  collapsible
                  onEditReply={onEditReply}
                  onDeleteReply={onDeleteReply}
                />
              ))}
            </Box>
          )}

          {replyOpen && !resolved && (
            <Box sx={{ mt: 1 }} onClick={(e) => e.stopPropagation()}>
              <TextField
                value={replyBody}
                onChange={(e) => updateDraft({ replyBody: e.target.value })}
                placeholder="返信を入力"
                multiline
                minRows={2}
                maxRows={RAIL_FIELD_MAX_ROWS}
                fullWidth
                size="small"
                autoFocus={focusForm}
                inputProps={{ "data-testid": "comment-reply-input" }}
              />
              <Box
                sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}
              >
                <Button size="small" onClick={() => updateDraft({ replyOpen: false })}>
                  キャンセル
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={submitReply}
                  disabled={!replyBody.trim()}
                  data-testid="comment-reply-submit"
                >
                  返信
                </Button>
              </Box>
            </Box>
          )}
        </>
      ) : (
        replies > 0 && c.replies && <ReplyPreview replies={c.replies} />
      )}

      {awaitingAi && (
        <Typography
          variant="caption"
          data-testid="comment-awaiting-ai"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            mt: 0.75,
            pl: 1,
            borderLeft: "2px solid",
            borderColor: "warning.main",
            color: "warning.main",
          }}
        >
          <Box
            component="span"
            sx={[
              { width: 6, height: 6, borderRadius: "50%", bgcolor: "warning.main" },
              pulseSx,
            ]}
          />
          AI が確認中
        </Typography>
      )}
      {unsentToAi && (
        <Typography
          variant="caption"
          data-testid="comment-unsent-to-ai"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            mt: 0.75,
            pl: 1,
            borderLeft: "2px solid",
            borderColor: "divider",
            color: "text.secondary",
          }}
        >
          <Box
            component="span"
            sx={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              border: "1px solid",
              borderColor: "text.secondary",
            }}
          />
          未送信（次の送信で AI に届く）
        </Typography>
      )}
    </Box>
  );
}

/** #364: a non-selected card shows its latest replies one line each (body
 *  ellipsised), instead of only a count, so the thread's state reads without
 *  opening the card. Older replies collapse into "ほか N 件". */
function ReplyPreview({ replies }: { replies: ReadonlyArray<CommentReply> }) {
  const shown = replies.slice(-REPLY_PREVIEW_COUNT);
  const rest = replies.length - shown.length;
  return (
    <Box data-testid="comment-reply-preview" sx={{ mt: 0.75 }}>
      {rest > 0 && (
        <Typography
          variant="caption"
          color="text.disabled"
          data-testid="comment-reply-rest"
          sx={{ display: "block" }}
        >
          ほか {rest} 件
        </Typography>
      )}
      {shown.map((r, i) => (
        <Box
          key={rest + i}
          data-testid="comment-reply-preview-row"
          sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
        >
          <CommentAuthor author={r.author} showName={false} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.body.replace(/\s+/g, " ")}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

interface CommentListProps extends Omit<CardProps, "comment" | "selected"> {
  comments: ReadonlyArray<CommentJSON>;
  selectedId: string | null;
}

/** #333: every anchored card in document order, scrolling inside the pane —
 *  nothing is pushed to an "上に / 下に N 件" count, so a dense document can
 *  be read in one pass. Selecting a highlight in the editor scrolls its card
 *  into view here, the way the aligned rail brings it level. */
function CommentList({ comments, selectedId, ...cardProps }: CommentListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const card = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-testid="comment-item"]') ?? []
    ).find((el) => el.dataset.commentId === selectedId);
    card?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <Box
      ref={listRef}
      data-testid="comment-list"
      sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}
    >
      {comments.map((c) => (
        <CommentCard
          key={c.id}
          comment={c}
          selected={c.id === selectedId}
          {...cardProps}
        />
      ))}
    </Box>
  );
}

interface AlignedRailProps {
  /** Anchored comments (no global/orphan), in document order. */
  comments: ReadonlyArray<CommentJSON>;
  anchorTops: Readonly<Record<string, number>>;
  docBox: DocBox | null;
  onOverhangChange?: (px: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect?: () => void;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onOpenDetail: (id: string) => void;
  /** #332: show a count icon per line instead of each non-selected card. */
  iconMode?: boolean;
  revealRef?: MutableRefObject<RailReveal | null>;
}

/** Lays anchored cards out down the rail, level with the paragraph each is
 *  attached to (#298). The arithmetic lives in commentRailLayout.ts (pure,
 *  unit-tested); this component only measures the DOM and feeds it in. */
function AlignedCommentRail({
  comments,
  anchorTops,
  docBox,
  onOverhangChange,
  selectedId,
  onSelect,
  onDeselect,
  onCopyLink,
  canCopyLink = true,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onOpenDetail,
  iconMode = false,
  revealRef,
}: AlignedRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [paneBox, setPaneBox] = useState({ top: 0, height: 0, measured: false });
  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const rafRef = useRef<number | null>(null);

  const scheduleMeasurePane = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const rect = railRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPaneBox((prev) =>
        prev.measured && prev.top === rect.top && prev.height === rect.height
          ? prev
          : { top: rect.top, height: rect.height, measured: true }
      );
    });
  }, []);

  // Comments changing (add/delete/filter) and anchorTops changing (scroll,
  // resize, doc edits — all measured by the caller) both mean the pane's own
  // box may have shifted too (e.g. the pinned section above it grew).
  useEffect(() => {
    scheduleMeasurePane();
  }, [comments.length, anchorTops, scheduleMeasurePane]);

  useEffect(() => {
    window.addEventListener("resize", scheduleMeasurePane);
    return () => window.removeEventListener("resize", scheduleMeasurePane);
  }, [scheduleMeasurePane]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const handleHeightChange = useCallback((id: string, height: number) => {
    setCardHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  // #332: a newly selected comment's cached height may be stale — measured
  // when it was last a card (say, with its reply form open), before icon mode
  // turned it back into an icon. Laid out by that height it would push the
  // entries below it out of place until its first measurement lands. Forget
  // it on selection so the card is placed at the default height and measured
  // afresh. Done during render (React's derived-state pattern) so the stale
  // value never reaches layout.
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    if (iconMode && selectedId && Object.hasOwn(cardHeights, selectedId)) {
      setCardHeights((prev) => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
    }
  }

  // #332: an icon opened from the keyboard is replaced by its card, taking
  // the focused element with it. Hand focus to the card once it mounts.
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const selectFromIcon = useCallback(
    (id: string) => {
      setFocusCardId(id);
      onSelect(id);
    },
    [onSelect]
  );
  const clearFocusCard = useCallback(() => setFocusCardId(null), []);

  // One rail entry per card, or (#332 icon mode) per run of same-line
  // comments behind one icon. Everything below lays out and counts entries,
  // then maps back to comments through `ids`.
  const entries: IconRailEntry[] = useMemo(
    () =>
      iconMode
        ? groupIconRailEntries(
            comments.map((c) => c.id),
            anchorTops,
            selectedId
          )
        : comments.map((c) => ({
            kind: "card" as const,
            key: c.id,
            ids: [c.id] as [string],
          })),
    [iconMode, comments, anchorTops, selectedId]
  );
  const entryByKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);

  const items: RailItem[] = useMemo(
    () =>
      entries.map((e, i) => ({
        id: e.key,
        // `comments` here is already the anchored subset (no global/orphan).
        // #326: a resolved comment paints no persistent decoration by design
        // (CommentHighlight's buildDeco skips `status === "resolved"`), and
        // the caller used to measure decorations only — so resolved cards
        // never got an entry and the old `?? 0` fallback stacked them all at
        // the rail's top. The caller now measures a resolved comment from its
        // anchors instead (EditorPage's anchorViewportTop), so a missing
        // entry means the same thing it means for an open comment: not
        // measured yet. Both take the `null` path below.
        //
        // A missing lookup only means the caller
        // hasn't measured this frame's decoration yet (editor not mounted,
        // decoration not rendered on this render pass, or the comment list
        // just changed and a fresh measurement hasn't landed). #306: falling
        // back to 0 there used to plant the card at the rail's very top — in
        // front of whatever paragraph the reader is actually looking at —
        // and it stayed there because nothing else re-triggered a
        // measurement. `null` reads as "no live anchor" to
        // layoutCommentRail, which leaves the card unplaced rather than
        // misplacing it; it reappears once the caller's measurement produces
        // a real entry.
        anchorTop: Object.hasOwn(anchorTops, e.ids[0]) ? anchorTops[e.ids[0]] : null,
        height:
          e.kind === "icon"
            ? RAIL_ICON_HEIGHT
            : (cardHeights[e.key] ?? RAIL_DEFAULT_CARD_HEIGHT),
        order: i,
      })),
    [entries, anchorTops, cardHeights]
  );

  // #338: cards move with the body, so nothing pins the first one to the
  // pane's top edge any more. Where the rail starts lower than the document
  // does (the global-comment badge row above it), a card for the document's
  // first lines would sit partly above the pane even at scrollTop 0, its
  // header cut off for good. Start the stack no higher than the document's
  // top plus that difference, measured at rest so it scrolls with the body.
  const minTop =
    docBox === null
      ? undefined
      : docBox.top +
        Math.max(0, paneBox.top - (docBox.top + docBox.scrollTop)) -
        paneBox.top;
  const layout = useMemo(
    () => layoutCommentRail(items, { paneTop: paneBox.top, minTop }),
    [items, paneBox.top, minTop]
  );

  // #338: how far the rail reaches past the document's end. Both edges come
  // from the same measurement pass (anchorTops and docBox move together on
  // scroll), so the difference holds still while the body scrolls and only
  // changes when a card or the document changes height.
  const overhang =
    layout.bottom === null || docBox === null
      ? 0
      : Math.max(0, Math.ceil(paneBox.top + layout.bottom + RAIL_GAP - docBox.bottom));
  useEffect(() => {
    onOverhangChange?.(overhang);
  }, [overhang, onOverhangChange]);

  // #339: hand the caller the current layout's answer to "where must this
  // card's highlight go for the card to stay in view". A comment folded into
  // an icon (#332) is looked up by its entry, which shares its line.
  useEffect(() => {
    if (!revealRef) return;
    revealRef.current = (id) => {
      if (!paneBox.measured) return undefined;
      if (paneBox.height <= 0) return null;
      const key = entries.find((e) => e.ids.includes(id))?.key;
      const placed = layout.placed.find((p) => p.id === key);
      // Not measured or placed yet: the next layout pass may still bring it.
      if (!placed || !Object.hasOwn(anchorTops, id)) return undefined;
      const anchorRel = anchorTops[id] - paneBox.top;
      return anchorRel - revealAnchorTop(placed, anchorRel, paneBox.height);
    };
    return () => {
      revealRef.current = null;
    };
  }, [revealRef, entries, layout, anchorTops, paneBox]);
  useEffect(() => () => onOverhangChange?.(0), [onOverhangChange]);

  const byId = useMemo(() => new Map(comments.map((c) => [c.id, c])), [comments]);

  return (
    <Box
      ref={railRef}
      sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}
      data-testid="comment-rail-aligned"
    >
      {layout.placed.map((placed) => {
        const entry = entryByKey.get(placed.id);
        // Until the pane has measured its own box (height 0) there is no
        // visible range to test against; the pane clips anything outside it.
        const hidden = paneBox.height > 0 && !isPlacedInPane(placed, paneBox.height);
        if (entry?.kind === "icon") {
          const members = entry.ids.flatMap((id) => byId.get(id) ?? []);
          if (members.length === 0) return null;
          return (
            <AlignedIcon
              key={entry.key}
              comments={members}
              top={placed.top}
              hidden={hidden}
              onSelect={selectFromIcon}
            />
          );
        }
        const c = byId.get(placed.id);
        if (!c) return null;
        return (
          <AlignedCard
            key={c.id}
            comment={c}
            top={placed.top}
            maxHeight={placed.maxHeight}
            hidden={hidden}
            selected={c.id === selectedId}
            onSelect={onSelect}
            onDeselect={onDeselect}
            onCopyLink={onCopyLink}
            canCopyLink={canCopyLink}
            onDelete={onDelete}
            onResolveToggle={onResolveToggle}
            onReply={onReply}
            onEdit={onEdit}
            onEditReply={onEditReply}
            onDeleteReply={onDeleteReply}
            onOpenDetail={onOpenDetail}
            onHeightChange={handleHeightChange}
            focusOnMount={c.id === focusCardId}
            onFocused={clearFocusCard}
          />
        );
      })}
    </Box>
  );
}

interface AlignedCardProps extends CardProps {
  top: number;
  maxHeight: number;
  /** Outside the pane's visible range (#338): still mounted and measured,
   *  but invisible and out of the tab order. */
  hidden?: boolean;
  onHeightChange: (id: string, height: number) => void;
  /** Take focus once mounted (#332: opened from an icon). */
  focusOnMount?: boolean;
  onFocused?: () => void;
}

/** One card, absolutely positioned at the top the layout gave it. Its own
 *  height feeds back into the layout via ResizeObserver — a reply/edit form
 *  opening inside it, or a body's "続きを表示" toggle, changes the height the
 *  next card has to stack below. */
function AlignedCard({
  comment,
  top,
  maxHeight,
  hidden = false,
  onHeightChange,
  focusOnMount = false,
  onFocused,
  ...cardProps
}: AlignedCardProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focusOnMount) return;
    contentRef.current
      ?.querySelector<HTMLElement>('[data-testid="comment-item"]')
      ?.focus();
    onFocused?.();
  }, [focusOnMount, onFocused]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) onHeightChange(comment.id, h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [comment.id, onHeightChange]);

  return (
    <Box
      data-testid="comment-rail-card"
      data-comment-id={comment.id}
      sx={{
        position: "absolute",
        left: 8,
        right: 8,
        top,
        maxHeight,
        visibility: hidden ? "hidden" : undefined,
        overflow: maxHeight > 0 ? "auto" : "hidden",
        // A card floating in whitespace needs its own edge, and the list's
        // bottom rule (CommentCard's row separator) reads as a stray line
        // once rows are no longer stacked against each other.
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        "& [data-testid=comment-item]": { borderBottom: "none" },
      }}
    >
      {/* The observed element is the content, never the shell: the shell's
          own height is what `maxHeight` clamps, so observing it would feed
          the clamp back into the measurement and collapse the card to its
          border (measured: it converged to 2px). */}
      <Box ref={contentRef}>
        <CommentCard comment={comment} {...cardProps} />
      </Box>
    </Box>
  );
}

/** First characters of a comment body for the icon's hover preview — the
 *  raw source, whitespace collapsed (Markdown syntax left as typed). */
function previewLine(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > ICON_PREVIEW_CHARS
    ? `${flat.slice(0, ICON_PREVIEW_CHARS)}…`
    : flat;
}

/** #332: one small icon standing for the comments anchored on one line,
 *  absolutely positioned like a card. Hover previews each body's opening;
 *  clicking selects the first, which then opens as a full card in its place
 *  (the rest stay behind a smaller icon). */
function AlignedIcon({
  comments,
  top,
  hidden = false,
  onSelect,
}: {
  comments: ReadonlyArray<CommentJSON>;
  top: number;
  /** Outside the pane's visible range (#338). */
  hidden?: boolean;
  onSelect: (id: string) => void;
}) {
  const first = comments[0];
  return (
    <Tooltip
      placement="left"
      title={
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {comments.map((c) => (
            <li key={c.id}>
              {c.id}: {previewLine(c.body)}
            </li>
          ))}
        </Box>
      }
    >
      <Box
        component="button"
        type="button"
        data-testid="comment-rail-icon"
        data-comment-ids={comments.map((c) => c.id).join(" ")}
        aria-label={`コメント ${comments.length} 件を開く`}
        onClick={() => onSelect(first.id)}
        sx={{
          position: "absolute",
          left: 8,
          top,
          visibility: hidden ? "hidden" : undefined,
          height: RAIL_ICON_HEIGHT,
          boxSizing: "border-box",
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          color: "text.secondary",
          font: "inherit",
          fontSize: "0.75rem",
          cursor: "pointer",
          opacity: comments.every((c) => c.status === "resolved") ? 0.6 : 1,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />
        {comments.length}
      </Box>
    </Tooltip>
  );
}

export interface CommentRowProps {
  comment: CommentJSON;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onJump: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
  /** #316: the global/orphan dialog already IS a centered view, so it hides
   *  this button instead of offering one that opens a dialog over a dialog. */
  showDetail?: boolean;
  /** #226: the row a `?comment_id=` link pointed at. */
  selected?: boolean;
}

export function CommentRow({
  comment: c,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onJump,
  onOpenDetail,
  onCopyLink,
  canCopyLink = true,
  showDetail = true,
  selected = false,
}: CommentRowProps) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(c.body);
  const ctx = contextLabel(c);
  const badge = SCOPE_BADGE[c.scope];
  const resolved = c.status === "resolved";
  const canJump = c.scope !== "global" && !c.orphan;
  const aiOwned = isAiAuthored(c.author);

  const submitReply = () => {
    const body = replyBody.trim();
    if (!body) return;
    onReply(c.id, body);
    setReplyBody("");
    setReplyOpen(false);
  };

  const startEdit = () => {
    setEditBody(c.body);
    setEditOpen(true);
  };

  const submitEdit = () => {
    const body = editBody.trim();
    if (!body || body === c.body) {
      setEditOpen(false);
      return;
    }
    onEdit(c.id, body);
    setEditOpen(false);
  };

  return (
    <Box
      data-testid="comment-item"
      data-comment-id={c.id}
      data-comment-status={c.status}
      data-selected={selected ? "true" : undefined}
      sx={{
        p: 1.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        opacity: resolved ? 0.6 : 1,
        bgcolor: selected ? "action.selected" : undefined,
      }}
    >
      <Box
        data-testid="comment-header"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 0.75,
          mx: -1.5,
          mt: -1.5,
          px: 1.5,
          py: 0.75,
          bgcolor: "action.hover",
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 3,
            alignSelf: "stretch",
            borderRadius: 1,
            bgcolor: "primary.main",
            flexShrink: 0,
          }}
        />
        <CommentId id={c.id} />
        {selected && (
          <Chip
            label="リンク先"
            size="small"
            color="primary"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-linked-badge"
          />
        )}
        {badge && (
          <Chip
            label={badge.label}
            size="small"
            sx={{
              height: 18,
              fontSize: "0.65rem",
              bgcolor: badge.color,
              "& .MuiChip-label": { px: 0.75 },
            }}
            data-testid={`comment-scope-${c.scope}`}
          />
        )}
        {resolved && (
          <Chip
            label="resolved"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-status-resolved"
          />
        )}
        {c.orphan && (
          <Chip
            label="orphan"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-orphan"
          />
        )}
        <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
          {c.author || "?"}
        </Typography>
        {c.date && (
          <Typography variant="caption" color="text.secondary">
            · {c.date}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {!editOpen && (
          <>
            <Tooltip
              title={
                aiOwned
                  ? "AI のコメントは編集できません"
                  : resolved
                    ? "解決済みのため編集できません"
                    : "コメントを編集"
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={resolved || aiOwned}
                  onClick={startEdit}
                  aria-label="edit comment"
                  data-testid="comment-edit"
                  sx={{ p: 0.25 }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={aiOwned ? "AI のコメントは削除できません" : "コメントを削除"}>
              <span>
                <IconButton
                  size="small"
                  disabled={aiOwned}
                  onClick={() => onDelete(c.id)}
                  aria-label="delete comment"
                  data-testid="comment-delete"
                  sx={{ p: 0.25 }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Box>

      {ctx && (
        <Typography
          variant="caption"
          color="text.secondary"
          onClick={canJump ? () => onJump(c.id) : undefined}
          data-testid={`comment-context-${c.id}`}
          sx={{
            display: "block",
            fontStyle: "italic",
            wordBreak: "break-word",
            cursor: canJump ? "pointer" : "default",
            "&:hover": canJump ? { textDecoration: "underline" } : undefined,
          }}
        >
          対象: {ctx}
        </Typography>
      )}

      {editOpen && !resolved ? (
        <Box sx={{ mt: 0.5 }}>
          <TextField
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            multiline
            minRows={2}
            maxRows={RAIL_FIELD_MAX_ROWS}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ "data-testid": "comment-edit-input" }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
            <Button size="small" onClick={() => setEditOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitEdit}
              disabled={!editBody.trim()}
              data-testid="comment-edit-submit"
            >
              更新
            </Button>
          </Box>
        </Box>
      ) : (
        <CollapsibleText
          text={c.body}
          testid="comment-body"
          sx={{ mt: 0.5, wordBreak: "break-word" }}
        />
      )}

      {c.replies && c.replies.length > 0 && (
        <Box sx={{ mt: 1, pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
          {c.replies.map((r, i) => (
            <ReplyRow
              key={i}
              reply={r}
              index={i}
              commentId={c.id}
              resolved={resolved}
              collapsible
              onEditReply={onEditReply}
              onDeleteReply={onDeleteReply}
            />
          ))}
        </Box>
      )}

      {replyOpen && !resolved && (
        <Box sx={{ mt: 1 }}>
          <TextField
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="返信を入力"
            multiline
            minRows={2}
            maxRows={RAIL_FIELD_MAX_ROWS}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ "data-testid": "comment-reply-input" }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
            <Button size="small" onClick={() => setReplyOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitReply}
              disabled={!replyBody.trim()}
              data-testid="comment-reply-submit"
            >
              返信
            </Button>
          </Box>
        </Box>
      )}

      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Tooltip title={resolved ? "解決済みのため返信できません" : "返信を追加"}>
          <span>
            <IconButton
              size="small"
              disabled={resolved}
              onClick={() => setReplyOpen((v) => !v)}
              aria-label="reply to comment"
              data-testid="comment-reply-toggle"
            >
              <ReplyIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={resolved ? "未解決に戻す" : "解決済みにする"}>
          <IconButton
            size="small"
            onClick={() => onResolveToggle(c.id, resolved ? "open" : "resolved")}
            aria-label={resolved ? "reopen comment" : "resolve comment"}
            data-testid="comment-resolve-toggle"
          >
            {resolved ? (
              <ReplayIcon fontSize="small" />
            ) : (
              <CheckCircleOutlineIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {showDetail && (
          <Tooltip title="詳細を中央に開く">
            <IconButton
              size="small"
              onClick={() => onOpenDetail(c.id)}
              aria-label="open comment detail"
              data-testid="comment-open-detail"
            >
              <OpenInFullIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip
          title={
            canCopyLink
              ? "リンクをコピー"
              : "ファイルが開かれていないためコピーできません"
          }
        >
          <span>
            <IconButton
              size="small"
              disabled={!canCopyLink}
              onClick={() => onCopyLink(c.id)}
              aria-label="copy comment link"
              data-testid="comment-copy-link"
            >
              <LinkIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

interface ReplyRowProps {
  reply: CommentReply;
  /** 0-based position of this reply under its comment (the address the API uses). */
  index: number;
  commentId: string;
  /** A resolved comment is read-only, so its replies can't be edited/deleted. */
  resolved: boolean;
  /** Side-pane rows collapse long bodies; the detail dialog shows them in full. */
  collapsible: boolean;
  /** Test id for the row container (defaults to the side-pane reply id). */
  outerTestid?: string;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
}

/** One threaded reply with its own inline edit form + edit/delete toolbar, so
 *  each reply is operable individually (not just the top-level comment). */
/** The bar above one entry of a thread: author badge, date, and that entry's own
 *  actions on the right. Replies have always had it; #364 gives the selected
 *  card's comment the same bar so the thread's first entry matches the rest.
 *  The date is left out in the narrow side pane (it wraps there) and shown in
 *  the detail dialog. */
function ThreadEntryHeader({
  author,
  date,
  testid,
  children,
}: {
  author?: string;
  date?: string;
  testid: string;
  children?: React.ReactNode;
}) {
  return (
    <Box
      data-testid={testid}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1,
        // #364: as low as the card's header row. The Tooltip spans are inline
        // and would add a line box's height around each 14px icon button.
        py: 0.125,
        mb: 0.25,
        borderRadius: 1,
        bgcolor: "action.hover",
        "& > span": { display: "inline-flex" },
        ...ACTION_HOVER_SX,
      }}
    >
      {/* #364: the author is the badge alone (name on hover), and the badge's
          colour replaces the stripe that used to lead the bar. */}
      <CommentAuthor author={author} showName={false} />
      {date && (
        <Typography variant="caption" color="text.secondary">
          · {date}
        </Typography>
      )}
      <Box sx={{ flexGrow: 1 }} />
      {children}
    </Box>
  );
}

function ReplyRow({
  reply: r,
  index,
  commentId,
  resolved,
  collapsible,
  outerTestid = "comment-reply",
  onEditReply,
  onDeleteReply,
}: ReplyRowProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(r.body);
  const aiOwned = isAiAuthored(r.author);

  const startEdit = () => {
    setEditBody(r.body);
    setEditOpen(true);
  };
  const submitEdit = () => {
    const body = editBody.trim();
    if (!body || body === r.body) {
      setEditOpen(false);
      return;
    }
    onEditReply(commentId, index, body);
    setEditOpen(false);
  };

  // Only the side-pane thread row uses the shared "comment-reply-header"
  // testid; the detail dialog's copy of this row gets its own name so the
  // two can never collide when both render at once (comment open in detail
  // view while its thread is also visible in the side pane).
  const headerTestid =
    outerTestid === "comment-reply"
      ? "comment-reply-header"
      : "comment-detail-reply-header";

  return (
    <Box sx={{ mb: 0.5 }} data-testid={outerTestid}>
      <ThreadEntryHeader
        author={r.author}
        date={outerTestid === "comment-reply" ? undefined : r.date}
        testid={headerTestid}
      >
        {!editOpen && (
          <>
            <Tooltip
              title={
                aiOwned
                  ? "AI の返信は編集できません"
                  : resolved
                    ? "解決済みのため編集できません"
                    : "返信を編集"
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={resolved || aiOwned}
                  onClick={startEdit}
                  aria-label="edit reply"
                  data-testid="comment-reply-edit"
                  sx={{ p: 0.25 }}
                >
                  <EditOutlinedIcon sx={{ fontSize: CARD_ICON_SIZE }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip
              title={
                aiOwned
                  ? "AI の返信は削除できません"
                  : resolved
                    ? "解決済みのため削除できません"
                    : "返信を削除"
              }
            >
              <span>
                <IconButton
                  size="small"
                  disabled={resolved || aiOwned}
                  onClick={() => onDeleteReply(commentId, index)}
                  aria-label="delete reply"
                  data-testid="comment-reply-delete"
                  sx={{ p: 0.25 }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: CARD_ICON_SIZE }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </ThreadEntryHeader>

      {editOpen && !resolved ? (
        <Box>
          <TextField
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            multiline
            minRows={2}
            maxRows={RAIL_FIELD_MAX_ROWS}
            fullWidth
            size="small"
            autoFocus
            inputProps={{ "data-testid": "comment-reply-edit-input" }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
            <Button size="small" onClick={() => setEditOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitEdit}
              disabled={!editBody.trim()}
              data-testid="comment-reply-edit-submit"
            >
              更新
            </Button>
          </Box>
        </Box>
      ) : collapsible ? (
        <CollapsibleText
          text={r.body}
          testid="comment-reply-body"
          sx={{ wordBreak: "break-word" }}
        />
      ) : (
        <Typography
          variant="body2"
          component="div"
          sx={[{ wordBreak: "break-word" }, markdownBodySx]}
          data-testid="comment-detail-reply-body"
          // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
          dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(r.body) }}
        />
      )}
    </Box>
  );
}

export interface CommentDetailDialogProps {
  comment: CommentJSON | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
  onJump: (id: string) => void;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
}

/** A roomy, centered view of one comment: full target, body, the whole reply
 *  thread, and the same actions as the side-pane row. Opened from a row's
 *  "詳細" button; closes when the comment is deleted or jumped to. */
export function CommentDetailDialog({
  comment: c,
  onClose,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
  onJump,
  onCopyLink,
  canCopyLink = true,
}: CommentDetailDialogProps) {
  const [replyBody, setReplyBody] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState("");

  const open = c !== null;
  // Reset the inline forms whenever a different comment is shown.
  const shownId = c?.id ?? null;
  const [lastId, setLastId] = useState<string | null>(null);
  if (shownId !== lastId) {
    setLastId(shownId);
    setReplyBody("");
    setEditOpen(false);
    setEditBody(c?.body ?? "");
  }

  if (!c) {
    return <Dialog open={false} onClose={onClose} />;
  }

  const resolved = c.status === "resolved";
  const canJump = c.scope !== "global" && !c.orphan;
  const ctx = contextLabel(c);
  const badge = SCOPE_BADGE[c.scope];
  const aiOwned = isAiAuthored(c.author);

  const submitReply = () => {
    const body = replyBody.trim();
    if (!body) return;
    onReply(c.id, body);
    setReplyBody("");
  };
  const submitEdit = () => {
    const body = editBody.trim();
    if (body && body !== c.body) onEdit(c.id, body);
    setEditOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="comment-detail-dialog"
    >
      <DialogTitle
        data-testid="comment-detail-header"
        sx={{ display: "flex", alignItems: "center", gap: 1, bgcolor: "action.hover" }}
      >
        <Box
          aria-hidden
          sx={{
            width: 3,
            alignSelf: "stretch",
            borderRadius: 1,
            bgcolor: "primary.main",
            flexShrink: 0,
          }}
        />
        <CommentId id={c.id} />
        {badge && (
          <Chip
            label={badge.label}
            size="small"
            sx={{ height: 20, fontSize: "0.7rem", bgcolor: badge.color }}
          />
        )}
        {resolved && (
          <Chip
            label="resolved"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 20 }}
          />
        )}
        {c.orphan && (
          <Chip
            label="orphan"
            size="small"
            color="warning"
            variant="outlined"
            sx={{ height: 20 }}
          />
        )}
        <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
          {c.author || "?"}
        </Typography>
        {c.date && (
          <Typography variant="caption" color="text.secondary">
            · {c.date}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
      </DialogTitle>
      <DialogContent dividers>
        {ctx && (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid={`comment-detail-context-${c.id}`}
            onClick={canJump ? () => onJump(c.id) : undefined}
            sx={{
              fontStyle: "italic",
              wordBreak: "break-word",
              mb: 1,
              cursor: canJump ? "pointer" : "default",
              "&:hover": canJump ? { textDecoration: "underline" } : undefined,
            }}
          >
            対象: {ctx}
          </Typography>
        )}

        {editOpen && !resolved ? (
          <Box>
            <TextField
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              autoFocus
              inputProps={{ "data-testid": "comment-detail-edit-input" }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.5, mt: 0.5 }}>
              <Button size="small" onClick={() => setEditOpen(false)}>
                キャンセル
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={submitEdit}
                disabled={!editBody.trim()}
                data-testid="comment-detail-edit-submit"
              >
                更新
              </Button>
            </Box>
          </Box>
        ) : (
          <Typography
            variant="body1"
            component="div"
            sx={[{ wordBreak: "break-word" }, markdownBodySx]}
            // XSS-safe: see commentMarkdown.ts (html:false + unmodified validateLink()).
            dangerouslySetInnerHTML={{ __html: renderCommentMarkdown(c.body) }}
          />
        )}

        {c.replies && c.replies.length > 0 && (
          <Box sx={{ mt: 2, pl: 1.5, borderLeft: "3px solid", borderColor: "divider" }}>
            {c.replies.map((r, i) => (
              <ReplyRow
                key={i}
                reply={r}
                index={i}
                commentId={c.id}
                resolved={resolved}
                collapsible={false}
                outerTestid="comment-detail-reply"
                onEditReply={onEditReply}
                onDeleteReply={onDeleteReply}
              />
            ))}
          </Box>
        )}

        {!resolved && (
          <Box sx={{ mt: 2 }}>
            <TextField
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="返信を入力"
              multiline
              minRows={2}
              maxRows={RAIL_FIELD_MAX_ROWS}
              fullWidth
              size="small"
              inputProps={{ "data-testid": "comment-detail-reply-input" }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 0.5 }}>
              <Button
                size="small"
                variant="contained"
                onClick={submitReply}
                disabled={!replyBody.trim()}
                data-testid="comment-detail-reply-submit"
              >
                返信
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
        <Box>
          <Tooltip
            title={
              aiOwned
                ? "AI のコメントは編集できません"
                : resolved
                  ? "解決済みのため編集できません"
                  : "コメントを編集"
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={resolved || aiOwned}
                onClick={() => setEditOpen((v) => !v)}
                aria-label="edit comment"
                data-testid="comment-detail-edit"
              >
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={aiOwned ? "AI のコメントは削除できません" : "コメントを削除"}>
            <span>
              <IconButton
                size="small"
                disabled={aiOwned}
                onClick={() => onDelete(c.id)}
                aria-label="delete comment"
                data-testid="comment-detail-delete"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={
              canCopyLink
                ? "リンクをコピー"
                : "ファイルが開かれていないためコピーできません"
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={!canCopyLink}
                onClick={() => onCopyLink(c.id)}
                aria-label="copy comment link"
                data-testid="comment-detail-copy-link"
              >
                <LinkIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <Box>
          <Button
            size="small"
            startIcon={resolved ? <ReplayIcon /> : <CheckCircleOutlineIcon />}
            onClick={() => onResolveToggle(c.id, resolved ? "open" : "resolved")}
            data-testid="comment-detail-resolve-toggle"
          >
            {resolved ? "未解決に戻す" : "解決済みにする"}
          </Button>
          <Button size="small" onClick={onClose}>
            閉じる
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
