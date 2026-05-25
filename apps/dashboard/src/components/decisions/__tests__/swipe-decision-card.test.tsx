import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SwipeDecisionCard } from "../swipe-decision-card";
import type { Decision, RiskContract } from "@/lib/decisions/types";

/**
 * SAFETY PROOF for P1-B E5a.
 *
 * The non-negotiable invariant (spec §8.4): swipe-to-approve commits ONLY when
 * `canSwipeApprove(contract)` is true. A missing / financial / client-facing /
 * external / high-risk contract can NEVER be approved by swipe, and any
 * `needsConfirm` decision must route through the confirm step before committing.
 *
 * These tests drive the gate from the contract → predicate, NOT from copy. We
 * assert both the button path (tap Approve) and, where possible, simulated
 * drag, plus the `data-swipe-approve` / `data-armed` affordances the component
 * exposes.
 */

const lowContract: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

function makeDecision(contract?: RiskContract, overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    kind: "approval",
    agentKey: "alex",
    humanSummary: "Should I send Maya the membership comparison?",
    presentation: {
      primaryLabel: "Approve & send",
      secondaryLabel: "Not yet",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    urgencyScore: 0.5,
    createdAt: new Date().toISOString(),
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { riskContract: contract },
    ...overrides,
  };
}

interface Handlers {
  onApprove: ReturnType<typeof vi.fn>;
  onSkip: ReturnType<typeof vi.fn>;
  onOpenDetail: ReturnType<typeof vi.fn>;
}

function renderCard(contract?: RiskContract, overrides: Partial<Decision> = {}) {
  const handlers: Handlers = {
    onApprove: vi.fn(),
    onSkip: vi.fn(),
    onOpenDetail: vi.fn(),
  };
  const utils = render(
    <SwipeDecisionCard
      decision={makeDecision(contract, overrides)}
      agentName="Alex"
      onApprove={handlers.onApprove}
      onSkip={handlers.onSkip}
      onOpenDetail={handlers.onOpenDetail}
    />,
  );
  const track = utils.container.querySelector("[data-swipe-track]") as HTMLElement;
  return { ...utils, ...handlers, track };
}

/** Simulate a horizontal mouse drag on the swipe track. */
function drag(track: HTMLElement, deltaX: number) {
  fireEvent.mouseDown(track, { clientX: 0, clientY: 0 });
  // First move past the axis-lock dead zone, then to the target delta.
  fireEvent.mouseMove(track, { clientX: deltaX < 0 ? -10 : 10, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX, clientY: 0 });
  fireEvent.mouseUp(track, { clientX: deltaX, clientY: 0 });
}

