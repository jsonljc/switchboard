import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingFooter } from "../landing-footer";

describe("LandingFooter", () => {
  it("renders wordmark and product links", () => {
    render(<LandingFooter />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /how it works/i })).toHaveAttribute(
      "href",
      "/how-it-works",
    );
    expect(screen.getByRole("link", { name: /pricing/i })).toHaveAttribute("href", "/pricing");
  });

  it("renders contact link", () => {
    render(<LandingFooter />);
    expect(screen.getByRole("link", { name: /contact us/i })).toHaveAttribute(
      "href",
      "mailto:hello@switchboard.ai",
    );
  });

  it("does not render removed links", () => {
    render(<LandingFooter />);
    expect(screen.queryByText(/build an agent/i)).toBeNull();
    expect(screen.queryByText(/get started/i)).toBeNull();
  });

  it("renders copyright", () => {
    render(<LandingFooter />);
    expect(screen.getByText(/© \d{4} Switchboard/)).toBeInTheDocument();
  });
});
