"use client";

import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { InboxDecisionCard } from "@/components/inbox/inbox-decision-card";
import type { Decision } from "@/lib/decisions/types";

export interface InboxDecisionItemProps {
  decision: Decision;
  onOpenDetail: (decision: Decision) => void;
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
 *   - onOpenDetail / onTakeOver → bubble up to the parent screen's onOpenDetail
 *     (handoff "take over" opens the detail in PR3a; the handoff sheet is PR3b)
 */
export function InboxDecisionItem({ decision, onOpenDetail }: InboxDecisionItemProps) {
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
        toast({
          title: "Approved",
          description: decision.meta.contactName
            ? `Sent for ${decision.meta.contactName}.`
            : undefined,
          action: (
            <ToastAction altText="Undo" onClick={() => void action.undo().catch(() => {})}>
              Undo
            </ToastAction>
          ),
        });
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
    />
  );
}
