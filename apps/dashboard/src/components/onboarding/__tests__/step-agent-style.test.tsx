import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepAgentStyle } from "../step-agent-style";

describe("StepAgentStyle", () => {
  const defaultProps = {
    selectedAgents: ["lead-responder", "sales-closer"],
    agentTones: {} as Record<string, string>,
    onTonesChange: vi.fn(),
    businessName: "Radiance Spa",
  };

  it("renders a card for each selected agent", () => {
    render(<StepAgentStyle {...defaultProps} />);
    expect(screen.getByText("Lead Responder")).toBeTruthy();
    expect(screen.getByText("Sales Closer")).toBeTruthy();
  });

  it("shows tone options for each agent", () => {
    render(<StepAgentStyle {...defaultProps} />);
    // Each agent card should have 3 tone buttons
    const warmButtons = screen.getAllByText("Warm");
    expect(warmButtons.length).toBe(2);
  });

  it("calls onTonesChange when a tone is selected", () => {
    const onTonesChange = vi.fn();
    render(<StepAgentStyle {...defaultProps} onTonesChange={onTonesChange} />);
    const warmButtons = screen.getAllByText("Warm");
    fireEvent.click(warmButtons[0]!);
    expect(onTonesChange).toHaveBeenCalledWith({ "lead-responder": "warm-professional" });
  });

  it("shows a live preview when tone is selected", () => {
    render(
      <StepAgentStyle {...defaultProps} agentTones={{ "lead-responder": "warm-professional" }} />,
    );
    // Preview should contain the business name
    expect(screen.getByText(/Radiance Spa/)).toBeTruthy();
  });

  it("does not render agents that are not selected", () => {
    render(<StepAgentStyle {...defaultProps} selectedAgents={["lead-responder"]} />);
    expect(screen.queryByText("Sales Closer")).toBeNull();
  });
});
