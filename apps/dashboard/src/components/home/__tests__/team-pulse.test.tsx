import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { TeamPulse } from "../team-pulse";
import type { TeamPulseAgent } from "../types";

const alexAgent: TeamPulseAgent = {
  key: "alex",
  name: "Alex",
  status: "working",
  setUp: true,
};

const rileyAgent: TeamPulseAgent = {
  key: "riley",
  name: "Riley",
  status: "idle",
  setUp: true,
};

const miraAgent: TeamPulseAgent = {
  key: "mira",
  name: "Mira",
  status: "idle",
  setUp: false,
};

const allAgents: TeamPulseAgent[] = [alexAgent, rileyAgent, miraAgent];

describe("TeamPulse component", () => {
  describe("renders all agents", () => {
    it("renders each agent's name", () => {
      render(<TeamPulse agents={allAgents} />);
      expect(screen.getByText("Alex")).toBeInTheDocument();
      expect(screen.getByText("Riley")).toBeInTheDocument();
      expect(screen.getByText("Mira")).toBeInTheDocument();
    });

    it("renders each agent's full name inside their own chip", () => {
      render(<TeamPulse agents={allAgents} />);
      // Verify the agentChipName span carries the full name inside the correct chip
      for (const agent of allAgents) {
        const chip = screen.getByTestId(`agent-chip-${agent.key}`);
        expect(within(chip).getByText(agent.name)).toBeInTheDocument();
      }
    });
  });

  describe("working + setUp agent (Alex)", () => {
    it("has data-disabled='false' on the chip", () => {
      render(<TeamPulse agents={[alexAgent]} />);
      const chip = screen.getByTestId("agent-chip-alex");
      expect(chip).toHaveAttribute("data-disabled", "false");
    });

    it("renders status dot with data-on='true'", () => {
      render(<TeamPulse agents={[alexAgent]} />);
      const chip = screen.getByTestId("agent-chip-alex");
      const dot = within(chip).getByTestId("agent-status-dot");
      expect(dot).toHaveAttribute("data-on", "true");
    });

    it("does NOT render 'Not set up' text", () => {
      render(<TeamPulse agents={[alexAgent]} />);
      expect(screen.queryByText("Not set up")).not.toBeInTheDocument();
    });
  });

  describe("idle + setUp agent (Riley)", () => {
    it("renders status dot with data-on='false'", () => {
      render(<TeamPulse agents={[rileyAgent]} />);
      const chip = screen.getByTestId("agent-chip-riley");
      const dot = within(chip).getByTestId("agent-status-dot");
      expect(dot).toHaveAttribute("data-on", "false");
    });

    it("does NOT render 'Not set up' text", () => {
      render(<TeamPulse agents={[rileyAgent]} />);
      expect(screen.queryByText("Not set up")).not.toBeInTheDocument();
    });
  });

  describe("not-set-up agent (Mira honesty guardrail)", () => {
    it("renders 'Not set up' label visibly", () => {
      render(<TeamPulse agents={[miraAgent]} />);
      expect(screen.getByText("Not set up")).toBeInTheDocument();
    });

    it("has data-disabled='true' on the chip", () => {
      render(<TeamPulse agents={[miraAgent]} />);
      const chip = screen.getByTestId("agent-chip-mira");
      expect(chip).toHaveAttribute("data-disabled", "true");
    });

    it("does NOT render a working dot (data-on is not 'true')", () => {
      render(<TeamPulse agents={[miraAgent]} />);
      const chip = screen.getByTestId("agent-chip-mira");
      // The status dot must NOT be lit (data-on should not be "true")
      const dot = within(chip).queryByTestId("agent-status-dot");
      if (dot) {
        expect(dot).not.toHaveAttribute("data-on", "true");
      }
      // Alternatively confirm "Not set up" is shown (the label replaces dot semantics)
      expect(screen.getByText("Not set up")).toBeInTheDocument();
    });
  });

  describe("chip data-agent attribute", () => {
    it("sets data-agent matching the agent key on each chip", () => {
      render(<TeamPulse agents={allAgents} />);
      expect(screen.getByTestId("agent-chip-alex")).toHaveAttribute("data-agent", "alex");
      expect(screen.getByTestId("agent-chip-riley")).toHaveAttribute("data-agent", "riley");
      expect(screen.getByTestId("agent-chip-mira")).toHaveAttribute("data-agent", "mira");
    });
  });

  describe("empty agents list", () => {
    it("renders the ribbon container with no chips", () => {
      render(<TeamPulse agents={[]} />);
      expect(screen.queryByTestId(/^agent-chip-/)).not.toBeInTheDocument();
    });
  });
});

describe("TeamPulse onOpenAgent", () => {
  it("clicking the alex chip calls onOpenAgent with 'alex'", () => {
    const onOpen = vi.fn();
    render(<TeamPulse agents={allAgents} onOpenAgent={onOpen} />);
    fireEvent.click(screen.getByTestId("agent-chip-alex"));
    expect(onOpen).toHaveBeenCalledWith("alex");
  });

  it("clicking the mira chip calls onOpenAgent with 'mira' (not-set-up chips are still tappable)", () => {
    const onOpen = vi.fn();
    render(<TeamPulse agents={allAgents} onOpenAgent={onOpen} />);
    fireEvent.click(screen.getByTestId("agent-chip-mira"));
    expect(onOpen).toHaveBeenCalledWith("mira");
  });

  it("chips are rendered as buttons", () => {
    const onOpen = vi.fn();
    render(<TeamPulse agents={allAgents} onOpenAgent={onOpen} />);
    const alexChip = screen.getByTestId("agent-chip-alex");
    expect(alexChip.tagName.toLowerCase()).toBe("button");
  });

  it("renders without onOpenAgent prop (backward-compatible — no crash)", () => {
    expect(() => render(<TeamPulse agents={allAgents} />)).not.toThrow();
  });
});
