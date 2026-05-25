import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NeedsYou } from "../needs-you";
import type { Decision } from "@/lib/decisions/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Yes, send it",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 80,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { contactName: "Maya R." },
    ...overrides,
  };
}

function makeDecisions(count: number): Decision[] {
  return Array.from({ length: count }, (_, i) =>
    makeDecision({
      id: `dec-${i + 1}`,
      humanSummary: `Decision ${i + 1} summary`,
      presentation: {
        primaryLabel: `Primary ${i + 1}`,
        secondaryLabel: `Secondary ${i + 1}`,
        dismissLabel: "Dismiss",
        dataLines: [],
      },
      meta: { contactName: `Contact ${i + 1}` },
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("NeedsYou", () => {
  describe("empty state", () => {
    it("renders nothing when decisions is empty", () => {
      const { container } = render(<NeedsYou decisions={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("does not render an all-clear message (that belongs to Verdict)", () => {
      const { container } = render(<NeedsYou decisions={[]} />);
      expect(container.textContent).toBe("");
    });
  });

  describe("with 2 decisions", () => {
    it("renders exactly 2 decision-card testids", () => {
      render(<NeedsYou decisions={makeDecisions(2)} />);
      expect(screen.getAllByTestId("decision-card")).toHaveLength(2);
    });

    it("does NOT render a 'See all' link", () => {
      render(<NeedsYou decisions={makeDecisions(2)} />);
      expect(screen.queryByRole("link", { name: /see all in inbox/i })).not.toBeInTheDocument();
    });
  });

  describe("with 3 decisions", () => {
    it("renders exactly 2 decision-card testids (cap at 2)", () => {
      render(<NeedsYou decisions={makeDecisions(3)} />);
      expect(screen.getAllByTestId("decision-card")).toHaveLength(2);
    });

    it("renders a 'See all in Inbox' link pointing to /inbox", () => {
      render(<NeedsYou decisions={makeDecisions(3)} />);
      const link = screen.getByRole("link", { name: /see all in inbox/i });
      expect(link).toHaveAttribute("href", "/inbox");
    });
  });

  describe("onAction callback", () => {
    it("calls onAction with the decision and 'primary' when primary button is clicked", () => {
      const onAction = vi.fn();
      const decisions = [
        makeDecision({
          id: "dec-1",
          presentation: {
            primaryLabel: "Yes, send it",
            secondaryLabel: "Not yet",
            dismissLabel: "Dismiss",
            dataLines: [],
          },
        }),
      ];
      render(<NeedsYou decisions={decisions} onAction={onAction} />);
      fireEvent.click(screen.getByRole("button", { name: "Yes, send it" }));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(decisions[0], "primary");
    });

    it("calls onAction with the decision and 'secondary' when secondary button is clicked", () => {
      const onAction = vi.fn();
      const decisions = [
        makeDecision({
          id: "dec-1",
          presentation: {
            primaryLabel: "Yes, send it",
            secondaryLabel: "Not yet",
            dismissLabel: "Dismiss",
            dataLines: [],
          },
        }),
      ];
      render(<NeedsYou decisions={decisions} onAction={onAction} />);
      fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(decisions[0], "secondary");
    });

    it("does not throw when onAction is not provided", () => {
      const decisions = makeDecisions(1);
      render(<NeedsYou decisions={decisions} />);
      expect(() =>
        fireEvent.click(screen.getByRole("button", { name: "Primary 1" })),
      ).not.toThrow();
    });
  });

  describe("section header", () => {
    it("renders the section heading 'needs you'", () => {
      render(<NeedsYou decisions={makeDecisions(1)} />);
      expect(screen.getByRole("heading", { level: 2, name: /needs you/i })).toBeInTheDocument();
    });

    it("shows the decision count in the header meta", () => {
      render(<NeedsYou decisions={makeDecisions(1)} />);
      expect(screen.getByText("1 decision")).toBeInTheDocument();
    });

    it("shows plural 'decisions' when count > 1", () => {
      render(<NeedsYou decisions={makeDecisions(2)} />);
      expect(screen.getByText("2 decisions")).toBeInTheDocument();
    });
  });
});
