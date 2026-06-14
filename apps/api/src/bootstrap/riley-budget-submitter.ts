import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { RileyBudgetSubmitter } from "@switchboard/ad-optimizer";
import type { RileyBudgetSubmitInput } from "../services/workflows/riley-budget-submit-request.js";

export interface RileyBudgetSubmitterDeps {
  /** The contained-workflows submitRileyBudget closure (absent when the bootstrap could not build
   * it, e.g. no database). */
  submitRileyBudget?: (
    input: RileyBudgetSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * SPEC-1B reallocate initiator (the apps/api half of the submit safety contract). The sink (PR
 * 1B-1.3) calls this for a flag-on org's reallocation candidate. Submits through PlatformIngress,
 * parking for mandatory approval. Returns PARK TRUTH. Best-effort: failures are caught and logged;
 * the weekly audit never breaks.
 *
 * Branch order is load-bearing (mirrors riley-pause-submitter.ts):
 *   null -> builder abstained; !ok -> entitlement NAMED skip or loud error;
 *   approvalRequired membership checked BEFORE reading the result as a success
 *   (the phantom-success gotcha); ok+outcome:"failed" -> governance DENY (loud);
 *   anything else -> the mandatory policy was relaxed (loudest: seeding broke).
 */
export function buildRileyBudgetSubmitter(deps: RileyBudgetSubmitterDeps): RileyBudgetSubmitter {
  return async (candidate) => {
    if (!deps.submitRileyBudget) return { parked: false };
    try {
      const res = await deps.submitRileyBudget(
        {
          organizationId: candidate.organizationId,
          recommendationId: candidate.recommendationId,
          adAccountId: candidate.adAccountId,
          campaignId: candidate.campaignId,
          fromCents: candidate.currentDailyBudgetCents,
          toCents: candidate.proposedDailyBudgetCents,
          rationale: candidate.rationale,
          evidence: candidate.evidence,
        },
        { deploymentId: candidate.deploymentId, skillSlug: "ad-optimizer" },
      );
      if (res === null) return { parked: false }; // builder abstained (malformed/no-op)
      if (!res.ok) {
        if (res.error.type === "entitlement_required") {
          // NAMED skip: an unentitled org is an honest, visible skip, never a silent no-op.
          deps.log.warn(
            `[inngest] riley reallocate skip:org_not_entitled org=${candidate.organizationId} rec=${candidate.recommendationId}`,
          );
          return { parked: false };
        }
        deps.log.error(
          `[inngest] riley reallocate submit error type=${res.error.type} rec=${candidate.recommendationId}: ${res.error.message}`,
        );
        return { parked: false };
      }
      // Phantom-success gotcha: branch on approvalRequired membership BEFORE reading the result.
      if ("approvalRequired" in res && res.approvalRequired) {
        deps.log.info(
          `[inngest] riley reallocate parked for approval rec=${candidate.recommendationId} lifecycle=${res.lifecycleId ?? "?"}`,
        );
        return { parked: true };
      }
      if (res.result.outcome === "failed") {
        // ok:true + outcome failed = governance DENY. Visible, loud.
        deps.log.error(
          `[inngest] riley reallocate submit denied/failed rec=${candidate.recommendationId}: ${res.result.error?.code ?? "unknown"}`,
        );
        return { parked: false };
      }
      // The mandatory policy means park-or-deny; reaching here means the gate relaxed. Loud:
      // investigate governance seeding before anything else (a money move must never auto-execute).
      deps.log.error(
        `[inngest] riley reallocate UNEXPECTEDLY executed without approval rec=${candidate.recommendationId} outcome=${res.result.outcome} - investigate governance seeding`,
      );
      return { parked: false };
    } catch (err) {
      deps.log.warn(
        `[inngest] riley reallocate submit threw for rec=${candidate.recommendationId}: ${String(err)}`,
      );
      return { parked: false };
    }
  };
}
