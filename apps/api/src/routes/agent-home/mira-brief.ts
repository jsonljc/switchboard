// @route-class: lifecycle
// ---------------------------------------------------------------------------
// POST /agents/:agentId/brief — createCreativeDraftRequest
//
// Phase-2 open-brief mutation for the Mira Creative Operating Desk. Generation
// triggers paid video renders (spend), so it MUST be governed: this route routes
// through `PlatformIngress.submit({ intent: "creative.job.submit" })` (the same
// governed seam as POST /creative-jobs). The workflow (post-governance) owns the
// AgentTask + CreativeJob create AND the `creative-pipeline/job.submitted` event —
// this route only validates, resolves the deployment, and maps the response.
//
// Draft-only, NO-CROSS-AGENT: no Riley side effect, no recommendation/campaign
// write, no external publish.
//
// Fail-closed: resolves the org's "creative" deployment before any submit. If no
// live deployment exists → 409 (no submit). Idempotent via the global
// Idempotency-Key HTTP middleware (no extra wiring).
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { PrismaDeploymentResolver } from "@switchboard/core";
import {
  AgentKeySchema,
  MiraBriefRequestSchema,
  mapMiraBriefToCreativeBrief,
} from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";
import { ingressErrorToReply } from "../../utils/ingress-error-to-reply.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

/**
 * Map a governed escalation (creative.job.submit is registered approvalPolicy
 * "threshold") to a deliberate pending-approval envelope. Latent for submit today
 * (no render-cost signal exists until the storyboard → continue step), but the
 * route MUST branch on it before destructuring outputs — else an approval-required
 * response falls through to a phantom 201 with an undefined jobId. Mirrors
 * creative-pipeline.ts / execute.ts.
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

export const miraBriefRoute: FastifyPluginAsync = async (app) => {
  // In test/dev mode, inject org/actor from x-org-id / x-principal-id headers.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim())
        request.organizationIdFromAuth = headerVal.trim();
      else if (!request.organizationIdFromAuth) request.organizationIdFromAuth = "default";
      const principal = request.headers["x-principal-id"];
      if (typeof principal === "string" && principal.trim())
        request.principalIdFromAuth = principal.trim();
      else if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
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

    if (!app.platformIngress) {
      return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
    }
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database unavailable" });
    }

    // Validate the brief.
    const parsed = MiraBriefRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid brief", details: parsed.error });
    }

    // Fail-closed: resolve the creative deployment to supply deploymentId/listingId
    // to the submit. `prisma as never` mirrors the established pattern in
    // apps/chat/src/gateway/gateway-bridge.ts — PrismaDeploymentResolver's PrismaLike
    // interface requires the `listing` include shape, which Prisma's generated types
    // only guarantee at runtime when include:{listing:true} is passed.
    const resolver = new PrismaDeploymentResolver(app.prisma as never);
    let deployment: Awaited<ReturnType<typeof resolver.resolveByOrgAndSlug>>;
    try {
      deployment = await resolver.resolveByOrgAndSlug(orgId, "creative");
    } catch {
      return reply.code(409).send({ error: "creative_deployment_not_provisioned" });
    }
    if (!deployment) {
      return reply.code(409).send({ error: "creative_deployment_not_provisioned" });
    }

    const brief = mapMiraBriefToCreativeBrief(parsed.data);
    const actorId = request.principalIdFromAuth ?? "default";

    const response = await app.platformIngress.submit({
      intent: "creative.job.submit",
      parameters: {
        deploymentId: deployment.deploymentId,
        listingId: deployment.listingId,
        brief,
        // Operator-chosen format (slice-3 spec 3.4): the desk's
        // Polished/Real-talk toggle, defaulted polished by the schema.
        mode: parsed.data.mode,
      },
      actor: { id: actorId, type: "user" },
      organizationId: orgId,
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
      // Submit has no domain-failure path of its own; a failed outcome is an
      // unexpected execution error → throw so the global handler returns a scrubbed 500.
      throw new Error(response.result.error?.message ?? "Creative brief submit failed");
    }

    const { job } = response.result.outputs as { job: { id: string } };
    return reply.code(201).send({
      jobId: job.id,
      status: "brief_submitted",
      expectedDraftCount: 1,
      cost: { upfront: null, generationGatedInReview: true },
      requestSource: "mira.open_brief",
    });
  });
};
