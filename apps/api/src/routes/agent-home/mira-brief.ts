// @route-class: lifecycle
// ---------------------------------------------------------------------------
// POST /agents/:agentId/brief — createCreativeDraftRequest
//
// Phase-2 open-brief mutation for the Mira Creative Operating Desk.
// Draft-only, NO-CROSS-AGENT: only creates an AgentTask + CreativeJob and
// fires the creative-pipeline kickoff event. NO Riley side effect, no
// recommendation/campaign write, no external publish.
//
// Fail-closed: resolves the org's "creative" deployment before any spend.
// If no live deployment exists → 409 (no AgentTask, no CreativeJob, no event).
// Idempotent via the global Idempotency-Key HTTP middleware (no extra wiring).
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PrismaCreativeJobStore, PrismaAgentTaskStore } from "@switchboard/db";
import { PrismaDeploymentResolver } from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";
import {
  AgentKeySchema,
  MiraBriefRequestSchema,
  mapMiraBriefToCreativeBrief,
} from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

export const miraBriefRoute: FastifyPluginAsync = async (app) => {
  // In test/dev mode, inject org/actor from x-org-id header.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim())
        request.organizationIdFromAuth = headerVal.trim();
      else if (!request.organizationIdFromAuth) request.organizationIdFromAuth = "default";
      if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
    }
  });

  app.post("/agents/:agentId/brief", async (request, reply) => {
    // Mira-only gate (404 for any other agent).
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success || params.data.agentId !== "mira") {
      return reply.code(404).send({ error: "Brief intake not available for this agent" });
    }

    // Organisation scope required.
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    // Enablement gate — Mira is opt-in per org.
    if (!app.orgAgentEnablementStore) {
      return reply.code(503).send({ error: "Enablement store unavailable" });
    }
    if (!(await isAgentHomeAccessible("mira", orgId, app.orgAgentEnablementStore))) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    if (!app.prisma) {
      return reply.code(503).send({ error: "Database unavailable" });
    }

    // Validate the brief.
    const parsed = MiraBriefRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid brief", details: parsed.error });
    }

    // Fail-closed: resolve the creative deployment before creating any records.
    // `prisma as never` mirrors the established pattern in apps/chat/src/gateway/gateway-bridge.ts —
    // PrismaDeploymentResolver's PrismaLike interface requires the `listing` include shape, which
    // Prisma's generated types only guarantee at runtime when include:{listing:true} is passed.
    const resolver = new PrismaDeploymentResolver(app.prisma as never);
    let deployment: Awaited<ReturnType<typeof resolver.resolveByOrgAndSlug>>;
    try {
      deployment = await resolver.resolveByOrgAndSlug(orgId, "creative");
    } catch {
      return reply.code(409).send({ error: "creative_deployment_not_provisioned" });
    }
    // `resolveByOrgAndSlug` always throws when no live deployment exists (handled
    // above); this null-guard is belt-and-suspenders for the type contract.
    if (!deployment) {
      return reply.code(409).send({ error: "creative_deployment_not_provisioned" });
    }

    const actorId = request.principalIdFromAuth ?? "default";
    const brief = mapMiraBriefToCreativeBrief(parsed.data);

    try {
      // AgentTask — records intent and links to deployment.
      const taskStore = new PrismaAgentTaskStore(app.prisma);
      const task = await taskStore.create({
        deploymentId: deployment.deploymentId,
        organizationId: orgId,
        listingId: deployment.listingId,
        category: "creative_strategy",
        input: { ...brief, requestSource: "mira.open_brief", actorId } as unknown as Record<
          string,
          unknown
        >,
      });

      // CreativeJob — the pipeline work item. Draft-only; no cross-agent writes.
      const jobStore = new PrismaCreativeJobStore(app.prisma);
      const job = await jobStore.create({
        taskId: task.id,
        organizationId: orgId,
        deploymentId: deployment.deploymentId,
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        platforms: brief.platforms,
        brandVoice: brief.brandVoice ?? null,
        productImages: brief.productImages,
        references: brief.references,
        pastPerformance: null,
        generateReferenceImages: brief.generateReferenceImages,
      });

      // Kick off the cost-gated pipeline. Only the cheap planning stage runs now;
      // the expensive video step blocks for the existing Continue cost-confirm in review.
      // NOTE (v1): if this send fails after the rows are persisted, the job is an
      // orphan with no pipeline event (no resume-on-event yet) — same sequencing as
      // creative-pipeline.ts; acceptable until reconciliation lands.
      await inngestClient.send({
        name: "creative-pipeline/job.submitted",
        data: {
          jobId: job.id,
          taskId: task.id,
          organizationId: orgId,
          deploymentId: deployment.deploymentId,
          mode: "polished",
        },
      });

      return reply.code(201).send({
        jobId: job.id,
        status: "brief_submitted",
        expectedDraftCount: 1,
        cost: { upfront: null, generationGatedInReview: true },
        requestSource: "mira.open_brief",
      });
    } catch (err) {
      app.log.error({ err, requestId: request.id }, "mira brief create failed");
      return reply.code(500).send({ error: "Brief creation failed", requestId: request.id });
    }
  });
};
