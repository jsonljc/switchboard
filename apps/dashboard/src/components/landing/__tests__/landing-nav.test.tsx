import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingNav } from "../landing-nav";

describe("LandingNav", () => {
  it("renders wordmark", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
  });

  it("does not show Agents link", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.queryByRole("link", { name: /^agents$/i, hidden: true })).not.toBeInTheDocument();
  });

  it("shows sign in when not authenticated", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /sign in/i, hidden: true })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("shows dashboard link when authenticated", () => {
    render(<LandingNav isAuthenticated={true} />);
    expect(screen.getByRole("link", { name: /dashboard/i, hidden: true })).toBeInTheDocument();
  });

  it("does not show How it works or Pricing links", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(
      screen.queryByRole("link", { name: /how it works/i, hidden: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^pricing$/i, hidden: true }),
    ).not.toBeInTheDocument();
  });

  it("does not link to deleted /signup or /get-started routes", () => {
    const { container } = render(<LandingNav isAuthenticated={false} />);
    const anchors = Array.from(container.querySelectorAll("a"));
    for (const a of anchors) {
      expect(a.getAttribute("href")).not.toBe("/signup");
      expect(a.getAttribute("href")).not.toBe("/get-started");
    }
  });
});
