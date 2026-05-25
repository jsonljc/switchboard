"use client";

import { useRouter } from "next/navigation";
import { DecisionCard } from "@/components/decisions/decision-card";
import { mapToDecisionCard } from "@/lib/decisions/map-to-decision-card";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import type { Decision } from "@/lib/decisions/types";

interface NeedsYouCardProps {
  decision: Decision;
  /** Position in the visible list — drives the decision-card folio number. */
  index: number;
}

/**
 * NeedsYouCard — one live, action-wired decision card on Home.
 *
 * Owns exactly ONE `useRecommendationAction` per card (hooks can't be called in
 * a variable-length loop, so the per-card hook lives here, not in the parent).
 * Wiring (matches the riley-cockpit-page single-owner-toast pattern):
 *   - approval primary  → action.primary()  ("approve")
 *   - approval secondary → action.dismiss()  ("skip")
 *   - handoff (no recommendationId) → open the thread / route to /inbox.
 *     Full handoff resolution is Phase 2 — we never call the recommendation
 *     mutation for a handoff (the id would not be a recommendation).
 * After a successful approval action we fire an Undo toast wired to action.undo().
 */
export function NeedsYouCard({ decision, index }: NeedsYouCardProps) {
  const router = useRouter();
  const { toast } = useToast();
  // The recommendation id is the decision's source id (see dispatch-action.ts),
  // NOT decision.id. For handoffs this is an escalation id and is never sent to
  // the recommendation mutation below.
  const action = useRecommendationAction(decision.sourceRef.sourceId);

  const cardProps = mapToDecisionCard(decision, index);

  const isHandoff = decision.kind === "handoff";

  const openThread = () => {
    if (decision.threadHref) router.push(decision.threadHref);
    else router.push("/inbox");
  };

  const handlePrimary = () => {
    if (action.isPending) return;
    if (isHandoff) {
      // Phase 2 owns full handoff resolution; for now the primary opens the thread.
      openThread();
      return;
    }
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
      // Error surfaces via TanStack Query (`action.error`); swallow here so the
      // success-only toast never fires on rejection.
      .catch(() => {});
  };

  const handleSecondary = () => {
    if (action.isPending) return;
    if (isHandoff) {
      // Secondary on a handoff also routes to the thread/inbox in P1-A.
      openThread();
      return;
    }
    void action.dismiss().catch(() => {});
  };

  return (
    <div data-testid="decision-card">
      <DecisionCard {...cardProps} onPrimary={handlePrimary} onSecondary={handleSecondary} />
    </div>
  );
}
