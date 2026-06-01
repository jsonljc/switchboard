// @route-class: lifecycle
// ---------------------------------------------------------------------------
// POST /agents/:agentId/creatives/:id/decision — Keep / Pass / un-keep
//
// Phase-2 review-decision mutation for the Mira Creative Operating Desk.
// DRAFT-ONLY and NO-CROSS-AGENT: writes ONLY the CreativeJob reviewDecision
// field — firewalled from the Phase-4 Riley handoff (no Riley, no
// recommendation/campaign write, no publish).
//
// Org-scoped via updateMany + count===0 guard (cross-org ids → 404).
// See [[feedback_updatemany_drops_nomatch_abort]].
// null decision un-keeps (reversible; reviewDecidedAt is cleared).
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema, id: z.string().min(1) });
// null un-keeps (reversible). "kept" and "passed" are the only set values.
const BodySchema = z.object({ decision: z.enum(["kept", "passed"]).nullable() });

// Keep/Pass review decision. DRAFT-ONLY and NO-CROSS-AGENT: writes ONLY the
// CreativeJob review-decision field — firewalled from the Phase-4 Riley handoff
// (no Riley, no recommendation/campaign, no publish). Org-scoped via updateMany
// + count===0 guard (cross-org ids → 404). See [[feedback_updatemany_drops_nomatch_abort]].
export const miraDecisionRoute: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim())
        request.organizationIdFromAuth = headerVal.trim();
      else if (!request.organizationIdFromAuth) request.organizationIdFromAuth = "default";
      if (!request.principalIdFromAuth) request.principalIdFromAuth = "default";
    }
  });

  app.post("/agents/:agentId/creatives/:id/decision", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success || params.data.agentId !== "mira")
      return reply.code(404).send({ error: "Review decision not available for this agent" });

    const body = BodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid decision" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore)
      return reply.code(503).send({ error: "Enablement store unavailable" });
    if (!(await isAgentHomeAccessible("mira", orgId, app.orgAgentEnablementStore)))
      return reply.code(404).send({ error: "Agent not available on home" });
    if (!app.prisma) return reply.code(503).send({ error: "Database unavailable" });

    const decision = body.data.decision;
    try {
      // Org-scoped write; count===0 ⇒ cross-org or missing id ⇒ 404.
      const { count } = await app.prisma.creativeJob.updateMany({
        where: { id: params.data.id, organizationId: orgId },
        data: { reviewDecision: decision, reviewDecidedAt: decision ? new Date() : null },
      });
      if (count === 0) return reply.code(404).send({ error: "Creative not found" });

      return reply.code(200).send({ id: params.data.id, decision });
    } catch (err) {
      app.log.error({ err, requestId: request.id }, "mira review decision failed");
      return reply.code(500).send({ error: "Review decision failed", requestId: request.id });
    }
  });
};
