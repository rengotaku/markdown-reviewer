import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
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
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import AddCommentIcon from "@mui/icons-material/AddComment";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import ReplyIcon from "@mui/icons-material/Reply";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import RefreshIcon from "@mui/icons-material/Refresh";
import LinkIcon from "@mui/icons-material/Link";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import type { SxProps, Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";
import type { CommentJSON, CommentReply } from "@/api";
import { BAR_HEIGHT } from "@/theme/dimensions";
import { renderCommentMarkdown } from "@/utils/commentMarkdown";
import { buildCommentDeepLink } from "@/utils/deeplink";
import { useToast } from "@/hooks/useToast";
import { markdownBodySx } from "./markdownBodySx";
import { contextLabel } from "@/utils/commentContext";
import { isAiAuthored } from "@/utils/commentPresentation";
import { awaitsAiReply } from "@/utils/agentActivity";
import { CommentAuthor } from "./CommentAuthor";
import { CommentId } from "./CommentId";
import { GlobalCommentBadges, type GlobalBadgeKind } from "./GlobalCommentBadges";
import { StatusFilterToggle, type StatusFilter } from "./StatusFilterToggle";
import { GlobalCommentsDialog } from "./GlobalCommentsDialog";
import { AgentActivityContext, type AgentCardActivity } from "./agentActivityContext";
import { pulseSx } from "./pulseSx";

/** AI-authored comments/replies are read-only to the human reviewer: they can
 *  reply, resolve, and jump to them, but not edit the body or delete them. */

/** Comment/reply bodies longer than this are collapsed to a preview in the
 *  side-pane row, each with its own inline link to expand/collapse. The detail
 *  dialog always shows the full text. */
const BODY_PREVIEW_LIMIT = 200;

/** #411: the list / reader split. The list never shrinks below
 *  LIST_MIN_HEIGHT and the reader keeps READER_MIN_HEIGHT, whichever way the
 *  divider is dragged. */
const LIST_DEFAULT_HEIGHT = 200;
const LIST_MIN_HEIGHT = 72;
const READER_MIN_HEIGHT = 120;
const SPLITTER_HEIGHT = 6;

/** The tallest the list can be in a pane body `bodyHeight` high while the
 *  splitter and the reader's minimum still fit (Infinity until measured). */
function maxListHeight(bodyHeight: number): number {
  if (bodyHeight <= 0) return Infinity;
  return Math.max(0, bodyHeight - SPLITTER_HEIGHT - READER_MIN_HEIGHT);
}

/** `height` held between LIST_MIN_HEIGHT and `max`. A pane too short for both
 *  minimums gives up the list's: the splitter and reader stay in view. */
function clampListHeight(height: number, max: number): number {
  if (max < LIST_MIN_HEIGHT) return max;
  return Math.max(LIST_MIN_HEIGHT, Math.min(height, max));
}

/** #355: reply/edit fields in the pane scroll inside themselves past this
 *  many rows, so a pasted log can't push their submit buttons out of view. */
const RAIL_FIELD_MAX_ROWS = 6;
/** #387: reply/edit fields write at the size the posted body is shown at
 *  (body2), not MUI's body1 default. The scroll margins keep the field's
 *  first and last lines clear of the card's pinned header and action row
 *  when it is scrolled into view. */
const FIELD_SX = {
  "& .MuiInputBase-input": { typography: "body2" },
  "& textarea": { scrollMarginTop: "40px", scrollMarginBottom: "48px" },
} as const;
/** #387: a field that grows inside a scrolled card or pane doesn't drag the
 *  scroller along, so the line being typed slid out of view. Bring the field
 *  back after MUI has resized it for the new text. */
function keepFieldInView(e: FormEvent<HTMLDivElement>) {
  const el = e.target as HTMLElement;
  requestAnimationFrame(() => el.scrollIntoView?.({ block: "nearest" }));
}
/** #378: the reply/edit form's buttons. In a card they are pinned to the
 *  bottom of whatever scrolls the card, so a body and thread taller than the
 *  card's 320px can't push them out of reach below the field. */
const FORM_ACTIONS_SX = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 0.5,
  mt: 0.5,
  py: 0.5,
} as const;

/** #364: every card action sits in the header row, so the icons are kept
 *  small enough that six of them fit beside the id and badges. */
const CARD_ICON_SIZE = 16;
/** #364: the small card icons (16px since #394) are hard to aim at; the one under the pointer turns
 *  the primary colour so it is clear which action a click will take. */
