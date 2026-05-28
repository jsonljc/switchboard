import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentPanel } from "@/components/agent-panel/agent-panel";

describe("AgentPanel shell", () => {
  it("renders the dialog with the agent name when open", () => {
    render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });
  it("exposes a reachable close control (Radix Sheet a11y contract)", () => {
    render(<AgentPanel agentKey="alex" open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
  it("renders the MiraPanel body (not the data-slot scaffold) for agentKey 'mira'", () => {
    render(<AgentPanel agentKey="mira" open onOpenChange={() => {}} />);
    expect(screen.getByText("Mira isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-panel-body")).not.toBeInTheDocument();
  });
});
