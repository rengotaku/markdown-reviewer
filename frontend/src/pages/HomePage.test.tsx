import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("renders the title", () => {
    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    expect(screen.getByText("React SPA Boilerplate")).toBeInTheDocument();
  });

  it("renders navigation link to users", () => {
    render(
      <BrowserRouter>
        <HomePage />
      </BrowserRouter>
    );

    const link = screen.getByRole("link", { name: "Users" });
    expect(link).toHaveAttribute("href", "/users");
  });
});
