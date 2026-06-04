import type { WorkflowHandler } from "@switchboard/core/platform";

export function buildCreativeJobDecisionWorkflow(
  _prisma: unknown,
  action: "continue" | "stop",
): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as {
        jobId: string;
        action?: "continue" | "stop";
        productionTier?: "basic" | "pro";
      };

      const { PrismaCreativeJobStore } = await import("@switchboard/db");
      const prisma = _prisma as import("@switchboard/db").PrismaClient;
      const jobStore = new PrismaCreativeJobStore(prisma);

      const job = await jobStore.findById(input.jobId);
      if (!job || job.organizationId !== workUnit.organizationId) {
        return {
          outcome: "failed",
          summary: "Creative job not found",
          error: { code: "CREATIVE_JOB_NOT_FOUND", message: "Creative job not found" },
        };
      }

      // Mode-aware not-awaiting guard (slice-3 spec 3.3c). UGC jobs never
      // advance currentStage (it stays at the column default), so they key
      // off ugcPhase; ugcFailure is terminal too (failUgc sets it but never
      // stoppedAt, and the runner already returned: an approve OR stop on a
      // failed job would emit an event no wait hears and report a misleading
      // success).
      const ugcDone = job.mode === "ugc" && (job.ugcPhase === "complete" || job.ugcFailure != null);
      const polishedDone = job.mode !== "ugc" && job.currentStage === "complete";
      if (ugcDone || polishedDone || job.stoppedAt) {
        return {
          outcome: "failed",
          summary: "Job is not awaiting approval",
          error: {
            code: "CREATIVE_JOB_NOT_AWAITING_APPROVAL",
            message: "Job is not awaiting approval",
          },
        };
      }

      if (action === "continue" && job.currentStage === "storyboard") {
        await jobStore.updateProductionTier(
          job.organizationId,
          input.jobId,
          input.productionTier ?? "basic",
        );
      }

      if (action === "stop") {
        // Branch the stop by mode, mirroring the Inngest event below: a UGC job
        // stops via stopUgc(ugcPhase), a polished job via stop(currentStage). The
        // store columns differ, so calling the polished stop for a UGC job writes a
        // stage value into the ugc phase column.
        if (job.mode === "ugc") {
          await jobStore.stopUgc(job.organizationId, input.jobId, job.ugcPhase ?? "");
        } else {
          await jobStore.stop(job.organizationId, input.jobId, job.currentStage);
        }
      }

      const { inngestClient } = await import("@switchboard/creative-pipeline");
      await inngestClient.send(
        job.mode === "ugc"
          ? {
              name: "creative-pipeline/ugc-phase.approved",
              data: { jobId: input.jobId, phase: job.ugcPhase, action },
            }
          : {
              name: "creative-pipeline/stage.approved",
              data: { jobId: input.jobId, action },
            },
      );

      const updatedJob = await jobStore.findById(input.jobId);
      return {
        outcome: "queued",
        summary: `Creative job ${action} queued`,
        outputs: { job: updatedJob, action: action === "stop" ? "stopped" : "approved" },
      };
    },
  };
}
