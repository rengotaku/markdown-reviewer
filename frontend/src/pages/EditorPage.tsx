import Box from "@mui/material/Box";
import { TiptapEditor } from "@/components/tiptap/TiptapEditor";

export function EditorPage() {
  return (
    <Box sx={{ height: "100vh", overflow: "hidden" }}>
      <TiptapEditor />
    </Box>
  );
}
