import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingNav } from "../landing-nav";

describe("LandingNav", () => {
  it("renders wordmark", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
  });

  it("shows How it works and Pricing links", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /how it works/i, hidden: true })).toHaveAttribute(
      "href",
      "/how-it-works",
    );
    expect(screen.getByRole("link", { name: /pricing/i, hidden: true })).toHaveAttribute(
      "href",
      "/pricing",
    );
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

  it("shows Get Started CTA", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByRole("link", { name: /get started/i, hidden: true })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});
