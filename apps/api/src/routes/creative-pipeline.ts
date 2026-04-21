// ---------------------------------------------------------------------------
// Creative Pipeline routes — CRUD for CreativeJob (PCD)
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { PrismaCreativeJobStore } from "@switchboard/db";
import { CreativeBriefInput } from "@switchboard/schemas";
import { z } from "zod";
import { resolveDeploymentForIntent } from "../utils/resolve-deployment.js";

const SubmitBriefInput = z.object({
  deploymentId: z.string().min(1),
  listingId: z.string().min(1),
  brief: CreativeBriefInput,
  mode: z.enum(["polished", "ugc"]).default("polished"),
});

const ApproveStageInput = z.object({
  action: z.enum(["continue", "stop"]),
  productionTier: z.enum(["basic", "pro"]).optional(),
});

export const creativePipelineRoutes: FastifyPluginAsync = async (app) => {
  // POST /creative-jobs — submit a brief via PlatformIngress
  app.post("/creative-jobs", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const parsed = SubmitBriefInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const { deploymentId, listingId, brief, mode } = parsed.data;

    const deployment = await resolveDeploymentForIntent(
      app.deploymentResolver,
      orgId,
      "creative.job.submit",
    );

    const response = await app.platformIngress.submit({
      organizationId: orgId,
      actor: { id: request.principalIdFromAuth ?? "creative-dashboard", type: "user" },
      intent: "creative.job.submit",
      parameters: { deploymentId, listingId, brief, mode },
      deployment,
      trigger: "api",
      idempotencyKey:
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : undefined,
      traceId: request.traceId,
    });

    if (!response.ok) {
      return reply.code(400).send({ error: response.error.message });
    }

    return reply.code(201).send(response.result.outputs);
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

  // POST /creative-jobs/:id/approve — continue or stop pipeline via PlatformIngress
  app.post("/creative-jobs/:id/approve", async (request, reply) => {
    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required" });
    }

    const { id } = request.params as { id: string };
    const parsed = ApproveStageInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", details: parsed.error });
    }

    const intent = parsed.data.action === "stop" ? "creative.job.stop" : "creative.job.continue";
    const deployment = await resolveDeploymentForIntent(app.deploymentResolver, orgId, intent);

    const response = await app.platformIngress.submit({
      organizationId: orgId,
      actor: { id: request.principalIdFromAuth ?? "creative-dashboard", type: "user" },
      intent,
      parameters: {
        jobId: id,
        action: parsed.data.action,
        productionTier: parsed.data.productionTier,
      },
      deployment,
      trigger: "api",
      idempotencyKey:
        typeof request.headers["idempotency-key"] === "string"
          ? request.headers["idempotency-key"]
          : undefined,
      traceId: request.traceId,
    });

    if (!response.ok) {
      return reply.code(400).send({ error: response.error.message });
    }

    return reply.send(response.result.outputs);
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

    const { estimateCost } = await import("@switchboard/creative-pipeline");
    const scriptCount = scripts?.scripts?.length ?? 1;
    const estimates = estimateCost(
      storyboard as { storyboards: Array<{ scenes: Array<{ duration: number }> }> },
      scriptCount,
    );

    return reply.send({ estimates });
  });
};
