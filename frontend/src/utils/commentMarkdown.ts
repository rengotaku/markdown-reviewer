import MarkdownIt from "markdown-it";
import { resolveInternalLink } from "@/utils/internalLink";

// commentMarkdown renders comment/reply bodies (human- or AI-authored review
// notes) as simple, unhighlighted Markdown for CommentSidePane (#147). It is
// intentionally narrower than diffGutterMarks.ts's md instance: that one sets
// `html: true` to preserve raw HTML blocks for diffing, which would be an XSS
// hole here since comment bodies render via dangerouslySetInnerHTML.
//
// Security posture (see issue #147 brief):
//   - `html: false` — raw HTML in the source is never treated as tags; it's
//     escaped like any other text (covers <script>/<img onerror> payloads).
//   - markdown-it's default `validateLink()` is used unmodified: it already
//     rejects javascript:/vbscript:/file:/data: URIs (except safe inline
//     images), so `[text](https://...)` links stay real <a> tags while
//     dangerous ones never become a `href="javascript:..."` attribute.
//   - No syntax highlighter is wired up (no `highlight` option), so fenced
//     code blocks render as plain <pre><code> with no <span class=...> noise.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/** markdown-it `env` shape threaded through to `link_open` (#215 follow-up). */
interface RenderEnv {
  currentPath?: string;
}

// Images are deliberately not part of the supported syntax set (#147), and
// leaving the rule on would make merely *opening* the side pane fire a GET to
// whatever URL a comment names — a silent tracking/SSRF-ish beacon for bodies
// that arrive over POST /api/comments or get written by an AI summarising an
// untrusted document. Disabling the rule renders `![alt](url)` as inert text.
md.disable(["image"]);

// Force every rendered link to open in a new tab safely, regardless of
// whether it came from `[text](url)` syntax or bare-URL linkify.
const defaultRenderLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");

  // External-link marker (#215 follow-up): only computed when the caller
  // passes `currentPath` (LinkPreviewCard, which knows which file's body
  // it's rendering). CommentSidePane calls renderCommentMarkdown() without
  // it, so its output — and thus its rendering — is byte-for-byte
  // unchanged; the class is opt-in per call, not global.
  const currentPath = (env as RenderEnv | undefined)?.currentPath;
  if (currentPath !== undefined) {
    const href = tokens[idx].attrGet("href") ?? "";
    const isAnchor = href.startsWith("#");
    if (href && !isAnchor && resolveInternalLink(href, currentPath) === null) {
      tokens[idx].attrJoin("class", "cm-link-external");
    }
  }

  return defaultRenderLinkOpen(tokens, idx, options, env, self);
};

// Note on rejected links: when a destination fails validateLink()
// (javascript:/vbscript:/file:/data:), markdown-it builds no <a> token at all
// and leaves the literal "[label](scheme:...)" source as escaped plain text.
// That is the safe outcome and we deliberately leave it alone — the scheme
// only survives as inert text, never as an attribute. An earlier attempt to
// also scrub that leftover text with a regex was reverted: it matched the
// rendered HTML after the fact and so mangled the *contents* of fenced code
// blocks and inline code (e.g. a comment documenting
// "[click](javascript:alert(1))" as an example rendered as just "click"),
// which is a real hazard in a tool whose comments discuss Markdown syntax.

/**
 * renderCommentMarkdown renders a comment/reply's Markdown source into a
 * safe HTML string suitable for `dangerouslySetInnerHTML`. No syntax
 * highlighting; see the security notes above for the XSS posture.
 *
 * `currentPath` is optional and only used by LinkPreviewCard (#215
 * follow-up): when given, every rendered link that isn't an internal
 * same-root document link (relative to `currentPath`) or a pure in-page
 * anchor gets a `cm-link-external` class so the caller's stylesheet can
 * show an "opens elsewhere" marker. Omit it (as CommentSidePane does) to
 * get the exact same output as before this option existed.
 */
export function renderCommentMarkdown(
  source: string,
  currentPath?: string
): string {
  if (!source) return "";
  return md.render(source, { currentPath } satisfies RenderEnv);
}
