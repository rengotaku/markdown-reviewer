import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { NotFoundPage } from "./NotFoundPage";

describe("NotFoundPage", () => {
  it("renders 404 message", () => {
    render(
      <BrowserRouter>
        <NotFoundPage />
      </BrowserRouter>
    );

    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });

  it("renders link to home", () => {
    render(
      <BrowserRouter>
        <NotFoundPage />
      </BrowserRouter>
    );

    const link = screen.getByRole("link", { name: "Go to Home" });
    expect(link).toHaveAttribute("href", "/");
  });
});
