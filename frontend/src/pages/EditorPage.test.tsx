import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EditorPage } from "./EditorPage";

vi.mock("@/components/tiptap/TiptapEditor", () => ({
  TiptapEditor: () => <div data-testid="tiptap-editor" />,
}));

describe("EditorPage", () => {
  it("renders the TiptapEditor", () => {
    const { getByTestId } = render(<EditorPage />);
    expect(getByTestId("tiptap-editor")).toBeInTheDocument();
  });
});
