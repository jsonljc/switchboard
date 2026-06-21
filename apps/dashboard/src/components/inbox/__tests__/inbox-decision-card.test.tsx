import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InboxDecisionCard } from "../inbox-decision-card";
import type { Decision, RiskContract } from "@/lib/decisions/types";

// Mock the animated sprite avatar to avoid canvas/act() noise — the card's
// behavior (swipe/tap/affordance), not the sprite, is what these tests verify.
vi.mock("@/components/inbox/inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

const lowSafe: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

function makeApproval(contract?: RiskContract, overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-approval",
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

function makeHandoff(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-handoff",
    kind: "handoff",
    agentKey: "riley",
    humanSummary: "This client wants to renegotiate their retainer — over to you.",
    presentation: {
      primaryLabel: "Take this one",
      secondaryLabel: "Snooze",
      dismissLabel: "Mark resolved",
      dataLines: [],
    },
    urgencyScore: 0.8,
    createdAt: new Date().toISOString(),
    threadHref: null,
    sourceRef: { kind: "handoff", sourceId: "esc-1" },
    meta: { slaDeadlineAt: new Date(Date.now() + 45 * 60000).toISOString() },
    ...overrides,
  };
}

function renderCard(decision: Decision) {
  const handlers = {
    onApprove: vi.fn(),
    onSkip: vi.fn(),
    onOpenDetail: vi.fn(),
    onTakeOver: vi.fn(),
    onOpenAgent: vi.fn(),
  };
  const utils = render(
    <InboxDecisionCard
      decision={decision}
      onApprove={handlers.onApprove}
      onSkip={handlers.onSkip}
      onOpenDetail={handlers.onOpenDetail}
      onTakeOver={handlers.onTakeOver}
      onOpenAgent={handlers.onOpenAgent}
    />,
  );
  const track = utils.container.querySelector("[data-swipe-track]") as HTMLElement;
  const body = utils.container.querySelector("[data-card-body]") as HTMLElement;
  const affordance = () => utils.container.querySelector(".decision-foot-affordance");
  return { ...utils, ...handlers, track, body, affordance };
}

/** Simulate a horizontal mouse drag on the swipe track. */
function drag(track: HTMLElement, deltaX: number) {
  fireEvent.mouseDown(track, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX < 0 ? -10 : 10, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX, clientY: 0 });
  fireEvent.mouseUp(track, { clientX: deltaX, clientY: 0 });
}

