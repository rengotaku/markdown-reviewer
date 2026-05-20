import {
  COMMENT_CLOSE_RE,
  COMMENT_OPEN_RE,
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
 * Only pairs whose open / close markers share a common parent are wrapped.
 * Unmatched markers are left in place so the user can see the raw markdown
 * issue and fix it manually.
 */
export function transformCommentMarkers(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const all: Comment[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    all.push(cur as Comment);
  }

  const stack: OpenMarker[] = [];
  for (const c of all) {
    const open = COMMENT_OPEN_RE.exec(c.data);
    if (open) {
      stack.push({ node: c, attrs: parseCommentAttrs(open[1]) });
      continue;
    }
    if (COMMENT_CLOSE_RE.test(c.data)) {
      const opener = stack.pop();
      if (!opener) continue;
      wrapBetween(opener.node, c, opener.attrs);
    }
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
  span.setAttribute("data-comment-target", attrs.target ?? "");
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