const ACTION_HOVER_SX = {
  "& .MuiIconButton-root:not(.Mui-disabled):hover": { color: "primary.main" },
} as const;

/** #364: a non-selected card previews this many of its latest replies. */

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
  defaultExpanded = false,
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
  /** #376: start unfolded — the last reply of a thread the reader opens. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
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
  /** Renders the close icon at the right end of the title row when given (#389). */
  onClose?: () => void;
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
  /** The comment whose thread is currently open, if it is one of these. */
  selectedId?: string | null;
  /** Ids of anchored comments whose anchor the caller could not resolve in
   *  the live document (#328). The server's own `orphan` flag is computed
   *  from the raw markdown lines, so it can say "anchored" for a comment the
   *  editor cannot place; these join the orphan bucket here rather than
   *  falling out of the pane entirely. */
  unresolvedIds?: ReadonlySet<string>;
  /** The AI is working on these comments after a send from this editor
   *  (#360): open cards show that a reply is on its way. */
  agentReplying?: boolean;
  /** New AI replies per comment id since that work began (#360). */
  agentNewReplies?: ReadonlyMap<string, number>;
  /** Open comment ids that send handed over (#366); null before any send. */
  agentSentIds?: ReadonlySet<string> | null;
}

const NO_NEW_REPLIES: ReadonlyMap<string, number> = new Map();

/** Stable default for the optional `unresolvedIds` prop: a fresh `new Set()`
 *  in the parameter list would be a new identity every render and defeat the
 *  memos below. */
const EMPTY_IDS: ReadonlySet<string> = new Set();

