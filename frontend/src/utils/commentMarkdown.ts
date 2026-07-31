import MarkdownIt from "markdown-it";

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
 */
export function renderCommentMarkdown(source: string): string {
  if (!source) return "";
  return md.render(source);
}