describe("<InboxDecisionCard> (doorway card)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // (a) approval with low+safe riskContract → swipe-right calls onApprove
  describe("approval — low + safe contract (swipe-approvable)", () => {
    it("is in swipe-approve mode", () => {
      const { track } = renderCard(makeApproval(lowSafe));
      expect(track).toHaveAttribute("data-swipe-approve", "true");
    });

    it("swipe-right commits onApprove", () => {
      const { track, onApprove, onSkip } = renderCard(makeApproval(lowSafe));
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onSkip).not.toHaveBeenCalled();
    });

    it("shows the 'Swipe →' foot affordance", () => {
      const { affordance } = renderCard(makeApproval(lowSafe));
      expect(affordance()).toHaveTextContent(/swipe/i);
    });
  });

  // (b) approval with an effect → swipe-right does NOT approve, opens detail
  describe("approval — financialEffect:true (swipe-blocked)", () => {
    const financial: RiskContract = { ...lowSafe, financialEffect: true };

    it("is NOT in swipe-approve mode", () => {
      const { track } = renderCard(makeApproval(financial));
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("swipe-right NEVER commits approve and opens detail instead", () => {
      const { track, onApprove, onOpenDetail } = renderCard(makeApproval(financial));
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(onOpenDetail).toHaveBeenCalled();
    });

    it("shows the 'Tap to review →' foot affordance, not 'Swipe'", () => {
      const { affordance } = renderCard(makeApproval(financial));
      expect(affordance()).toHaveTextContent(/tap to review/i);
      expect(affordance()).not.toHaveTextContent(/swipe/i);
    });
  });

  // (c) lead row identity + risk pill + quiet contact + timestamp
  describe("lead row, risk pill, contact, timestamp", () => {
    it("renders the agent name and the 'approval' kind word", () => {
      const { getByText } = renderCard(makeApproval(lowSafe));
      expect(getByText("Alex")).toBeInTheDocument();
      expect(getByText("approval")).toBeInTheDocument();
    });

    it("shows the risk pill from the contract", () => {
      const { getByText } = renderCard(makeApproval({ ...lowSafe, riskLevel: "high" }));
      expect(getByText(/high risk/i)).toBeInTheDocument();
    });

    it("renders no risk pill and is tap-only when the contract is absent", () => {
      const { track, queryByText, affordance } = renderCard(makeApproval(undefined));
      expect(track).toHaveAttribute("data-swipe-approve", "false");
      expect(queryByText(/risk/i)).toBeNull();
      expect(affordance()).toHaveTextContent(/tap to review/i);
    });

    it("renders the contact name (quiet) but NOT the channel (a sheet-only field)", () => {
      const { getByText, queryByText } = renderCard(
        makeApproval(lowSafe, {
          meta: { riskContract: lowSafe, contactName: "Maya Lin", channel: "WhatsApp" },
        }),
      );
      expect(getByText("Maya Lin")).toBeInTheDocument();
      expect(queryByText("WhatsApp")).toBeNull();
    });

    it("renders a relative timestamp in the foot", () => {
      const { getByText } = renderCard(
        makeApproval(lowSafe, { createdAt: new Date(Date.now() - 5 * 60000).toISOString() }),
      );
      expect(getByText("5m ago")).toBeInTheDocument();
    });
  });

  // (d) handoff → SLA pill + 'handoff' kind word, never swipe-approve, tap-only
  describe("handoff (always tap-only)", () => {
    it("is NEVER in swipe-approve mode even if a safe contract is somehow present", () => {
      const { track } = renderCard(makeHandoff({ meta: { riskContract: lowSafe } }));
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("renders the SLA pill from slaDeadlineAt", () => {
      const { getByText } = renderCard(makeHandoff());
      expect(getByText(/due in/i)).toBeInTheDocument();
    });

    it("renders the agent name and the 'handoff' kind word", () => {
      const { getByText } = renderCard(makeHandoff());
      expect(getByText("Riley")).toBeInTheDocument();
      expect(getByText("handoff")).toBeInTheDocument();
    });

    it("does not render a risk pill", () => {
      const { queryByText } = renderCard(makeHandoff());
      expect(queryByText(/risk/i)).not.toBeInTheDocument();
    });

    it("shows the 'Tap to open →' foot affordance", () => {
      const { affordance } = renderCard(makeHandoff());
      expect(affordance()).toHaveTextContent(/tap to open/i);
    });

    it("swipe-right does NOT approve — it opens detail", () => {
      const { track, onApprove, onTakeOver, onOpenDetail } = renderCard(makeHandoff());
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(onTakeOver).not.toHaveBeenCalled();
      expect(onOpenDetail).toHaveBeenCalled();
    });

    it("swipe-left commits skip", () => {
      const { track, onSkip, onTakeOver } = renderCard(makeHandoff());
      drag(track, -220);
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onTakeOver).not.toHaveBeenCalled();
    });
  });

  // (e) whole-card tap → onOpenDetail (+ trailing synthetic-click suppression)
  describe("whole-card tap opens detail", () => {
    it("a tap with no drag opens detail", () => {
      const { body, onOpenDetail } = renderCard(makeApproval(lowSafe));
      fireEvent.click(body);
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    // The browser emits a synthetic click AFTER mousedown→mousemove→mouseup;
    // testing-library does not, so we fire it explicitly to exercise the
    // consumeClick suppression that guards against a drag being read as a tap.
    it("sub-threshold drag then click does NOT open detail (it was a drag, not a tap)", () => {
      const { track, body, onOpenDetail } = renderCard(makeApproval(lowSafe));
      drag(track, 40); // moved past the dead-zone but snapped back
      vi.runAllTimers();
      fireEvent.click(body);
      expect(onOpenDetail).not.toHaveBeenCalled();
    });

    it("blocked swipe-right then click opens detail EXACTLY ONCE (via prime, not doubled)", () => {
      const financial: RiskContract = { ...lowSafe, financialEffect: true };
      const { track, body, onApprove, onOpenDetail } = renderCard(makeApproval(financial));
      drag(track, 220); // past threshold, blocked → primeBlocked calls onOpenDetail once
      vi.runAllTimers();
      fireEvent.click(body); // trailing click must be suppressed, not a second open
      expect(onApprove).not.toHaveBeenCalled();
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it("a genuine no-move tap (down→up then click) opens detail once", () => {
      const { body, onOpenDetail } = renderCard(makeApproval(lowSafe));
      fireEvent.mouseDown(body, { clientX: 0, clientY: 0 });
      fireEvent.mouseUp(body, { clientX: 0, clientY: 0 });
      fireEvent.click(body);
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });
  });

  // (f) avatar identity button → onOpenAgent, never the card-tap detail
  describe("agent avatar button", () => {
    it("clicking the avatar calls onOpenAgent and does NOT open the detail", () => {
      const { getByRole, onOpenAgent, onOpenDetail } = renderCard(makeApproval(lowSafe));
      fireEvent.click(getByRole("button", { name: /open alex panel/i }));
      expect(onOpenAgent).toHaveBeenCalledWith("alex");
      expect(onOpenDetail).not.toHaveBeenCalled();
    });
  });

  // (g) quiet dollar-at-stake hint — visible only when dollarsAtRisk > 0
  describe("dollar-at-stake hint", () => {
    it("shows a quiet dollar figure only when dollarsAtRisk > 0", () => {
      const { rerender } = render(
        <InboxDecisionCard
          decision={makeApproval(lowSafe, { meta: { riskContract: lowSafe, dollarsAtRisk: 450 } })}
          onApprove={vi.fn()}
          onSkip={vi.fn()}
          onOpenDetail={vi.fn()}
          onTakeOver={vi.fn()}
        />,
      );
      expect(screen.getByText(/S\$450/)).toBeInTheDocument();

      rerender(
        <InboxDecisionCard
          decision={makeApproval(lowSafe, { meta: { riskContract: lowSafe, dollarsAtRisk: 0 } })}
          onApprove={vi.fn()}
          onSkip={vi.fn()}
          onOpenDetail={vi.fn()}
          onTakeOver={vi.fn()}
        />,
      );
      expect(screen.queryByText(/S\$/)).not.toBeInTheDocument();
    });

    it("shows no dollar figure when dollarsAtRisk is absent", () => {
      renderCard(makeApproval(lowSafe));
      expect(screen.queryByText(/S\$/)).not.toBeInTheDocument();
    });
  });
});
