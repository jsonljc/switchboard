import type { WorkflowHandler } from "@switchboard/core/platform";
import type { PrismaCreativeJobStore } from "@switchboard/db";
import { PARKED_PAUSED, PAUSED_DRAFT_SUMMARY } from "../creative-publish-function.js";

const QUEUED_SUMMARY =
  "Queued paused Meta draft package creation (finalize in Ads Manager once ready)";

export interface CreativePublishDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById">;
}

/**
 * Governed `creative.job.publish` handler. Runs synchronously post-approval (mandatory
 * human approval via the seeded require_approval policy), but is a THIN DISPATCHER: it
 * validates ownership, short-circuits an already-parked job, then hands the rate-limited
 * Meta call chain to the dead-lettered `creative-publish` Inngest function and returns
 * `queued` (mirroring creative.job.submit / .continue). The Meta chain MUST NOT run
 * in-band: MetaAdsClient self-rate-limits 60s/call across ~5 calls, which would block the
 * approval-response request for minutes. The async function owns the chain,
 * checkpoint-resume, and the doctrine-#7 dead-letter.
 */
export function buildCreativePublishWorkflow(deps: CreativePublishDeps): WorkflowHandler {
  return {
    async execute(workUnit) {
      const { jobId } = workUnit.parameters as { jobId: string };
      const orgId = workUnit.organizationId;

      const job = await deps.jobStore.findById(jobId);
      if (!job || job.organizationId !== orgId) {
        return {
          outcome: "failed",
          summary: "Creative job not found",
          error: { code: "CREATIVE_JOB_NOT_FOUND", message: "Creative job not found" },
        };
      }

      // Idempotent short-circuit: already a parked draft, nothing to dispatch.
      if (job.metaPublishStatus === PARKED_PAUSED && job.metaAdId) {
        return {
          outcome: "completed",
          summary: PAUSED_DRAFT_SUMMARY,
          outputs: {
            metaAdId: job.metaAdId,
            metaAdSetId: job.metaAdSetId,
            metaCreativeId: job.metaCreativeId,
            metaCampaignId: job.metaCampaignId,
          },
        };
      }

      // Hand off the rate-limited Meta chain to the dead-lettered Inngest function.
      // Carry workUnit.id so it rides the dead-letter `trigger` passthrough and the
      // publish-failure recorder can reconcile THIS trace queued -> failed (D5-F1).
      const { inngestClient } = await import("@switchboard/creative-pipeline");
      await inngestClient.send({
        name: "creative-pipeline/publish.requested",
        data: { jobId, organizationId: orgId, workUnitId: workUnit.id },
      });

      return { outcome: "queued", summary: QUEUED_SUMMARY, outputs: { jobId } };
    },
  };
}
