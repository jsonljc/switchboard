import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingNav } from "../landing-nav";

describe("LandingNav", () => {
  it("renders wordmark and sign in link when not authenticated", () => {
    render(<LandingNav isAuthenticated={false} />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("renders dashboard link when authenticated", () => {
    render(<LandingNav isAuthenticated={true} />);
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });
});
