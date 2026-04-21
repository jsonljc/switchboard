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

      if (job.currentStage === "complete" || job.stoppedAt) {
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
        await jobStore.updateProductionTier(input.jobId, input.productionTier ?? "basic");
      }

      if (action === "stop") {
        await jobStore.stop(input.jobId, job.currentStage);
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
