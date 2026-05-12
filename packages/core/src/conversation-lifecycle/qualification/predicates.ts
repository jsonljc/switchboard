import type { ConversationLifecycleSnapshot } from "@switchboard/schemas";

/**
 * Spec §8.1 query doctrine.
 *
 * Pending proposal = qualificationStatus is `proposed_disqualified` AND
 * the operator has not yet confirmed (currentState is not `disqualified`).
 *
 * Use this predicate for every "pending disqualifications" query —
 * the operator panel, future Recommendations v1 surfaces, ad-hoc analytics.
 * `currentState == "disqualified"` is the canonical operator-confirmed
 * terminal signal; never infer disqualification from qualificationStatus alone.
 */
export function isPendingDisqualification(snapshot: ConversationLifecycleSnapshot): boolean {
  return (
    snapshot.qualificationStatus === "proposed_disqualified" &&
    snapshot.currentState !== "disqualified"
  );
}
