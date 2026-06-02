// @route-class: lifecycle
// ---------------------------------------------------------------------------
// Creative Pipeline routes — CRUD for CreativeJob (PCD)
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { PrismaCreativeJobStore, decryptCredentials } from "@switchboard/db";
import { CreativeBriefInput } from "@switchboard/schemas";
import { z } from "zod";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrgForMutation } from "../decorators/org.js";
import { computeRenderSpend, computeCreativeEstimates } from "../services/creative-render-spend.js";
import { assertPublishable } from "../services/creative-publish-preconditions.js";

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

/**
 * Map a governed escalation (the intents are registered approvalPolicy
 * "threshold" / budgetClass "expensive") to a deliberate pending-approval
 * envelope. The product action is NOT performed until the approval resolves, so
 * we must NOT fall through and return a phantom 2xx with empty outputs. Ingress
 * has already created the lifecycle row atomically; the operator approval UX
 * (and threshold population that makes this reachable) rides P2a-iii. Mirrors
 * the PENDING_APPROVAL contract used by execute.ts / actions.ts.
 */
function pendingApprovalReply(
  response: {
    workUnit: { id: string; traceId: string };
    lifecycleId?: string;
    bindingHash?: string;
  },
  reply: FastifyReply,
) {
  return reply.code(202).send({
    outcome: "PENDING_APPROVAL",
    workUnitId: response.workUnit.id,
    traceId: response.workUnit.traceId,
    ...(response.lifecycleId
      ? { approvalRequest: { id: response.lifecycleId, bindingHash: response.bindingHash } }
      : {}),
  });
}

/** Map a publish pre-flight failure code to its HTTP status. */
const PUBLISH_FAILURE_STATUS: Record<string, number> = {
  CREATIVE_JOB_NOT_FOUND: 404,
  CREATIVE_NOT_PUBLISHABLE: 409,
  CREATIVE_ASSET_NOT_DURABLE: 422,
  META_CONNECTION_NOT_FOUND: 422,
  META_PAGE_NOT_CONFIGURED: 422,
};

