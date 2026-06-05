import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Decision, RiskContract } from "@/lib/decisions/types";
import { checkA11y } from "@/test-a11y";

// The inbox approval detail sheet is where an operator commits/declines an
// agent's proposed action — a money/trust surface that must be screen-reader
// and keyboard accessible (dialog semantics, named controls, labeled note input).

vi.mock("../inbox-agent-avatar", () => ({
  InboxAgentAvatar: ({ agentKey }: { agentKey: string }) => (
    <span data-testid="agent-avatar" data-agent-key={agentKey} />
  ),
}));

import { ApprovalDetailSheet } from "../approval-detail-sheet";

const lowContract: RiskContract = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
};

function makeDecision(contract: RiskContract = lowContract): Decision {
  return {
    id: "dec-a11y-sheet",
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

function renderSheet(contract?: RiskContract) {
  return render(
    <ApprovalDetailSheet
      decision={makeDecision(contract)}
      nowMs={1_700_000_000_000}
      onClose={vi.fn()}
      onCommit={vi.fn()}
      onSecondary={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

describe("ApprovalDetailSheet — accessibility", () => {
  it("has no axe violations (low-risk approval)", async () => {
    const { container } = renderSheet(lowContract);
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it("has no axe violations (financial, confirm-gated)", async () => {
    const { container } = renderSheet({
      ...lowContract,
      financialEffect: true,
      requiresConfirmation: true,
    });
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
