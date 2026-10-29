import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountBadge } from "./CountBadge";

describe("CountBadge (#379)", () => {
  it("draws only the number and reads the label before it", () => {
    render(<CountBadge count={3} label="未送信" testId="badge" />);
    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("未送信 3");
    expect(screen.getByText("未送信", { exact: false }).tagName).toBe("SPAN");
  });

  it("is laid over its button rather than taking room inside it", () => {
    render(<CountBadge count={1} testId="badge" />);
    expect(screen.getByTestId("badge")).toHaveStyle({ position: "absolute" });
  });
});