/** A card's half-written reply/edit and whether each form is open (#334).
 *  Held by CommentSidePane per comment, not in CommentCard's own state: a card
 *  unmounts whenever the status filter hides it, — and its useState went with it,
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
  onClose,
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
  selectedId,
  unresolvedIds = EMPTY_IDS,
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
  // #411: the list's height; the reader takes the rest. Not persisted.
  // The height the reader asked for by dragging, and the pane body's measured
  // height: the list is drawn at the asked height, held to what leaves the
  // splitter and the reader room, and returns to it when the pane grows again.
  const [listHeightWanted, setListHeightWanted] = useState(LIST_DEFAULT_HEIGHT);
  const [bodyHeight, setBodyHeight] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) =>
      setBodyHeight(entries[0]?.contentRect.height ?? el.clientHeight)
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const listMax = maxListHeight(bodyHeight);
  const listHeight = clampListHeight(listHeightWanted, listMax);
  const readerComment = useMemo(
    () => (selectedId ? (comments.find((c) => c.id === selectedId) ?? null) : null),
    [comments, selectedId]
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
  // otherwise follow one added earlier near the bottom — wrong for the list.
  // `context.line_range` is
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
  // it unresolvable (`unresolvedIds` lands a frame after the selection). Derived during render so it opens on
  // the same commit that settles it.
  // The caller's verdict can land after the selection, so the selected
  // comment's own verdict turning true is judged again. Other comments'
  // verdicts are not tracked: they must not reopen a dialog the reader closed.
  const selectedUnresolved = selectedId ? unresolvedIds.has(selectedId) : false;
  const [selectionSettled, setSelectionSettled] = useState({
    id: selectedId,
    unresolved: selectedUnresolved,
  });
  if (
    selectedId !== selectionSettled.id ||
    selectedUnresolved !== selectionSettled.unresolved
  ) {
    const target = selectedId ? comments.find((c) => c.id === selectedId) : undefined;
    const noLiveAnchor =
      !!target && (target.scope === "global" || hasNoLiveAnchor(target));
    if (!selectedId || noLiveAnchor || target) {
      setSelectionSettled({ id: selectedId, unresolved: selectedUnresolved });
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
          Comments
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
        {onClose && (
          <Tooltip title="コメントを閉じる">
            <IconButton
              size="small"
              onClick={onClose}
              aria-label="コメントを閉じる"
              data-testid="comment-pane-close"
            >
              {/* Same glyph as the sidebar's close button, mirrored. */}
              <MenuOpenIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Status filter, the 位置不明 / 全体 buttons and the add action share one
          row (#196, #390). #394: the right edge matches the title row's (pr
          0.5) and the gap its 8px, so ⚠ / 🌐 / add sit in the same columns as
          refresh / mode / close above them. */}
      <Box
        sx={{
          pl: 1.5,
          pr: 0.5,
          // Fixed height matching the editor file tab bar (BAR_HEIGHT = 37px,
          // border-box), so the second-row dividers form one continuous line
          // across the panes (#65, #90).
          height: BAR_HEIGHT,
          flexShrink: 0,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
        data-testid="comment-add-toolbar"
      >
        <StatusFilterToggle
          value={filter}
          onChange={setFilter}
          allCount={comments.length}
          openCount={openCount}
          resolvedCount={resolvedCount}
        />
        <Box sx={{ flex: 1 }} />
        <GlobalCommentBadges
          globalCount={reviewActive ? globalComments.length : 0}
          orphanCount={orphanComments.length}
          showOrphan={reviewActive}
          onOpen={(kind) => {
            setGlobalDialogTab(kind);
            setGlobalDialogOpen(true);
          }}
          onAddGlobal={onAddGlobal}
        />
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
      </Box>

      <Box
        ref={bodyRef}
        sx={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
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
        ) : (
          <>
            <Box
              sx={{
                height: listHeight,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {visible.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {filter === "open"
                      ? "未解決のコメントはありません。"
                      : "解決済みのコメントはありません。"}
                  </Typography>
                </Box>
              ) : anchored.length === 0 ? (
                // #316: every visible comment is global/orphan (no live
                // anchor) — those surface only via the badge row above.
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    本文にひもづくコメントはありません。全体・位置不明のコメントは上部のバッジから確認できます。
                  </Typography>
                </Box>
              ) : (
                <CommentList
                  comments={anchored}
                  selectedId={selectedId ?? null}
                  onSelect={onSelect}
                />
              )}
            </Box>
            <PaneSplitter
              height={listHeight}
              maxHeight={listMax}
              onChange={setListHeightWanted}
            />
            <CommentReader
              comment={readerComment}
              onJump={onJump}
              jumpDisabled={
                !readerComment ||
                readerComment.scope === "global" ||
                hasNoLiveAnchor(readerComment)
              }
              onCopyLink={handleCopyLink}
              canCopyLink={canCopyLink}
              onDelete={handleDelete}
              onResolveToggle={onResolveToggle}
              onReply={onReply}
              onEdit={onEdit}
              onEditReply={onEditReply}
              onDeleteReply={onDeleteReply}
            />
          </>
        )}
      </Box>

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

interface ReaderCardProps {
  comment: CommentJSON;
  onCopyLink: (id: string) => void;
  canCopyLink?: boolean;
  onDelete: (id: string) => void;
  onResolveToggle: (id: string, next: "open" | "resolved") => void;
  onReply: (id: string, body: string) => void;
  onEdit: (id: string, body: string) => void;
  onEditReply: (id: string, index: number, body: string) => void;
  onDeleteReply: (id: string, index: number) => void;
}

/** The selected comment in full: body, every reply, and the actions (reply,
 *  resolve / reopen, edit, delete, copy link). It lives in the reader below
 *  the list (#411), so nothing here is clamped or folded away. */
function ReaderCard({
  comment: c,
  onCopyLink,
  canCopyLink = true,
  onDelete,
  onResolveToggle,
  onReply,
  onEdit,
  onEditReply,
  onDeleteReply,
}: ReaderCardProps) {
  const replies = c.replies?.length ?? 0;
  const resolved = c.status === "resolved";
  const aiOwned = isAiAuthored(c.author);
  const agentActivity = useContext(AgentActivityContext);
  // #366: only the comments the send handed over are being answered. One
  // written after it says so instead, or it would wait on a reply that the
  // AI, which never read it, is not writing.
  const sentToAi = agentActivity.sentIds?.has(c.id) ?? false;
  const awaitingAi = agentActivity.replying && sentToAi && !resolved && awaitsAiReply(c);
  const unsentToAi = agentActivity.replying && !sentToAi && !resolved;

  const [{ replyOpen, replyBody, editOpen, editBody }, updateDraft] = useCardDraft(c.id);
  // #334: focus a form only when the reader opens it. A draft's form also
  // reappears when the comment is selected again, and autoFocus there would
  // pull focus out of the editor mid-sentence into this field.
  const [focusForm, setFocusForm] = useState(false);

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
    <Box data-testid="comment-reader-card" data-comment-id={c.id}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            ...ACTION_HOVER_SX,
          }}
        >
          <Tooltip title={resolved ? "解決済みのため返信できません" : "返信を追加"}>
            <span>
              <IconButton
                size="small"
                disabled={resolved}
                onClick={() => {
                  updateDraft({ replyOpen: !replyOpen });
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
              onClick={() => onResolveToggle(c.id, resolved ? "open" : "resolved")}
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
                sx={{ p: 0.25 }}
              >
                <LinkIcon sx={{ fontSize: CARD_ICON_SIZE }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* #364: the comment's own entry gets the same bar as its replies
          (author, edit / delete on the right). */}
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
                  onClick={startEdit}
                  aria-label="edit comment"
                  data-testid="comment-edit"
                  sx={{ p: 0.25 }}
                >
                  <EditOutlinedIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
                  <DeleteOutlineIcon sx={{ fontSize: CARD_ICON_SIZE }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </ThreadEntryHeader>

      {editOpen && !resolved ? (
        <Box sx={{ mt: 0.5 }}>
          <TextField
            value={editBody}
            onChange={(e) => updateDraft({ editBody: e.target.value })}
            multiline
            minRows={2}
            maxRows={RAIL_FIELD_MAX_ROWS}
            sx={FIELD_SX}
            onInput={keepFieldInView}
            fullWidth
            size="small"
            autoFocus={focusForm}
            inputProps={{ "data-testid": "comment-edit-input" }}
          />
          <Box sx={FORM_ACTIONS_SX}>
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
          clampDisabled
        />
      )}

      {replies > 0 && c.replies && (
        <Box sx={{ mt: 1 }}>
          {c.replies.map((r, i, all) => (
            <ReplyRow
              key={i}
              reply={r}
              index={i}
              commentId={c.id}
              resolved={resolved}
              collapsible
              expandedByDefault={i === all.length - 1}
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
            onChange={(e) => updateDraft({ replyBody: e.target.value })}
            placeholder="返信を入力"
            multiline
            minRows={2}
            maxRows={RAIL_FIELD_MAX_ROWS}
            sx={FIELD_SX}
            onInput={keepFieldInView}
            fullWidth
            size="small"
            autoFocus={focusForm}
            inputProps={{ "data-testid": "comment-reply-input" }}
          />
          <Box sx={FORM_ACTIONS_SX}>
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

interface CommentReaderProps extends ReaderCardProps {
  /** Scrolls the document to the comment's highlight and flashes it. */
  onJump: (id: string) => void;
  /** No live anchor to jump to (global, orphan, or one the editor could not
   *  place). */
  jumpDisabled: boolean;
}

/** #411: the lower half of the pane — the selected comment in full, with its
 *  own scroll, so a long AI reply can be read at the pane's height instead of
 *  being cut off inside a list row. Nothing selected shows a hint. */
function CommentReader({
  comment: c,
  onJump,
  jumpDisabled,
  ...cardProps
}: Omit<CommentReaderProps, "comment"> & { comment: CommentJSON | null }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The scroll box is reused across comments: a different one starts from its
  // top, while a refetch of the same one keeps the reader's place.
  const commentId = c?.id;
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [commentId]);
  if (!c) {
    return (
      <Box
        data-testid="comment-reader"
        sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="comment-reader-empty"
        >
          一覧からコメントを選ぶと、ここに全文が出ます
        </Typography>
      </Box>
    );
  }
  const badge = SCOPE_BADGE[c.scope];
  const ctx = contextLabel(c);
  return (
    <Box
      data-testid="comment-reader"
      data-comment-id={c.id}
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 0.5,
          flexShrink: 0,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <CommentId id={c.id} />
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
        {c.status === "resolved" && (
          <Chip
            label="resolved"
            size="small"
            color="success"
            variant="outlined"
            sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
            data-testid="comment-status-resolved"
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          disabled={jumpDisabled}
          onClick={() => onJump(c.id)}
          data-testid="comment-reader-jump"
          sx={{ flexShrink: 0 }}
        >
          本文へ移動
        </Button>
      </Box>
      <Box
        ref={scrollRef}
        data-testid="comment-reader-scroll"
        sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1.5, py: 1 }}
      >
        {ctx && (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="comment-reader-context"
            sx={{ display: "block", mb: 0.5, wordBreak: "break-word" }}
          >
            対象: {ctx}
          </Typography>
        )}
        <ReaderCard key={c.id} comment={c} {...cardProps} />
      </Box>
    </Box>
  );
}

interface CommentListRowProps {
  comment: CommentJSON;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** One comment as a single line: state dot, id, the body's first line, and a
 *  badge when the AI has replied since the reader last looked (#411). No
 *  actions here — they are in the reader. */
function CommentListRow({ comment: c, selected, onSelect }: CommentListRowProps) {
  const resolved = c.status === "resolved";
  const newAiReplies = useContext(AgentActivityContext).newReplies.get(c.id) ?? 0;
  return (
    <Box
      role="button"
      tabIndex={0}
      data-testid="comment-item"
      data-comment-id={c.id}
      data-comment-status={c.status}
      data-selected={String(selected)}
      onClick={() => onSelect(c.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(c.id);
        }
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.5,
        py: 0.75,
        cursor: "pointer",
        borderBottom: "1px solid",
        borderColor: "divider",
        borderLeft: "3px solid",
        borderLeftColor: selected ? "primary.main" : "transparent",
        bgcolor: selected ? "action.selected" : undefined,
        opacity: resolved ? 0.6 : 1,
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
      }}
    >
      <Box
        aria-hidden
        data-testid="comment-state-dot"
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: resolved ? "success.main" : "warning.main",
        }}
      />
      <CommentId id={c.id} />
      <Typography
        variant="body2"
        data-testid="comment-row-body"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {firstLine(c.body)}
      </Typography>
      {newAiReplies > 0 && (
        <Chip
          label={`新着 ${newAiReplies}`}
          size="small"
          color="success"
          variant="outlined"
          sx={{
            height: 18,
            fontSize: "0.65rem",
            flexShrink: 0,
            "& .MuiChip-label": { px: 0.75 },
          }}
          data-testid="comment-new-ai-replies"
        />
      )}
    </Box>
  );
}

/** The first non-empty line of a comment body, for a one-line row. */
function firstLine(body: string): string {
  return (
    body
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? ""
  );
}

interface CommentListProps {
  comments: ReadonlyArray<CommentJSON>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** #333: every anchored comment in document order as one-line rows, scrolling
 *  inside its own box. Selecting a highlight in the editor scrolls its row
 *  into view here. */
function CommentList({ comments, selectedId, onSelect }: CommentListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-testid="comment-item"]') ?? []
    ).find((el) => el.dataset.commentId === selectedId);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <Box
      ref={listRef}
      data-testid="comment-list"
      sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}
    >
      {comments.map((c) => (
        <CommentListRow
          key={c.id}
          comment={c}
          selected={c.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </Box>
  );
}

/** Draggable divider between the list (above) and the reader (below). The
 *  list's height is clamped so neither half collapses. */
function PaneSplitter({
  height,
  maxHeight,
  onChange,
}: {
  height: number;
  maxHeight: number;
  onChange: (height: number) => void;
}) {
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  return (
    <Box
      role="separator"
      aria-orientation="horizontal"
      aria-label="一覧と読む欄の境界"
      aria-valuenow={height}
      data-testid="comment-pane-splitter"
      onPointerDown={(e) => {
        drag.current = { startY: e.clientY, startHeight: height };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onChange(
          clampListHeight(
            drag.current.startHeight + e.clientY - drag.current.startY,
            maxHeight
          )
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      sx={{
        height: SPLITTER_HEIGHT,
        flexShrink: 0,
        cursor: "row-resize",
        touchAction: "none",
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "action.hover",
        "&:hover": { bgcolor: "action.selected" },
      }}
    />
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
                  <EditOutlinedIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
                  <DeleteOutlineIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
            sx={FIELD_SX}
            onInput={keepFieldInView}
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
          {c.replies.map((r, i, all) => (
            <ReplyRow
              key={i}
              reply={r}
              index={i}
              commentId={c.id}
              resolved={resolved}
              collapsible
              expandedByDefault={i === all.length - 1}
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
            sx={FIELD_SX}
            onInput={keepFieldInView}
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
              <ReplyIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
              <ReplayIcon sx={{ fontSize: CARD_ICON_SIZE }} />
            ) : (
              <CheckCircleOutlineIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
              <OpenInFullIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
              <LinkIcon sx={{ fontSize: CARD_ICON_SIZE }} />
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
  /** #376: the thread's last reply opens unfolded, as it is the one to read. */
  expandedByDefault?: boolean;
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
  expandedByDefault = false,
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
            sx={FIELD_SX}
            onInput={keepFieldInView}
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
          defaultExpanded={expandedByDefault}
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
