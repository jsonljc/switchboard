// @route-class: read-only
import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import {
  type Decision,
  adaptRecommendation,
  adaptHandoff,
  adaptParkedApproval,
  adaptDegradedParkedApproval,
  decisionSortComparator,
} from "@switchboard/core";
import { type AgentKey, isAgentKey } from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";
import { dashboardRouteTemplates } from "../lib/route-templates.js";
import { summarizeParkedIntent } from "../services/workflows/parked-approval-cards.js";

// Defensive bound on the parked-approval leg; sorted by expiry FIRST so the
// most urgent approvals are never hidden by the cap (truncation is logged).
const PARKED_FEED_CAP = 25;

async function listParkedApprovals(app: FastifyInstance, orgId: string): Promise<Decision[]> {
  if (!app.lifecycleService || !app.workTraceStore) return [];
  const actionable = await app.lifecycleService.listOperatorActionableLifecycles(orgId);
  actionable.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  if (actionable.length > PARKED_FEED_CAP) {
    app.log.warn(
      {
        orgId,
        actionable: actionable.length,
        hidden: actionable.length - PARKED_FEED_CAP,
        cap: PARKED_FEED_CAP,
      },
      "Parked approval feed truncated",
    );
  }
  const decisions: Decision[] = [];
  for (const lifecycle of actionable.slice(0, PARKED_FEED_CAP)) {
    const [traceResult, revision] = await Promise.all([
      app.workTraceStore.getByWorkUnitId(lifecycle.actionEnvelopeId),
      app.lifecycleService.getCurrentRevision(lifecycle.id),
    ]);
    if (!traceResult?.trace || !revision) {
      // Governed work must never silently vanish from the operator surface.
      app.log.error(
        { lifecycleId: lifecycle.id, hasTrace: !!traceResult, hasRevision: !!revision },
        "Parked lifecycle integrity failure: rendering degraded card",
      );
      decisions.push(adaptDegradedParkedApproval(lifecycle));
      continue;
    }
    decisions.push(
      adaptParkedApproval(lifecycle, revision, traceResult.trace, summarizeParkedIntent),
    );
  }
  return decisions;
}

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
  const [recs, handoffs, parked] = await Promise.all([
    app.recommendationStore.listBySurface({
      orgId,
      surface: "queue",
      status: "pending",
      limit: 50,
    }),
    app.handoffStore.listPending(orgId),
    listParkedApprovals(app, orgId),
  ]);

  // Handoff stores the lead identifier in leadSnapshot.leadId, not at the top level.
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
        { routeTemplates: dashboardRouteTemplates },
      );
    }),
    ...parked,
  ];

  const filtered = agentKey ? decisions.filter((d) => d.agentKey === agentKey) : decisions;
  filtered.sort(decisionSortComparator);

  const counts = {
    total: filtered.length,
    // Workflow approvals are approvals to the operator; no new count key.
    approval: filtered.filter((d) => d.kind === "approval" || d.kind === "workflow_approval")
      .length,
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
