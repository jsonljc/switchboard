import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentFamilyCharacter } from "../agent-family-character";

describe("AgentFamilyCharacter", () => {
  it("renders name and Live badge for live status", () => {
    render(<AgentFamilyCharacter name="Sales" roleFocus="leads" status="live" />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("renders name and Coming badge for coming status", () => {
    render(<AgentFamilyCharacter name="Creative" roleFocus="default" status="coming" />);
    expect(screen.getByText("Creative")).toBeInTheDocument();
    expect(screen.getByText("Coming")).toBeInTheDocument();
  });

  it("applies opacity-40 class when muted", () => {
    const { container } = render(
      <AgentFamilyCharacter name="Trading" roleFocus="default" status="coming" />,
    );
    const characterWrapper = container.querySelector(".opacity-40");
    expect(characterWrapper).not.toBeNull();
  });
});
