import {
  COMMENT_CLOSE_RE,
  COMMENT_OPEN_RE,
  isStandaloneScope,
  normalizeScope,
  parseCommentAttrs,
} from "@/utils/commentAttrs";

interface OpenMarker {
  node: Comment;
  attrs: Record<string, string>;
}

/**
 * Transform `<!-- @comment ... --> ... <!-- /@comment -->` pairs in a parsed
 * HTML element into `<span data-comment-id="..." ...>` wrappers that ProseMirror
 * picks up via the CommentMark's `parseHTML` rule.
 *
 * Unpaired open markers whose `scope` is "cross-section" or "global" are
 * converted into `<div data-type="standalone-comment" ...>` blocks that
 * ProseMirror picks up via the StandaloneCommentNode's `parseHTML` rule.
 *
 * Other unmatched markers are left in place so the user can see the raw
 * markdown issue and fix it manually.
 */
export function transformCommentMarkers(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const all: Comment[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    all.push(cur as Comment);
  }

  const stack: OpenMarker[] = [];
  const standalones: OpenMarker[] = [];
  for (const c of all) {
    const open = COMMENT_OPEN_RE.exec(c.data);
    if (open) {
      const attrs = parseCommentAttrs(open[1]);
      // Standalone-scope markers don't wait for a closer; emit them as a
      // block widget the StandaloneCommentNode can pick up.
      if (isStandaloneScope(normalizeScope(attrs.scope))) {
        standalones.push({ node: c, attrs });
        continue;
      }
      stack.push({ node: c, attrs });
      continue;
    }
    if (COMMENT_CLOSE_RE.test(c.data)) {
      const opener = stack.pop();
      if (!opener) continue;
      wrapBetween(opener.node, c, opener.attrs);
    }
  }

  for (const s of standalones) {
    replaceWithStandalone(s.node, s.attrs);
  }
}

function wrapBetween(
  start: Comment,
  end: Comment,
  attrs: Record<string, string>
): void {
  if (start.parentNode !== end.parentNode || !start.parentNode) return;
  const parent = start.parentNode;
  const doc = start.ownerDocument;
  if (!doc) return;

  const span = doc.createElement("span");
  span.setAttribute("data-comment-id", attrs.id ?? "");
  span.setAttribute("data-comment-author", attrs.author ?? "");
  span.setAttribute("data-comment-date", attrs.date ?? "");
  // Wrapped comments derive their target from the wrapped text at collect
  // time (see collectComments.ts); no need to round-trip a redundant copy.
  span.setAttribute("data-comment-body", attrs.body ?? "");
  span.setAttribute("data-comment-scope", normalizeScope(attrs.scope));
  span.className = "comment-mark";

  const between: Node[] = [];
  let next = start.nextSibling;
  while (next && next !== end) {
    between.push(next);
    next = next.nextSibling;
  }
  for (const n of between) {
    span.appendChild(n);
  }
  parent.insertBefore(span, start);
  parent.removeChild(start);
  parent.removeChild(end);
}

function replaceWithStandalone(
  marker: Comment,
  attrs: Record<string, string>
): void {
  const parent = marker.parentNode;
  if (!parent) return;
  const doc = marker.ownerDocument;
  if (!doc) return;

  // The marker may be wrapped inside an inline element (e.g. <p>) that
  // markdown-it produces around a stray HTML comment. To get a block-level
  // <div> to attach as a top-level child, climb out of any non-block parents
  // until we reach the editor root (or a block context).
  let host: Node = marker;
  let hostParent: Node | null = host.parentNode;
  while (
    hostParent &&
    hostParent !== root(hostParent) &&
    isInlineHost(hostParent)
  ) {
    host = hostParent;
    hostParent = host.parentNode;
  }

  const div = doc.createElement("div");
  div.setAttribute("data-type", "standalone-comment");
  div.setAttribute("data-comment-id", attrs.id ?? "");
  div.setAttribute("data-comment-author", attrs.author ?? "");
  div.setAttribute("data-comment-date", attrs.date ?? "");
  div.setAttribute("data-comment-target", attrs.target ?? "");
  div.setAttribute("data-comment-body", attrs.body ?? "");
  div.setAttribute("data-comment-scope", normalizeScope(attrs.scope));

  if (host === marker) {
    parent.insertBefore(div, marker);
    parent.removeChild(marker);
    return;
  }

  // host is an inline wrapper that contained the marker (and maybe nothing
  // else). Replace the wrapper outright if it has no remaining content;
  // otherwise insert the div before it and just drop the marker.
  const wrapperParent = host.parentNode;
  if (!wrapperParent) return;
  marker.parentNode?.removeChild(marker);
  if ((host as Element).childNodes.length === 0) {
    wrapperParent.replaceChild(div, host);
  } else {
    wrapperParent.insertBefore(div, host);
  }
}

function root(n: Node): Node {
  let cur: Node = n;
  while (cur.parentNode) cur = cur.parentNode;
  return cur;
}

function isInlineHost(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const tag = (node as Element).tagName.toLowerCase();
  // Block-level tags we should *not* climb above. Everything else is treated
  // as inline-ish and is climbed out of so the standalone <div> ends up at a
  // block position.
  const block = new Set([
    "div",
    "section",
    "article",
    "main",
    "body",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "pre",
  ]);
  return !block.has(tag);
}
