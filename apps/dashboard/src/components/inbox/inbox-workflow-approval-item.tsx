"use client";

import { InboxDecisionCard } from "@/components/inbox/inbox-decision-card";
import type { Decision } from "@/lib/decisions/types";
import type { AgentKey } from "@switchboard/schemas";

export interface InboxWorkflowApprovalItemProps {
  decision: Decision;
  onOpenDetail: (decision: Decision) => void;
  /** Open the agent panel for the card's agent. Bubbled from the avatar button. */
  onOpenAgent?: (agentKey: AgentKey) => void;
}

/**
 * Queue row for a parked governed-workflow approval. Unlike recommendation
 * approvals there is NO swipe-commit path: approve needs the bindingHash +
 * confirm flow in the detail sheet, and "skip" has no server meaning for a
 * blocking governed approval. Every gesture routes to the detail sheet (the
 * conservative riskContract already blocks swipe-approve; routing onApprove /
 * onSkip to detail is defense in depth, and swipe-left must never fire the
 * recommendation responder with a lifecycle id).
 */
export function InboxWorkflowApprovalItem({
  decision,
  onOpenDetail,
  onOpenAgent,
}: InboxWorkflowApprovalItemProps) {
  const openDetail = () => onOpenDetail(decision);
  return (
    <InboxDecisionCard
      decision={decision}
      onApprove={openDetail}
      onSkip={openDetail}
      onOpenDetail={openDetail}
      onTakeOver={openDetail}
      onOpenAgent={onOpenAgent}
    />
  );
}
