import type { SubmitWorkResponse } from "@switchboard/core/platform";
import type { RileyPauseSubmitter } from "@switchboard/ad-optimizer";
import type { RileyPauseSubmitInput } from "../services/workflows/riley-pause-submit-request.js";

export interface RileyPauseSubmitterDeps {
  /** The contained-workflows submitRileyPause closure (absent when the
   * bootstrap could not build it, e.g. no database). */
  submitRileyPause?: (
    input: RileyPauseSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * Phase-C pause initiator (the apps/api half of the submit safety contract).
 * The cron (via the audit-runner sink) calls this for the arbitration-primary
 * pause of a flag-on org. Submits through PlatformIngress, parking for
 * mandatory approval. Returns PARK TRUTH for strict-truth ownership.
 * Best-effort: failures are caught and logged; the weekly audit never breaks.
 *
 * Branch order is load-bearing (pinned by riley-pause-submitter.test.ts):
 *   null -> builder abstained; !ok -> entitlement NAMED skip or loud error;
 *   approvalRequired membership checked BEFORE reading the result as a success
 *   (the phantom-success gotcha); ok+outcome:"failed" -> governance DENY (loud);
 *   anything else -> the mandatory policy was relaxed (loudest: seeding broke).
 */
export function buildRileyPauseSubmitter(deps: RileyPauseSubmitterDeps): RileyPauseSubmitter {
  return async (candidate) => {
    if (!deps.submitRileyPause) return { parked: false };
    try {
      const res = await deps.submitRileyPause(
        {
          organizationId: candidate.organizationId,
          recommendationId: candidate.recommendationId,
          campaignId: candidate.campaignId,
          rationale: candidate.rationale,
          evidence: candidate.evidence,
        },
        { deploymentId: candidate.deploymentId, skillSlug: "ad-optimizer" },
      );
      if (res === null) return { parked: false }; // builder abstained (class/floor)
      if (!res.ok) {
        if (res.error.type === "entitlement_required") {
          // NAMED skip: an unentitled org is an honest, visible skip, never a
          // silent no-op that reads as "Riley chose not to act".
          deps.log.warn(
            `[inngest] riley pause skip:org_not_entitled org=${candidate.organizationId} rec=${candidate.recommendationId}`,
          );
          return { parked: false };
        }
        deps.log.error(
          `[inngest] riley pause submit error type=${res.error.type} rec=${candidate.recommendationId}: ${res.error.message}`,
        );
        return { parked: false };
      }
      // Phantom-success gotcha: branch on approvalRequired membership BEFORE
      // reading the result as a success.
      if ("approvalRequired" in res && res.approvalRequired) {
        deps.log.info(
          `[inngest] riley pause parked for approval rec=${candidate.recommendationId} lifecycle=${res.lifecycleId ?? "?"}`,
        );
        return { parked: true };
      }
      if (res.result.outcome === "failed") {
        // ok:true + outcome failed = governance DENY. Visible, loud.
        deps.log.error(
          `[inngest] riley pause submit denied/failed rec=${candidate.recommendationId}: ${res.result.error?.code ?? "unknown"}`,
        );
        return { parked: false };
      }
      // The mandatory policy means park-or-deny; reaching here means the gate
      // relaxed. Loud: investigate governance seeding before anything else.
      deps.log.error(
        `[inngest] riley pause UNEXPECTEDLY executed without approval rec=${candidate.recommendationId} outcome=${res.result.outcome} - investigate governance seeding`,
      );
      return { parked: false };
    } catch (err) {
      deps.log.warn(
        `[inngest] riley pause submit threw for rec=${candidate.recommendationId}: ${String(err)}`,
      );
      return { parked: false };
    }
  };
}
