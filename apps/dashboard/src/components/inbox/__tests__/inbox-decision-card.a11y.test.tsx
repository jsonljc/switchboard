import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { InboxDecisionCard } from "../inbox-decision-card";
import type { Decision, RiskContract } from "@/lib/decisions/types";
import { checkA11y } from "@/test-a11y";

// The inbox decision card is the central authed triage surface. Its primary tap
// target must be a real, keyboard-operable control (WCAG 2.1.1 / 4.1.2) so
// keyboard and assistive-technology users can open the detail sheet — not a bare
// clickable <div>. These assert axe finds no structural violations AND that the
// tap target carries button semantics + Enter/Space activation.

// Mock the animated sprite avatar to avoid canvas/act() noise.
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

function makeApproval(contract?: RiskContract): Decision {
  return {
    id: "dec-approval-a11y",
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
    createdAt: "2026-06-02T10:00:00.000Z",
    threadHref: "/contacts/maya/conversations",
    sourceRef: { kind: "approval", sourceId: "rec-1" },
    meta: { riskContract: contract },
  };
}

function makeHandoff(): Decision {
  return {
    id: "dec-handoff-a11y",
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
    createdAt: "2026-06-02T10:00:00.000Z",
    threadHref: null,
    sourceRef: { kind: "handoff", sourceId: "esc-1" },
    meta: { slaDeadlineAt: "2026-06-02T11:00:00.000Z" },
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
      nowMs={Date.parse("2026-06-02T10:00:00.000Z")}
    />,
  );
  // The keyboard/AT tap target — a real <button> with an "Open details" name.
  // (The mouse/touch swipe surface, [data-swipe-track], stays a plain div.)
  const tapTarget = utils.getByRole("button", { name: /open details/i });
  return { ...utils, ...handlers, tapTarget };
}

describe("<InboxDecisionCard> — accessibility & keyboard", () => {
  it("has no axe violations for a swipe-approvable approval", async () => {
    const { container } = renderCard(makeApproval(lowSafe));
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("has no axe violations for a tap-only handoff", async () => {
    const { container } = renderCard(makeHandoff());
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("exposes a keyboard tap target as a real button with an accessible name", () => {
    const { tapTarget } = renderCard(makeApproval(lowSafe));
    // Keyboard / assistive-tech users must reach a real, named button to open
    // the detail sheet — not a bare clickable <div> (WCAG 2.1.1 / 4.1.2).
    expect(tapTarget.tagName).toBe("BUTTON");
    expect(tapTarget).toHaveAttribute("type", "button");
  });

  it("opens detail on Enter", () => {
    const { tapTarget, onOpenDetail } = renderCard(makeApproval(lowSafe));
    fireEvent.keyDown(tapTarget, { key: "Enter" });
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("opens detail on Space", () => {
    const { tapTarget, onOpenDetail } = renderCard(makeApproval(lowSafe));
    fireEvent.keyDown(tapTarget, { key: " " });
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys (does not open detail on Tab/Escape)", () => {
    const { tapTarget, onOpenDetail } = renderCard(makeApproval(lowSafe));
    fireEvent.keyDown(tapTarget, { key: "Tab" });
    fireEvent.keyDown(tapTarget, { key: "Escape" });
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("opens detail on Enter for a handoff too", () => {
    const { tapTarget, onOpenDetail } = renderCard(makeHandoff());
    fireEvent.keyDown(tapTarget, { key: "Enter" });
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("a keyboard activation is not suppressed by the pointer drag-guard", () => {
    // The drag-guard (consumeClick) only suppresses the synthetic click that
    // follows a pointer drag. A keyboard open routes through onOpenDetail
    // directly, so Enter must open even with no preceding pointer interaction.
    const { tapTarget, onOpenDetail } = renderCard(makeApproval(lowSafe));
    fireEvent.keyDown(tapTarget, { key: "Enter" });
    fireEvent.keyDown(tapTarget, { key: "Enter" });
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
  });
});
