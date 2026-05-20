import type { Editor, Range } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  SlashCommandList,
  type CommandItem,
  type SlashCommandListRef,
} from "./SlashCommandList";
import { getCommandItems } from "./slashCommandItems";

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: CommandItem;
        }) => {
          props.command({ editor, range });
        },
        items: ({ query }: { query: string }): CommandItem[] => {
          return getCommandItems().filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase())
          );
        },
        render: () => {
          let component: ReactRenderer<SlashCommandListRef> | null = null;
          let popup: HTMLDivElement | null = null;

          return {
            onStart: (props: SuggestionProps<CommandItem>) => {
              component = new ReactRenderer(SlashCommandList, {
                props,
                editor: props.editor,
              });

              popup = document.createElement("div");
              popup.style.position = "absolute";
              popup.style.zIndex = "1300";
              document.body.appendChild(popup);

              const coords = props.clientRect?.();
              if (coords && popup) {
                popup.style.left = `${coords.x}px`;
                popup.style.top = `${coords.y + coords.height}px`;
              }

              if (component.element) {
                popup.appendChild(component.element);
              }
            },
            onUpdate: (props: SuggestionProps<CommandItem>) => {
              component?.updateProps(props);

              const coords = props.clientRect?.();
              if (coords && popup) {
                popup.style.left = `${coords.x}px`;
                popup.style.top = `${coords.y + coords.height}px`;
              }
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                popup?.remove();
                component?.destroy();
                popup = null;
                component = null;
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.remove();
              component?.destroy();
              popup = null;
              component = null;
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
