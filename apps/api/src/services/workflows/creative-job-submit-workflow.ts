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
        pastPerformance?: Record<string, unknown> | null;
        generateReferenceImages: boolean;
      };

      const task = await taskStore.create({
        deploymentId: input.deploymentId,
        organizationId: workUnit.organizationId,
        listingId: input.listingId,
        category: "creative_strategy",
        input: brief as unknown as Record<string, unknown>,
      });

      // Slice-2 measured channel (spec 3.8): when the caller passed no explicit
      // pastPerformance, aggregate this deployment's attributed history into the
      // typed performance_history shape the new job carries. Explicit briefs
      // win; enrichment is best-effort (a brief must never fail because the
      // history read did); zero measured rows leave it null (no fabrication).
      let enrichedPastPerformance: Record<string, unknown> | null = brief.pastPerformance ?? null;
      if (enrichedPastPerformance == null) {
        try {
          const published = await jobStore.listPublished(workUnit.organizationId);
          const { buildPerformanceHistory } = await import("./creative-performance-history.js");
          const history = buildPerformanceHistory(
            published.filter((j) => j.deploymentId === input.deploymentId),
            new Date(),
          );
          if (history) enrichedPastPerformance = history as unknown as Record<string, unknown>;
        } catch (err) {
          console.warn("creative.job.submit: measured-history enrichment skipped:", err);
        }
      }

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
        pastPerformance: enrichedPastPerformance,
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
