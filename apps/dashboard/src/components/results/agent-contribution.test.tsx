import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { goodFixture } from "@/app/(auth)/(mercury)/reports/fixtures";
import { AgentContribution } from "./agent-contribution";

describe("AgentContribution", () => {
  it("renders Riley and Alex with their dollar contributions + captions", () => {
    render(<AgentContribution attribution={goodFixture.attribution} />);
    expect(screen.getByText("S$9,180")).toBeInTheDocument(); // riley.value
    expect(screen.getByText("S$5,540")).toBeInTheDocument(); // alex.value
    expect(screen.getByText(goodFixture.attribution.riley.caption)).toBeInTheDocument();
  });
  it("renders Mira as 'Not set up yet' with NO number", () => {
    const { container } = render(<AgentContribution attribution={goodFixture.attribution} />);
    expect(screen.getByText(/Not set up yet/i)).toBeInTheDocument();
    expect(container.querySelector('[data-agent="mira"]')?.textContent).not.toMatch(/S\$/);
  });
  it("renders one agent-chip button per agent (entry point for the agent panel)", () => {
    const { container } = render(<AgentContribution attribution={goodFixture.attribution} />);
    // Each article[data-agent] has exactly one header button (the chip that opens the panel).
    // Agent color (the dot) is identity-only — it lives inside the button, not as a standalone control.
    expect(container.querySelectorAll("[data-agent] button").length).toBe(3); // riley, alex, mira
  });

  it("the agent chip buttons have descriptive aria-labels", () => {
    render(<AgentContribution attribution={goodFixture.attribution} />);
    expect(screen.getByRole("button", { name: /open riley panel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open alex panel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open mira panel/i })).toBeInTheDocument();
  });
});
