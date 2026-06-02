"use client";

import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { undoToastProps } from "@/components/ui/undo-toast";
import { useToast } from "@/components/ui/use-toast";
import { InboxDecisionCard } from "@/components/inbox/inbox-decision-card";
import type { Decision } from "@/lib/decisions/types";
import type { AgentKey } from "@switchboard/schemas";

export interface InboxDecisionItemProps {
  decision: Decision;
  onOpenDetail: (decision: Decision) => void;
  /** Open the agent panel for the card's agent. Bubbled from the avatar button. */
  onOpenAgent?: (agentKey: AgentKey) => void;
}

/**
 * InboxDecisionItem — per-card hook wrapper for the P1-C inbox queue.
 *
 * React hooks can't run inside a `.map()`. Each queue row must own its OWN
 * `useRecommendationAction(...)`, so the per-row hook lives here, not in the
 * parent screen. This mirrors `components/home/needs-you-card.tsx`.
 *
 * Wiring:
 *   - onApprove  → action.primary()  + Undo toast (skipped on 409 { silent:true })
 *   - onSkip     → action.dismiss()
 *   - onOpenDetail / onTakeOver → both bubble to the parent's onOpenDetail,
 *     which mounts the detail sheet (handoff or approval)
 */
export function InboxDecisionItem({ decision, onOpenDetail, onOpenAgent }: InboxDecisionItemProps) {
  const { toast } = useToast();
  // The recommendation id is the decision's source id (NOT decision.id).
  const action = useRecommendationAction(decision.sourceRef.sourceId);

  const handleApprove = () => {
    if (action.isPending) return;
    void action
      .primary()
      .then((result: unknown) => {
        // 409 (already-terminal) returns { silent: true } — skip the undo offer.
        if (result && typeof result === "object" && "silent" in result) return;
        toast(
          undoToastProps({
            contactName: decision.meta.contactName,
            undoableUntil: decision.meta.undoableUntil,
            onUndo: () => void action.undo().catch(() => {}),
          }),
        );
      })
      // Error surfaces via action.error; swallow so the success toast never fires on rejection.
      .catch(() => {});
  };

  const handleSkip = () => {
    if (action.isPending) return;
    void action.dismiss().catch(() => {});
  };

  return (
    <InboxDecisionCard
      decision={decision}
      onApprove={handleApprove}
      onSkip={handleSkip}
      onOpenDetail={() => onOpenDetail(decision)}
      onTakeOver={() => onOpenDetail(decision)}
      onOpenAgent={onOpenAgent}
    />
  );
}
