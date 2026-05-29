import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { Decision, RiskContract } from "@/lib/decisions/types";

// ── Mutable mock state (house pattern) ───────────────────────────────────────

const toastMock = vi.fn();
let isPendingState = false;
const primaryMock = vi.fn(() => Promise.resolve({}));
const dismissMock = vi.fn(() => Promise.resolve({}));
const undoMock = vi.fn(() => Promise.resolve({}));
const useRecCtor = vi.fn(); // capture the id arg

vi.mock("@/hooks/use-recommendation-action", () => ({
  useRecommendationAction: (id: string) => {
    useRecCtor(id);
    return {
      primary: primaryMock,
      secondary: vi.fn(() => Promise.resolve({})),
      dismiss: dismissMock,
      confirm: vi.fn(() => Promise.resolve({})),
      undo: undoMock,
      isPending: isPendingState,
      error: null,
    };
  },
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { InboxDecisionItem } from "../inbox-decision-item";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const lowContract: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-999",
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
    // NOTE: sourceId is deliberately different from decision.id to catch id-mix-ups
    sourceRef: { kind: "approval", sourceId: "rec-source-abc" },
    meta: { contactName: "Maya R.", riskContract: lowContract },
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-handoff-7",
    kind: "handoff",
    agentKey: "riley",
    humanSummary: "Client wants to renegotiate their retainer — over to you.",
    presentation: {
      primaryLabel: "Take this one",
      secondaryLabel: "Snooze",
      dismissLabel: "Mark resolved",
      dataLines: [],
    },
    urgencyScore: 0.8,
    createdAt: new Date().toISOString(),
    threadHref: "/inbox/thread-handoff",
    sourceRef: { kind: "handoff", sourceId: "esc-source-xyz" },
    meta: { slaDeadlineAt: new Date(Date.now() + 45 * 60000).toISOString() },
    ...overrides,
  };
}

/** Simulate a horizontal mouse drag on the swipe track (mirrors inbox-decision-card.test). */
function drag(track: HTMLElement, deltaX: number) {
  fireEvent.mouseDown(track, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX < 0 ? -10 : 10, clientY: 0 });
  fireEvent.mouseMove(track, { clientX: deltaX, clientY: 0 });
  fireEvent.mouseUp(track, { clientX: deltaX, clientY: 0 });
}
function getTrack(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-swipe-track]") as HTMLElement;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InboxDecisionItem", () => {
  beforeEach(() => {
    isPendingState = false;
    toastMock.mockClear();
    primaryMock.mockClear().mockResolvedValue({});
    dismissMock.mockClear().mockResolvedValue({});
    undoMock.mockClear().mockResolvedValue({});
    useRecCtor.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // Test 1: hook id
  describe("(1) hook receives sourceRef.sourceId, NOT decision.id", () => {
    it("calls useRecommendationAction with the decision's sourceRef.sourceId", () => {
      const decision = makeDecision();
      render(<InboxDecisionItem decision={decision} onOpenDetail={vi.fn()} />);
      // sourceId is 'rec-source-abc', decision.id is 'dec-999' — must not be the same
      expect(decision.sourceRef.sourceId).not.toBe(decision.id);
      expect(useRecCtor).toHaveBeenCalledWith("rec-source-abc");
      expect(useRecCtor).not.toHaveBeenCalledWith("dec-999");
    });
  });

  // Test 2: approve → primaryMock called, toast with undo action
  describe("(2) approve — calls primary, shows Undo toast", () => {
    it("fires primaryMock and shows a toast with Undo action on success", async () => {
      primaryMock.mockResolvedValueOnce({});
      const { container } = render(
        <InboxDecisionItem decision={makeDecision()} onOpenDetail={vi.fn()} />,
      );

      drag(getTrack(container), 220); // swipe-right commits approve on a swipe-approvable card
      vi.runAllTimers();

      await vi.waitFor(() => {
        expect(primaryMock).toHaveBeenCalledTimes(1);
        expect(toastMock).toHaveBeenCalledTimes(1);
      });

      // The toast should include an action element with an Undo onClick
      const [toastArg] = toastMock.mock.calls[0];
      expect(toastArg).toHaveProperty("action");
      const actionEl = toastArg.action;
      expect(actionEl).toBeTruthy();

      // Click the Undo action and verify undoMock is called
      // actionEl is a React element — invoke its onClick prop
      actionEl.props.onClick();
      await vi.waitFor(() => {
        expect(undoMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  // Test 3: 409 silent → no toast
  describe("(3) 409 silent result — toast NOT fired", () => {
    it("skips the toast when primaryMock resolves { silent: true }", async () => {
      primaryMock.mockResolvedValueOnce({ silent: true });
      const { container } = render(
        <InboxDecisionItem decision={makeDecision()} onOpenDetail={vi.fn()} />,
      );

      drag(getTrack(container), 220);
      vi.runAllTimers();

      await vi.waitFor(() => {
        expect(primaryMock).toHaveBeenCalledTimes(1);
      });
      expect(toastMock).not.toHaveBeenCalled();
    });
  });

  // Test 4: swipe-left → dismissMock called
  describe("(4) skip — swipe-left calls dismiss", () => {
    it("calls dismissMock when the card is swiped left", async () => {
      const { container } = render(
        <InboxDecisionItem decision={makeDecision()} onOpenDetail={vi.fn()} />,
      );

      drag(getTrack(container), -220);
      vi.runAllTimers();

      await vi.waitFor(() => {
        expect(dismissMock).toHaveBeenCalledTimes(1);
      });
      expect(primaryMock).not.toHaveBeenCalled();
    });
  });

  // Test 5a: whole-card tap → onOpenDetail called with the decision
  describe("(5a) whole-card tap → onOpenDetail bubbles", () => {
    it("calls onOpenDetail with the decision when the card is tapped", () => {
      const onOpenDetail = vi.fn();
      const decision = makeDecision();
      const { container } = render(
        <InboxDecisionItem decision={decision} onOpenDetail={onOpenDetail} />,
      );

      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      expect(onOpenDetail).toHaveBeenCalledTimes(1);
      expect(onOpenDetail).toHaveBeenCalledWith(decision);
    });
  });

  // Test 5b: handoff is tap-only → onOpenDetail called, NOT primaryMock/dismissMock
  describe("(5b) handoff is tap-only → onOpenDetail, not a commit", () => {
    it("bubbles onOpenDetail and does NOT call primaryMock or dismissMock for a handoff", () => {
      const onOpenDetail = vi.fn();
      const handoff = makeHandoff();
      const { container } = render(
        <InboxDecisionItem decision={handoff} onOpenDetail={onOpenDetail} />,
      );

      fireEvent.click(container.querySelector("[data-card-body]") as HTMLElement);
      vi.runAllTimers();

      expect(onOpenDetail).toHaveBeenCalledTimes(1);
      expect(onOpenDetail).toHaveBeenCalledWith(handoff);
      expect(primaryMock).not.toHaveBeenCalled();
      expect(dismissMock).not.toHaveBeenCalled();
    });
  });
});
