import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingFooter } from "../landing-footer";

describe("LandingFooter", () => {
  it("renders wordmark and builder link", () => {
    render(<LandingFooter />);
    expect(screen.getByText("Switchboard")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /build an agent/i })).toHaveAttribute(
      "href",
      "mailto:builders@switchboard.ai",
    );
  });

  it("renders copyright", () => {
    render(<LandingFooter />);
    expect(screen.getByText(/© \d{4} Switchboard/)).toBeInTheDocument();
  });
});
