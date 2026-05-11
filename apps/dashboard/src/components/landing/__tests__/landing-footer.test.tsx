import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingFooter } from "../landing-footer";

describe("LandingFooter", () => {
  it("renders wordmark", () => {
    render(<LandingFooter />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
  });

  it("renders contact link", () => {
    render(<LandingFooter />);
    expect(screen.getByRole("link", { name: /contact us/i })).toHaveAttribute(
      "href",
      "mailto:hello@switchboard.ai",
    );
  });

  it("renders privacy and terms links", () => {
    render(<LandingFooter />);
    expect(screen.getByRole("link", { name: /^privacy$/i })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: /^terms$/i })).toHaveAttribute("href", "/terms");
  });

  it("does not render deleted product links", () => {
    render(<LandingFooter />);
    expect(screen.queryByRole("link", { name: /how it works/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^pricing$/i })).not.toBeInTheDocument();
  });

  it("does not link to deleted /signup or /get-started routes", () => {
    const { container } = render(<LandingFooter />);
    const anchors = Array.from(container.querySelectorAll("a"));
    for (const a of anchors) {
      expect(a.getAttribute("href")).not.toBe("/signup");
      expect(a.getAttribute("href")).not.toBe("/get-started");
    }
  });

  it("renders copyright", () => {
    render(<LandingFooter />);
    expect(screen.getByText(/© \d{4} Switchboard/)).toBeInTheDocument();
  });
});