describe("SwipeDecisionCard — gating (the safety proof)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe("pure low-risk (swipe-approvable)", () => {
    it("tapping Approve commits directly — no confirm step", () => {
      const { onApprove } = renderCard(lowContract);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      // No confirm dialog appears; approve commits straight away.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("is in swipe-approve mode and the hint says swipe approves", () => {
      const { track } = renderCard(lowContract);
      expect(track).toHaveAttribute("data-swipe-approve", "true");
      expect(screen.getByText(/swipe.*approv/i)).toBeInTheDocument();
    });

    it("swipe-right commits approve", () => {
      const { track, onApprove, onSkip } = renderCard(lowContract);
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onSkip).not.toHaveBeenCalled();
    });
  });

  // SPEC §8.4: budget / publishing / booking-exception / client-facing actions are
  // swipe-BLOCKED — "commit requires an explicit button TAP" (the deliberate tap is the
  // commit; the confirm step is reserved for `requiresConfirmation` / high-value). So a
  // financial-only card is NOT swipe-approvable yet a deliberate button tap commits
  // directly. The accidental-approval vector (swipe) is what is closed here.
  describe("financialEffect:true (swipe-blocked, deliberate-tap commits)", () => {
    const financial: RiskContract = { ...lowContract, financialEffect: true };

    it("is NOT in swipe-approve mode", () => {
      const { track } = renderCard(financial);
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("swipe-right NEVER commits approve — it rubber-bands and primes the button", () => {
      const { track, onApprove, onOpenDetail } = renderCard(financial);
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      // Blocked swipe primes the Approve button and opens detail — never commits.
      expect(screen.getByRole("button", { name: "Approve & send" })).toHaveAttribute(
        "data-armed",
        "true",
      );
      expect(onOpenDetail).toHaveBeenCalled();
    });

    it("a deliberate button TAP commits (no confirm step — needsConfirm is false)", () => {
      const { onApprove } = renderCard(financial);
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      // No accidental-path confirm; the deliberate tap is the §8.4 commit.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });
  });

  // A budget move ALSO flagged requiresConfirmation → swipe-blocked AND confirm step.
  describe("financial + requiresConfirmation (swipe-blocked AND confirm step)", () => {
    const budget: RiskContract = {
      ...lowContract,
      financialEffect: true,
      requiresConfirmation: true,
    };

    it("is NOT in swipe-approve mode", () => {
      const { track } = renderCard(budget);
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("tapping Approve does NOT immediately commit — it opens the confirm step", () => {
      const { onApprove } = renderCard(budget);
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("commits onApprove only after confirming in the sheet", () => {
      const { onApprove } = renderCard(budget);
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /yes/i }));
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("does NOT commit when the confirm step is dismissed with Not now", () => {
      const { onApprove } = renderCard(budget);
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /not now/i }));
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("swipe-right NEVER commits approve — it rubber-bands and primes the button", () => {
      const { track, onApprove } = renderCard(budget);
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  describe("clientFacing:true (swipe-blocked)", () => {
    it("is not swipe-approvable", () => {
      const { track } = renderCard({ ...lowContract, clientFacing: true });
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("swipe-right never commits approve", () => {
      const { track, onApprove } = renderCard({ ...lowContract, clientFacing: true });
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  describe("externalEffect:true (blocked)", () => {
    it("is not swipe-approvable", () => {
      const { track } = renderCard({ ...lowContract, externalEffect: true });
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });
  });

  describe("riskLevel medium (blocked) / high (confirm)", () => {
    it("medium risk is not swipe-approvable", () => {
      const { track } = renderCard({ ...lowContract, riskLevel: "medium" });
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("high risk requires the confirm step on tap Approve", () => {
      const { onApprove } = renderCard({ ...lowContract, riskLevel: "high" });
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("requiresConfirmation:true (otherwise low) still routes through confirm", () => {
      const { onApprove } = renderCard({ ...lowContract, requiresConfirmation: true });
      // Not swipe-approvable is allowed to differ from confirm; the law is confirm-on-tap.
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("missing contract (unsafe default)", () => {
    it("is NOT swipe-approvable", () => {
      const { track } = renderCard(undefined);
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("tapping Approve requires the confirm step", () => {
      const { onApprove } = renderCard(undefined);
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("swipe-right never commits approve for a missing contract", () => {
      const { track, onApprove } = renderCard(undefined);
      drag(track, 240);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
    });

    it("shows a locked / needs-review treatment", () => {
      renderCard(undefined);
      expect(screen.getByText(/needs review/i)).toBeInTheDocument();
    });
  });

  describe("Skip is always allowed regardless of risk", () => {
    it("tapping Skip on a low-risk card calls onSkip", () => {
      const { onSkip } = renderCard(lowContract);
      fireEvent.click(screen.getByRole("button", { name: /skip/i }));
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("tapping Skip on a financial card calls onSkip", () => {
      const { onSkip } = renderCard({ ...lowContract, financialEffect: true });
      fireEvent.click(screen.getByRole("button", { name: /skip/i }));
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("tapping Skip on a missing-contract card calls onSkip", () => {
      const { onSkip } = renderCard(undefined);
      fireEvent.click(screen.getByRole("button", { name: /skip/i }));
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("swipe-left commits skip on a blocked (financial) card", () => {
      const { track, onSkip, onApprove } = renderCard({ ...lowContract, financialEffect: true });
      drag(track, -220);
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  describe("risk pill", () => {
    it("reflects the contract risk level", () => {
      renderCard({ ...lowContract, riskLevel: "high" });
      expect(screen.getByText(/high risk/i)).toBeInTheDocument();
    });
  });

  describe("agent identity", () => {
    it("renders the agent name", () => {
      renderCard(lowContract);
      expect(screen.getByText("Alex")).toBeInTheDocument();
    });
  });
});
