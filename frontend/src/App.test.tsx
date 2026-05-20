import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders home page by default", () => {
    render(<App />);
    expect(screen.getByText("React SPA Boilerplate")).toBeInTheDocument();
  });

  it("shows navigation links", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  });
});
