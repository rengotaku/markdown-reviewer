import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TailwindDemo } from "./TailwindDemo";

describe("TailwindDemo", () => {
  it("renders without crashing", () => {
    render(<TailwindDemo />);
    expect(screen.getByTestId("tailwind-demo")).toBeInTheDocument();
  });

  it("renders a Lucide SVG icon", () => {
    render(<TailwindDemo />);
    const svg = screen.getByTestId("tailwind-demo").querySelector("svg");
    expect(svg).not.toBeNull();
    // Lucide icons render with the lucide class
    expect(svg?.classList.contains("lucide")).toBe(true);
  });

  it("applies Tailwind utility classes to the button", () => {
    render(<TailwindDemo />);
    const button = screen.getByRole("button", { name: /tailwind/i });
    expect(button.className).toMatch(/bg-/);
    expect(button.className).toMatch(/text-/);
  });

  it("renders the demo heading", () => {
    render(<TailwindDemo />);
    expect(screen.getAllByText(/tailwind/i).length).toBeGreaterThan(0);
  });
});
