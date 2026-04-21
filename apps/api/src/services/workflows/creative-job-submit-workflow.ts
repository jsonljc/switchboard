import type { WorkflowHandler } from "@switchboard/core/platform";

export function buildCreativeJobSubmitWorkflow(_prisma: unknown): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as {
        deploymentId: string;
        listingId: string;
        brief: Record<string, unknown>;
        mode: "polished" | "ugc";
      };

      const { PrismaAgentTaskStore, PrismaCreativeJobStore } = await import("@switchboard/db");
      const prisma = _prisma as import("@switchboard/db").PrismaClient;
      const taskStore = new PrismaAgentTaskStore(prisma);
      const jobStore = new PrismaCreativeJobStore(prisma);

      const brief = input.brief as {
        productDescription: string;
        targetAudience: string;
        platforms: string[];
        brandVoice?: string | null;
        productImages: string[];
        references: string[];
        pastPerformance?: string | null;
        generateReferenceImages: boolean;
      };

      const task = await taskStore.create({
        deploymentId: input.deploymentId,
        organizationId: workUnit.organizationId,
        listingId: input.listingId,
        category: "creative_strategy",
        input: brief as unknown as Record<string, unknown>,
      });

      const jobFields = {
        taskId: task.id,
        organizationId: workUnit.organizationId,
        deploymentId: input.deploymentId,
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        platforms: brief.platforms,
        brandVoice: brief.brandVoice ?? null,
        productImages: brief.productImages,
        references: brief.references,
        pastPerformance: brief.pastPerformance ?? null,
        generateReferenceImages: brief.generateReferenceImages,
      };

      const job =
        input.mode === "ugc"
          ? await jobStore.createUgc({
              ...jobFields,
              ugcConfig: brief as unknown as Record<string, unknown>,
            })
          : await jobStore.create(jobFields);

      const { inngestClient } = await import("@switchboard/creative-pipeline");
      await inngestClient.send({
        name: "creative-pipeline/job.submitted",
        data: {
          jobId: job.id,
          taskId: task.id,
          organizationId: workUnit.organizationId,
          deploymentId: input.deploymentId,
          mode: input.mode,
        },
      });

      return {
        outcome: "queued",
        summary: "Creative job submitted",
        outputs: { task, job },
      };
    },
  };
}
