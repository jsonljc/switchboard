// ---------------------------------------------------------------------------
// Creative Pipeline routes — CRUD for CreativeJob (PCD)
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaCreativeJobStore, PrismaAgentTaskStore } from "@switchboard/db";
import { CreativeBriefInput } from "@switchboard/schemas";
import { inngestClient } from "@switchboard/core/creative-pipeline";
import { z } from "zod";

const SubmitBriefInput = z.object({
  deploymentId: z.string().min(1),
  listingId: z.string().min(1),
  brief: CreativeBriefInput,
});

const ApproveStageInput = z.object({
  action: z.enum(["continue", "stop"]),
  productionTier: z.enum(["basic", "pro"]).optional(),
});

export const creativePipelineRoutes: FastifyPluginAsync = async (app) => {
  // POST /creative-jobs — submit a brief, create AgentTask + CreativeJob
  app.post("/creative-jobs", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const parsed = SubmitBriefInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const { deploymentId, listingId, brief } = parsed.data;

    // Create the AgentTask
    const taskStore = new PrismaAgentTaskStore(app.prisma);
    const task = await taskStore.create({
      deploymentId,
      organizationId: orgId,
      listingId,
      category: "creative_strategy",
      input: brief as unknown as Record<string, unknown>,
    });

    // Create the CreativeJob
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.create({
      taskId: task.id,
      organizationId: orgId,
      deploymentId,
      productDescription: brief.productDescription,
      targetAudience: brief.targetAudience,
      platforms: brief.platforms,
      brandVoice: brief.brandVoice ?? null,
      productImages: brief.productImages,
      references: brief.references,
      pastPerformance: brief.pastPerformance ?? null,
      generateReferenceImages: brief.generateReferenceImages,
    });

    // Fire Inngest event to start the pipeline
    await inngestClient.send({
      name: "creative-pipeline/job.submitted",
      data: {
        jobId: job.id,
        taskId: task.id,
        organizationId: orgId,
        deploymentId,
      },
    });

    return reply.code(201).send({ task, job });
  });

  // GET /creative-jobs — list jobs for org
  app.get("/creative-jobs", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const query = request.query as { deploymentId?: string; limit?: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const jobs = await jobStore.listByOrg(orgId, {
      deploymentId: query.deploymentId,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    });

    return reply.send({ jobs });
  });

  // GET /creative-jobs/:id — get single job with stage outputs
  app.get("/creative-jobs/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found" });
    }

    return reply.send({ job });
  });

  // POST /creative-jobs/:id/approve — continue or stop pipeline
  app.post("/creative-jobs/:id/approve", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const parsed = ApproveStageInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found" });
    }

    if (job.currentStage === "complete" || job.stoppedAt) {
      return reply.code(409).send({ error: "Job is not awaiting approval" });
    }

    // Persist productionTier if this is Stage 4 (storyboard) approval
    if (parsed.data.action === "continue" && job.currentStage === "storyboard") {
      const tier = parsed.data.productionTier ?? "basic";
      await jobStore.updateProductionTier(id, tier);
    }

    if (parsed.data.action === "stop") {
      const stopped = await jobStore.stop(id, job.currentStage);

      // Fire stop event so the running Inngest function unblocks and exits
      await inngestClient.send({
        name: "creative-pipeline/stage.approved",
        data: { jobId: id, action: "stop" },
      });

      return reply.send({ job: stopped, action: "stopped" });
    }

    // Fire continue event — the running Inngest function's waitForEvent picks this up
    await inngestClient.send({
      name: "creative-pipeline/stage.approved",
      data: { jobId: id, action: "continue" },
    });

    return reply.send({ job, action: "approved" });
  });

  // GET /creative-jobs/:id/estimate — cost estimate per tier
  app.get("/creative-jobs/:id/estimate", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found" });
    }

    const stageOutputs = (job.stageOutputs ?? {}) as Record<string, unknown>;
    const storyboard = stageOutputs["storyboard"];
    const scripts = stageOutputs["scripts"] as { scripts?: unknown[] } | undefined;

    if (!storyboard) {
      return reply.send({ estimates: null, reason: "Storyboard not yet complete" });
    }

    const { estimateCost } = await import("@switchboard/core/creative-pipeline");
    const scriptCount = scripts?.scripts?.length ?? 1;
    const estimates = estimateCost(
      storyboard as { storyboards: Array<{ scenes: Array<{ duration: number }> }> },
      scriptCount,
    );

    return reply.send({ estimates });
  });
};
