import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { InboxDecisionCard } from "../inbox-decision-card";
import type { Decision, RiskContract } from "@/lib/decisions/types";

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

interface Handlers {
  onApprove: ReturnType<typeof vi.fn>;
  onSkip: ReturnType<typeof vi.fn>;
  onOpenDetail: ReturnType<typeof vi.fn>;
  onTakeOver: ReturnType<typeof vi.fn>;
}

function renderCard(decision: Decision) {
  const handlers: Handlers = {
    onApprove: vi.fn(),
    onSkip: vi.fn(),
    onOpenDetail: vi.fn(),
    onTakeOver: vi.fn(),
  };
  const utils = render(
    <InboxDecisionCard
      decision={decision}
      onApprove={handlers.onApprove}
      onSkip={handlers.onSkip}
      onOpenDetail={handlers.onOpenDetail}
      onTakeOver={handlers.onTakeOver}
    />,
  );
  const track = utils.container.querySelector("[data-swipe-track]") as HTMLElement;
  return { ...utils, ...handlers, track };
}

/** Simulate a horizontal mouse drag on the swipe track (mirrors swipe-decision-card.test). */
function drag(track: HTMLElement, deltaX: number) {
  fireEvent.mouseDown(track, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX < 0 ? -10 : 10, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX, clientY: 0 });
  fireEvent.mouseUp(track, { clientX: deltaX, clientY: 0 });
}

