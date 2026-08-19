import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { resolveInternalLink } from "@/utils/internalLink";

// ExternalLinkDecoration paints a small `ext-link-icon` class onto every
// rendered `<a>` whose target is *not* an in-app internal link and *not* a
// pure in-page anchor (#215 follow-up), so a reader can tell at a glance
// that clicking it leaves the reviewed document (real navigation / new
// tab) rather than jumping to another file inside the same review root.
//
// Decoration-only, same shape as DiffGutter.ts: the classification never
// touches the doc, so `tiptap-markdown`'s `getMarkdown()` output — the
// thing that actually gets written back to disk — is completely unaffected.
// The CSS that turns the class into a visible glyph lives in editor.css
// (`.ProseMirror a .ext-link-icon::after`).

interface PluginState {
  basePath: string;
  deco: DecorationSet;
}

const key = new PluginKey<PluginState>("externalLinkDecoration");

function isExternal(href: string, basePath: string): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return false;
  return resolveInternalLink(href, basePath) === null;
}

function buildDeco(doc: ProseMirrorNode, basePath: string): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const linkMark = node.marks.find((m) => m.type.name === "link");
    if (!linkMark) return;
    const href = (linkMark.attrs.href as string | undefined) ?? "";
    if (!isExternal(href, basePath)) return;
    decos.push(
      Decoration.inline(pos, pos + node.nodeSize, { class: "ext-link-icon" })
    );
  });
  return DecorationSet.create(doc, decos);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    externalLinkDecoration: {
      /** Set the root-relative path of the file currently open — every
       *  link's href is resolved relative to this before deciding whether
       *  it's external (mirrors TiptapEditor's click/hover handlers). */
      setLinkBasePath: (basePath: string) => ReturnType;
    };
  }
}

export const ExternalLinkDecoration = Extension.create({
  name: "externalLinkDecoration",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: (_config, state) => ({
            basePath: "",
            deco: buildDeco(state.doc, ""),
          }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(key) as string | undefined;
            if (meta !== undefined) {
              return { basePath: meta, deco: buildDeco(newState.doc, meta) };
            }
            if (tr.docChanged) {
              return {
                basePath: value.basePath,
                deco: buildDeco(newState.doc, value.basePath),
              };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setLinkBasePath:
        (basePath: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(key, basePath));
          return true;
        },
    };
  },
});
