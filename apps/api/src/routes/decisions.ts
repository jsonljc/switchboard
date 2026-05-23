import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import {
  type Decision,
  adaptRecommendation,
  adaptHandoff,
  decisionSortComparator,
} from "@switchboard/core";
import { type AgentKey, isAgentKey } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";
import { dashboardRouteTemplates } from "../lib/route-templates.js";

async function listDecisions(
  app: FastifyInstance,
  orgId: string,
  agentKey: AgentKey | null,
): Promise<{
  decisions: Decision[];
  counts: { total: number; approval: number; handoff: number };
}> {
  if (!app.recommendationStore || !app.handoffStore || !app.contactStore || !app.threadStore) {
    throw new Error("Decision feed dependencies not wired");
  }
  const [recs, handoffs] = await Promise.all([
    app.recommendationStore.listBySurface({
      orgId,
      surface: "queue",
      status: "pending",
      limit: 50,
    }),
    app.handoffStore.listPending(orgId),
  ]);

  // HandoffPackage stores the lead identifier in leadSnapshot.leadId, not at the top level.
  const contactIds = handoffs
    .map((h) => h.leadSnapshot?.leadId)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  const [contacts, threads] = await Promise.all([
    app.contactStore.listByIds(orgId, contactIds),
    app.threadStore.listByContactIds(orgId, contactIds),
  ]);

  const decisions: Decision[] = [
    ...recs.map((r) => adaptRecommendation(r, { routeTemplates: dashboardRouteTemplates })),
    ...handoffs.map((h) => {
      const leadId = h.leadSnapshot?.leadId;
      return adaptHandoff(
        h,
        leadId ? (contacts.get(leadId) ?? null) : null,
        leadId ? (threads.get(leadId) ?? null) : null,
      );
    }),
  ];

  const filtered = agentKey ? decisions.filter((d) => d.agentKey === agentKey) : decisions;
  filtered.sort(decisionSortComparator);

  const counts = {
    total: filtered.length,
    approval: filtered.filter((d) => d.kind === "approval").length,
    handoff: filtered.filter((d) => d.kind === "handoff").length,
  };
  return { decisions: filtered, counts };
}

function serializeDecision(d: Decision) {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    meta: {
      ...d.meta,
      slaDeadlineAt: d.meta.slaDeadlineAt?.toISOString(),
      undoableUntil: d.meta.undoableUntil?.toISOString(),
    },
  };
}

export const decisionsRoutes: FastifyPluginAsync = async (app) => {
  // Dev/test mode: allow `x-org-id` header to set the org scope (mirrors
  // dashboard-agents). In production, the auth middleware sets
  // organizationIdFromAuth from API_KEY_METADATA before handlers run.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      const headerVal = request.headers["x-org-id"];
      if (typeof headerVal === "string" && headerVal.trim()) {
        request.organizationIdFromAuth = headerVal.trim();
      } else if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get(
    "/agents/:key/decisions",
    {
      schema: {
        description: "Decision feed for one agent (recommendations + handoffs).",
        tags: ["Dashboard"],
        params: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const { key } = request.params as { key: string };
      if (!isAgentKey(key)) {
        return reply.code(400).send({ error: `Unknown agent key: ${key}`, statusCode: 400 });
      }
      const result = await listDecisions(app, orgId, key);
      return reply.code(200).send({
        decisions: result.decisions.map(serializeDecision),
        counts: result.counts,
      });
    },
  );

  app.get(
    "/decisions",
    {
      schema: {
        description: "Cross-agent inbox feed (recommendations + handoffs).",
        tags: ["Dashboard"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const result = await listDecisions(app, orgId, null);
      return reply.code(200).send({
        decisions: result.decisions.map(serializeDecision),
        counts: result.counts,
      });
    },
  );
};