describe("<InboxDecisionCard>", () => {
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

    it("renders the agent head with 'needs you'", () => {
      renderCard(makeApproval(lowSafe));
      expect(screen.getByText("Alex")).toBeInTheDocument();
      expect(screen.getByText(/needs you/i)).toBeInTheDocument();
    });

    it("shows the risk pill from the contract", () => {
      renderCard(makeApproval({ ...lowSafe, riskLevel: "high" }));
      expect(screen.getByText(/high risk/i)).toBeInTheDocument();
    });

    it("shows a needs-review pill when the contract is absent", () => {
      renderCard(makeApproval(undefined));
      expect(screen.getByText(/needs review/i)).toBeInTheDocument();
    });

    it("renders an optional replyPreview when present", () => {
      renderCard(
        makeApproval(lowSafe, {
          meta: { riskContract: lowSafe, replyPreview: "Hi Maya, here's the comparison…" },
        }),
      );
      expect(screen.getByText("Hi Maya, here's the comparison…")).toBeInTheDocument();
    });
  });

  // (b) approval financial → swipe-right does NOT approve, opens detail
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

    it("does NOT render a replyPreview for a swipe-blocked approval", () => {
      renderCard(
        makeApproval(financial, {
          meta: { riskContract: financial, replyPreview: "Hidden until reviewable" },
        }),
      );
      expect(screen.queryByText("Hidden until reviewable")).not.toBeInTheDocument();
    });
  });

  // (c) handoff → SLA pill + "is handing this to you", no swipe-approve, primary → onTakeOver
  describe("handoff (always tap-only)", () => {
    it("is NEVER in swipe-approve mode even if a safe contract is somehow present", () => {
      const { track } = renderCard(makeHandoff({ meta: { riskContract: lowSafe } }));
      expect(track).toHaveAttribute("data-swipe-approve", "false");
    });

    it("renders the SLA pill from slaDeadlineAt", () => {
      renderCard(makeHandoff());
      expect(screen.getByText(/due in/i)).toBeInTheDocument();
    });

    it("renders 'is handing this to you' in the head", () => {
      renderCard(makeHandoff());
      expect(screen.getByText(/is handing this to you/i)).toBeInTheDocument();
    });

    it("does not render a risk pill", () => {
      renderCard(makeHandoff());
      expect(screen.queryByText(/risk/i)).not.toBeInTheDocument();
    });

    it("primary button uses presentation.primaryLabel and calls onTakeOver", () => {
      const { onTakeOver, onApprove } = renderCard(makeHandoff());
      fireEvent.click(screen.getByRole("button", { name: "Take this one" }));
      vi.runAllTimers();
      expect(onTakeOver).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });

    it("swipe-right does NOT approve — it opens detail", () => {
      const { track, onApprove, onTakeOver, onOpenDetail } = renderCard(makeHandoff());
      drag(track, 220);
      vi.runAllTimers();
      expect(onApprove).not.toHaveBeenCalled();
      expect(onTakeOver).not.toHaveBeenCalled();
      expect(onOpenDetail).toHaveBeenCalled();
    });
  });

  // (d) whole-card tap (no drag) → onOpenDetail
  describe("whole-card tap", () => {
    it("a tap with no drag opens detail", () => {
      const { container, onOpenDetail } = renderCard(makeApproval(lowSafe));
      const body = container.querySelector("[data-card-body]") as HTMLElement;
      fireEvent.click(body);
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it("clicking the primary button does NOT trigger the card-tap detail open", () => {
      const { onOpenDetail } = renderCard(makeApproval(lowSafe));
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      vi.runAllTimers();
      expect(onOpenDetail).not.toHaveBeenCalled();
    });
  });

  // The browser emits a synthetic `click` AFTER mousedown→mousemove→mouseup.
  // testing-library does NOT synthesize it, so we fire it explicitly to exercise
  // the trailing-click path that the consumeClick suppression guards against.
  describe("trailing synthetic click after a gesture", () => {
    it("sub-threshold drag then click does NOT open detail (it was a drag, not a tap)", () => {
      const { track, container, onOpenDetail } = renderCard(makeApproval(lowSafe));
      const body = container.querySelector("[data-card-body]") as HTMLElement;
      drag(track, 40); // moved past the dead-zone but snapped back
      vi.runAllTimers();
      fireEvent.click(body); // the browser's trailing synthetic click
      expect(onOpenDetail).not.toHaveBeenCalled();
    });

    it("blocked swipe-right then click opens detail EXACTLY ONCE (via prime, not doubled)", () => {
      const financial: RiskContract = { ...lowSafe, financialEffect: true };
      const { track, container, onApprove, onOpenDetail } = renderCard(makeApproval(financial));
      const body = container.querySelector("[data-card-body]") as HTMLElement;
      drag(track, 220); // past threshold, blocked → primeBlocked calls onOpenDetail once
      vi.runAllTimers();
      fireEvent.click(body); // trailing click must be suppressed, not a second open
      expect(onApprove).not.toHaveBeenCalled();
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it("a genuine no-move tap (down→up then click) opens detail once", () => {
      const { container, onOpenDetail } = renderCard(makeApproval(lowSafe));
      const body = container.querySelector("[data-card-body]") as HTMLElement;
      fireEvent.mouseDown(body, { clientX: 0, clientY: 0 });
      fireEvent.mouseUp(body, { clientX: 0, clientY: 0 });
      fireEvent.click(body);
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });
  });

  // (e) contact line + foot render from meta
  describe("contact line + foot", () => {
    it("renders the contact name and channel from meta", () => {
      renderCard(
        makeApproval(lowSafe, {
          meta: { riskContract: lowSafe, contactName: "Maya Lin", channel: "WhatsApp" },
        }),
      );
      expect(screen.getByText("Maya Lin")).toBeInTheDocument();
      expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    });

    it("renders the Why control which opens detail", () => {
      const { onOpenDetail } = renderCard(makeApproval(lowSafe));
      fireEvent.click(screen.getByRole("button", { name: /why/i }));
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it("renders View thread when threadHref is set and opens detail", () => {
      const { onOpenDetail } = renderCard(makeApproval(lowSafe));
      fireEvent.click(screen.getByRole("button", { name: /view thread/i }));
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it("does NOT render View thread when threadHref is null (no dead link)", () => {
      renderCard(makeApproval(lowSafe, { threadHref: null }));
      expect(screen.queryByRole("button", { name: /view thread/i })).not.toBeInTheDocument();
    });

    it("renders a relative timestamp in the foot", () => {
      renderCard(
        makeApproval(lowSafe, { createdAt: new Date(Date.now() - 5 * 60000).toISOString() }),
      );
      expect(screen.getByText("5m ago")).toBeInTheDocument();
    });
  });

  // Tap-Approve confirm-gating (mirrors SwipeDecisionCard) — needsConfirm routes through ConfirmSheet
  describe("tap-Approve confirm gating", () => {
    it("low+safe taps commit directly (no confirm dialog)", () => {
      const { onApprove } = renderCard(makeApproval(lowSafe));
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("requiresConfirmation opens the confirm sheet and commits only on affirmative", () => {
      const { onApprove } = renderCard(makeApproval({ ...lowSafe, requiresConfirmation: true }));
      fireEvent.click(screen.getByRole("button", { name: "Approve & send" }));
      const dialog = screen.getByRole("dialog");
      expect(onApprove).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: /yes/i }));
      vi.runAllTimers();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });
  });

  describe("skip / secondary is always available", () => {
    it("tapping the secondary on an approval calls onSkip", () => {
      const { onSkip } = renderCard(makeApproval(lowSafe));
      fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("swipe-left commits skip on a handoff", () => {
      const { track, onSkip, onTakeOver } = renderCard(makeHandoff());
      drag(track, -220);
      vi.runAllTimers();
      expect(onSkip).toHaveBeenCalledTimes(1);
      expect(onTakeOver).not.toHaveBeenCalled();
    });
  });
});
