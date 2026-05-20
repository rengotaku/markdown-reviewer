import { Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidBlockView } from "./MermaidBlockView";

export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      code: {
        default: "graph TD\n    A[Start] --> B[End]",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      {
        "data-type": "mermaid-block",
        "data-code": HTMLAttributes.code,
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView);
  },

  addProseMirrorPlugins() {
    const mermaidBlockType = this.type;

    return [
      new Plugin({
        key: new PluginKey("mermaidPasteHandler"),
        props: {
          transformPasted(slice) {
            const nodes: PmNode[] = [];
            slice.content.forEach((node) => {
              if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") {
                nodes.push(mermaidBlockType.create({ code: node.textContent }));
              } else {
                nodes.push(node);
              }
            });

            return new Slice(Fragment.from(nodes), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});
