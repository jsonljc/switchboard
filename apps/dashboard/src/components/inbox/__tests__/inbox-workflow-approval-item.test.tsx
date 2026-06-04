import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Decision } from "@/lib/decisions/types";
import { InboxWorkflowApprovalItem } from "../inbox-workflow-approval-item";

const decision: Decision = {
  id: "workflow_approval:lc-1",
  kind: "workflow_approval",
  agentKey: "riley",
  humanSummary: "Riley wants to brief Mira to refresh creative on campaign camp-1: CTR halved.",
  presentation: {
    primaryLabel: "Approve handoff",
    secondaryLabel: "Not now",
    dismissLabel: "Reject",
    dataLines: ["Evidence: 1000 clicks, 50 conversions over 7 days"],
  },
  urgencyScore: 55,
  createdAt: new Date().toISOString(),
  threadHref: null,
  sourceRef: { kind: "workflow_approval", sourceId: "lc-1" },
  meta: {
    bindingHash: "hash-1",
    riskLevel: "medium",
    riskContract: {
      riskLevel: "medium",
      externalEffect: false,
      financialEffect: false,
      clientFacing: false,
      requiresConfirmation: true,
    },
  },
};

describe("InboxWorkflowApprovalItem", () => {
  it("renders the humanized card and opens detail on tap", () => {
    const onOpenDetail = vi.fn();
    render(<InboxWorkflowApprovalItem decision={decision} onOpenDetail={onOpenDetail} />);
    expect(screen.getByText(/Riley wants to brief Mira/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Riley wants to brief Mira/));
    expect(onOpenDetail).toHaveBeenCalledWith(decision);
  });

  it("never exposes a swipe-approve zone (requiresConfirmation contract)", () => {
    render(<InboxWorkflowApprovalItem decision={decision} onOpenDetail={vi.fn()} />);
    expect(screen.getByText("Tap to review")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();
  });

  it("labels the lead row as an approval", () => {
    render(<InboxWorkflowApprovalItem decision={decision} onOpenDetail={vi.fn()} />);
    expect(screen.getByText("approval")).toBeInTheDocument();
  });
});
