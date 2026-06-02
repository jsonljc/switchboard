import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SwipeDecisionCard, ConfirmSheet } from "../swipe-decision-card";
import type { Decision, RiskContract } from "@/lib/decisions/types";
import { checkA11y } from "@/test-a11y";

// The swipe-to-approve card is the primary money/trust decision surface. A
// keyboard-inoperable or unlabeled control here excludes users and is a WCAG
// liability, so this asserts axe finds no structural violations on the
// approve/skip affordances, the non-swipe-approvable (financial) card state, and
// the ConfirmSheet dialog that guards confirm-required actions.

const lowContract: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

function makeDecision(contract: RiskContract = lowContract): Decision {
  return {
    id: "dec-a11y-1",
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

function renderCard(contract?: RiskContract) {
  return render(
    <SwipeDecisionCard
      decision={makeDecision(contract)}
      agentName="Alex"
      onApprove={vi.fn()}
      onSkip={vi.fn()}
      onOpenDetail={vi.fn()}
    />,
  );
}

describe("SwipeDecisionCard — accessibility", () => {
  it("has no axe violations for a swipe-approvable (low-risk) decision", async () => {
    const { container } = renderCard(lowContract);
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("has no axe violations for a non-swipe-approvable (financial) decision", async () => {
    const { container } = renderCard({ ...lowContract, financialEffect: true });
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("ConfirmSheet (open) has no axe violations", async () => {
    const { container } = render(
      <ConfirmSheet
        open
        agentName="Alex"
        summary="Send Maya the membership comparison?"
        affirmativeLabel="Approve & send"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
