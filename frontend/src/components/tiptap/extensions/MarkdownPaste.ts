import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as PmDOMParser } from "@tiptap/pm/model";

// Matches a line starting with ``` — i.e. a markdown code fence
const CODE_FENCE_RE = /^```/m;

/**
 * When the clipboard carries both text/html and text/plain and the plain-text
 * content contains markdown code fences, ProseMirror would otherwise use the
 * HTML (bypassing clipboardTextParser). Rich-text HTML from sources such as
 * VS Code or terminal emulators does not map to <pre><code>, so the code block
 * ends up stored as ordinary paragraphs and getMarkdown() escapes the content.
 *
 * This extension intercepts such paste events and routes the plain text through
 * the markdown parser instead, ensuring code blocks are correctly preserved.
 */
export const MarkdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain");
            const html = event.clipboardData?.getData("text/html");

            // Only intercept when both formats are present and the plain text
            // contains at least one code fence line.
            if (!text || !html || !CODE_FENCE_RE.test(text)) {
              return false;
            }

            const parser = (
              editor.storage as {
                markdown?: {
                  parser: { parse: (s: string, opts?: { inline?: boolean }) => string };
                };
              }
            ).markdown?.parser;

            if (!parser) return false;

            const parsed = parser.parse(text, { inline: true });
            const body = new window.DOMParser().parseFromString(
              `<body>${parsed}</body>`,
              "text/html"
            ).body;

            const slice = PmDOMParser.fromSchema(view.state.schema).parseSlice(body, {
              preserveWhitespace: true,
              context: view.state.selection.$from,
            });

            view.dispatch(view.state.tr.replaceSelection(slice));
            return true;
          },
        },
      }),
    ];
  },
});
