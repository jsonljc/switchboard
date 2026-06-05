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

      let job;
      if (input.mode === "ugc") {
        // Construct the VALID UgcConfig shape the runner reads (slice-3 spec
        // 3.3d): the runner reads `ugcConfig.brief`, so storing the raw brief
        // unwrapped ran every phase on an EMPTY brief. ugcFormat is a v1
        // constant at this single construction site (surfacing it as an
        // operator choice is a named follow-on); budget/retryConfig stay
        // absent so the runner defaults apply (budget 50; retries hardcoded).
        const { UgcConfigSchema } = await import("@switchboard/schemas");
        const ugcConfig = UgcConfigSchema.parse({
          brief: { ...brief, ugcFormat: "talking_head", creatorPoolIds: [] },
        });
        job = await jobStore.createUgc({
          ...jobFields,
          ugcConfig: ugcConfig as unknown as Record<string, unknown>,
        });
      } else {
        job = await jobStore.create(jobFields);
      }

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
