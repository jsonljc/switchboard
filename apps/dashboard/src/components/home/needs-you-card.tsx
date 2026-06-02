"use client";

import { useRouter } from "next/navigation";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import { SwipeDecisionCard } from "@/components/decisions/swipe-decision-card";
import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { undoToastProps } from "@/components/ui/undo-toast";
import { useToast } from "@/components/ui/use-toast";
import type { Decision } from "@/lib/decisions/types";

interface NeedsYouCardProps {
  decision: Decision;
  /** Position in the visible list — drives the fallback decision-card folio number. */
  index: number;
}

/**
 * NeedsYouCard — one live, risk-gated decision card on Home.
 *
 * Owns exactly ONE `useRecommendationAction` per card (hooks can't be called in
 * a variable-length loop, so the per-card hook lives here, not in the parent).
 *
 * Approvals: rendered via `SwipeDecisionCard` — the risk gate
 * (canSwipeApprove / needsConfirm) is enforced entirely inside the card.
 * This component only provides the commit callbacks.
 *
 * Handoffs: rendered via the simple `DecisionCard`. Handoffs are not
 * recommendation-committable — they route to the thread/inbox. The risk gate
 * is not applied here; handoff escalations are resolved in Phase 2.
 *
 * Wiring:
 *   - approval onApprove  → action.primary()  + Undo toast
 *   - approval onSkip     → action.dismiss()
 *   - handoff primary/secondary → open the thread / route to /inbox.
 *     Full handoff resolution is Phase 2 — we never call the recommendation
 *     mutation for a handoff (the id would not be a recommendation).
 */
export function NeedsYouCard({ decision, index }: NeedsYouCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  // The recommendation id is the decision's source id (see dispatch-action.ts),
  // NOT decision.id. For handoffs this is an escalation id and is never sent to
  // the recommendation mutation below.
  const action = useRecommendationAction(decision.sourceRef.sourceId);

  const isHandoff = decision.kind === "handoff";
  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;

  const openThread = () => {
    if (decision.threadHref) router.push(decision.threadHref);
    else router.push("/inbox");
  };

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
      // Error surfaces via TanStack Query (`action.error`); swallow here so the
      // success-only toast never fires on rejection.
      .catch(() => {});
  };

  const handleSkip = () => {
    if (action.isPending) return;
    void action.dismiss().catch(() => {});
  };

  // Handoffs route to the thread — they are NOT committable via the recommendation
  // mutation. Render with the simple DecisionCard (no risk gate needed).
  if (isHandoff) {
    const cardProps = mapToDecisionCard(decision, index);
    return (
      <div data-testid="decision-card">
        <DecisionCard {...cardProps} onPrimary={openThread} onSecondary={openThread} />
      </div>
    );
  }

  // Approval: risk-gated swipe card. The gate is enforced inside SwipeDecisionCard.
  return (
    <SwipeDecisionCard
      decision={decision}
      agentName={agentName}
      onApprove={handleApprove}
      onSkip={handleSkip}
      skipLabel={decision.presentation.secondaryLabel}
    />
  );
}
