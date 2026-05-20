import { useState, useCallback, forwardRef, useImperativeHandle } from "react";
import type { Editor, Range } from "@tiptap/core";
import Paper from "@mui/material/Paper";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";

export interface CommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  command: (props: { editor: Editor; range: Range }) => void;
}

interface SlashCommandListProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

function SlashCommandListInner(
  { items, command }: SlashCommandListProps,
  ref: React.ForwardedRef<SlashCommandListRef>
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) {
        command(item);
      }
    },
    [items, command]
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return null;
  }

  return (
    <Paper elevation={8} sx={{ maxHeight: 300, overflow: "auto", minWidth: 240 }}>
      <List dense disablePadding>
        {items.map((item, index) => (
          <ListItemButton
            key={item.title}
            selected={index === selectedIndex}
            onClick={() => selectItem(index)}
          >
            <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.title} secondary={item.description} />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  );
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  SlashCommandListInner
);

SlashCommandList.displayName = "SlashCommandList";
