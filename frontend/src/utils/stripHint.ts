// stripHint removes the leading `<!-- markdown-reviewer ... -->` hint block
// that the server force-injects at the top of every saved file. The hint's
// embedded URLs change on each save, so it must be stripped from both diff
// sides or it would dominate the diff with spurious churn.
//
// Mirrors the server-side strip (internal/handler/hint.go `stripAIHint` /
// `hintBlockRe`): match only at the very start of the document, then drop the
// blank lines that followed the block.
const hintBlockRe = /^<!--\s*markdown-reviewer\b[\s\S]*?-->\s*\n*/;

export function stripHint(content: string): string {
  return content.replace(hintBlockRe, "").replace(/^\n+/, "");
}