export const creativePipelineRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test mode (authDisabled): populate organizationIdFromAuth +
  // principalIdFromAuth from x-org-id / x-principal-id headers (or fall back to
  // "default"). In production this hook is a no-op; the real auth middleware has
  // already populated the fields. Runs before requireOrgForMutation.
  app.addHook("preHandler", buildDevAuthFallback(app));

  // POST /creative-jobs — submit a brief through the governance front door.
  // Generation triggers paid video renders (spend), so it MUST be governed: the
  // `creative.job.submit` workflow (post-governance) owns the AgentTask +
  // CreativeJob create AND the `creative-pipeline/job.submitted` Inngest event.
  app.post("/creative-jobs", { preHandler: requireOrgForMutation }, async (request, reply) => {
    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
    }

    const parsed = SubmitBriefInput.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
    }

    const response = await app.platformIngress.submit({
      intent: "creative.job.submit",
      parameters: parsed.data,
      actor: { id: request.actorId, type: "user" },
      organizationId: request.orgId,
      trigger: "api",
      surface: { surface: "api" },
    });

    if (!response.ok) {
      return ingressErrorToReply(response.error, reply);
    }
    if ("approvalRequired" in response && response.approvalRequired) {
      return pendingApprovalReply(response, reply);
    }
    if (response.result.outcome === "failed") {
      // Submit has no domain-failure path of its own; any failed outcome is an
      // unexpected execution error. Throw so the global handler returns a
      // scrubbed 500 (don't echo internal error codes to the client).
      throw new Error(response.result.error?.message ?? "Creative job submit failed");
    }
    const { task, job } = response.result.outputs as { task: unknown; job: unknown };
    return reply.code(201).send({ task, job });
  });

  // GET /creative-jobs — list jobs for org
  app.get("/creative-jobs", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required", statusCode: 401 });
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
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required", statusCode: 401 });
    }

    const { id } = request.params as { id: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found", statusCode: 404 });
    }

    return reply.send({ job });
  });

  // POST /creative-jobs/:id/approve — continue or stop the pipeline through the
  // governance front door. "continue" past storyboard triggers a paid render
  // (spend), so it MUST be governed: the `creative.job.continue` / `.stop`
  // workflows (post-governance) own the ownership check, the productionTier
  // persist, the `jobStore.stop`, and the stage/ugc-phase Inngest event. The
  // action is baked into the registered workflow closure, so the route only
  // selects the intent + forwards params.
  app.post(
    "/creative-jobs/:id/approve",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const { id } = request.params as { id: string };
      const parsed = ApproveStageInput.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error, statusCode: 400 });
      }

      const intent = parsed.data.action === "stop" ? "creative.job.stop" : "creative.job.continue";
      const parameters: Record<string, unknown> =
        parsed.data.action === "stop"
          ? { jobId: id }
          : { jobId: id, productionTier: parsed.data.productionTier };

      // P2a-iii — surface the render cost as the governance spend signal so an
      // over-threshold render parks for approval instead of silently rendering.
      // Computed SERVER-SIDE from the persisted storyboard: the operator chooses
      // the tier but cannot understate the cost. Best-effort — the workflow stays
      // the authoritative owner of not-found / wrong-org / not-awaiting-approval,
      // so a missing job or pre-storyboard continue just omits the signal.
      if (parsed.data.action === "continue" && app.prisma) {
        const job = await new PrismaCreativeJobStore(app.prisma).findById(id);
        if (job && job.organizationId === request.orgId) {
          const spendAmount = await computeRenderSpend(job, parsed.data.productionTier);
          if (spendAmount !== null) parameters.spendAmount = spendAmount;
        }
      }

      const response = await app.platformIngress.submit({
        intent,
        parameters,
        actor: { id: request.actorId, type: "user" },
        organizationId: request.orgId,
        trigger: "api",
        surface: { surface: "api" },
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      if ("approvalRequired" in response && response.approvalRequired) {
        return pendingApprovalReply(response, reply);
      }
      const result = response.result;
      if (result.outcome === "failed") {
        // Preserve the pre-ingress HTTP contract: the decision workflow surfaces
        // not-found / wrong-org and not-awaiting-approval as failed outcomes with
        // these codes. Map them back to the 404 / 409 the dashboard expects.
        const code = result.error?.code;
        if (code === "CREATIVE_JOB_NOT_FOUND") {
          return reply.code(404).send({ error: "Creative job not found", statusCode: 404 });
        }
        if (code === "CREATIVE_JOB_NOT_AWAITING_APPROVAL") {
          return reply.code(409).send({ error: "Job is not awaiting approval", statusCode: 409 });
        }
        throw new Error(result.error?.message ?? "Creative job decision failed");
      }
      const { job, action } = result.outputs as { job: unknown; action: string };
      return reply.send({ job, action });
    },
  );

  // GET /creative-jobs/:id/estimate — cost estimate per tier
  app.get("/creative-jobs/:id/estimate", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const orgId = request.organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({ error: "Organization required", statusCode: 401 });
    }

    const { id } = request.params as { id: string };
    const jobStore = new PrismaCreativeJobStore(app.prisma);
    const job = await jobStore.findById(id);

    if (!job || job.organizationId !== orgId) {
      return reply.code(404).send({ error: "Creative job not found", statusCode: 404 });
    }

    // Shares computeCreativeEstimates with the spend-signal producer so the readback
    // and the governed amount can never disagree.
    const estimates = await computeCreativeEstimates(job);
    if (!estimates) {
      return reply.send({ estimates: null, reason: "Storyboard not yet complete" });
    }

    return reply.send({ estimates });
  });

  // POST /creative-jobs/:id/publish — create a self-contained PAUSED Meta draft
  // package for a kept creative. Pre-flights (immediate 4xx so we never park a
  // doomed publish), then submits the governed `creative.job.publish` intent. The
  // seeded require_approval(mandatory) policy ALWAYS parks it → 202 is the happy
  // path (reuses pendingApprovalReply). This creates a paused DRAFT only;
  // activation is a human action in Ads Manager.
  app.post(
    "/creative-jobs/:id/publish",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      if (!app.platformIngress || !app.prisma) {
        return reply.code(503).send({ error: "Platform not available", statusCode: 503 });
      }
      const { id } = request.params as { id: string };

      const pre = await assertPublishable(
        { prisma: app.prisma, decrypt: (e) => decryptCredentials(e as string) },
        request.orgId,
        id,
      );
      if (!pre.ok) {
        const status = PUBLISH_FAILURE_STATUS[pre.code] ?? 422;
        return reply.code(status).send({ code: pre.code, error: pre.message, statusCode: status });
      }

      const response = await app.platformIngress.submit({
        intent: "creative.job.publish",
        parameters: { jobId: id },
        actor: { id: request.actorId, type: "user" },
        organizationId: request.orgId,
        trigger: "api",
        surface: { surface: "api" },
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }
      if ("approvalRequired" in response && response.approvalRequired) {
        return pendingApprovalReply(response, reply);
      }
      if (response.result.outcome === "failed") {
        // Publish only runs post-approval; a failed outcome here is a genuine
        // handler failure (e.g. CREATIVE_PUBLISH_META_ERROR). Surface its code.
        const err = response.result.error;
        return reply.code(422).send({
          code: err?.code ?? "CREATIVE_PUBLISH_FAILED",
          error: err?.message ?? "Publish failed",
          statusCode: 422,
        });
      }
      // The mandatory policy means we should always have parked above; treat a
      // straight-through success defensively as a completed parked draft.
      return reply.code(202).send({ outcome: "PENDING_APPROVAL", ...response.result.outputs });
    },
  );
};
