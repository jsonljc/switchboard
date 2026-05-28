// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { projectMetrics, getAgentTargets, type MetricsSignalStore } from "@switchboard/core";
import { PrismaMiraCreativeReadModelReader } from "@switchboard/db";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";
import { isAgentHomeAccessible } from "../../lib/agent-home-access.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });
const QuerySchema = z.object({ window: z.enum(["week"]).default("week") });

// Load AgentRoster-derived targets (avgValueCents, targetCpbCents) for alex/riley.
// agentId is the URL slug; AgentRoster.agentRole stores the canonical role
// ("responder" | "optimizer"). Falls back to empty config for a zero-config
// tenant. Mira has no roster row and ignores targets, so it skips the lookup.
async function loadAgentTargets(
  prisma: import("@switchboard/db").PrismaClient | null,
  agentId: string,
  orgId: string,
): Promise<{ avgValueCents: number | null; targetCpbCents: number | null }> {
  if (agentId === "mira") return getAgentTargets({ config: {} });
  const rosterRole = agentId === "alex" ? "responder" : "optimizer";
  const rosterRow = await prisma?.agentRoster.findUnique({
    where: { organizationId_agentRole: { organizationId: orgId, agentRole: rosterRole } },
    select: { config: true },
  });
  return getAgentTargets(rosterRow ?? { config: {} });
}

export const metricsRoute: FastifyPluginAsync = async (app) => {
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

  app.get("/agents/:agentId/metrics", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });
    const query = QuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid window" });

    const { agentId } = params.data;
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;
    if (!app.orgAgentEnablementStore) {
      return reply.code(503).send({ error: "Enablement store unavailable" });
    }
    if (!(await isAgentHomeAccessible(agentId, orgId, app.orgAgentEnablementStore))) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    if (!app.reportStores) {
      return reply.code(503).send({ error: "Stores unavailable" });
    }

    const prisma = app.prisma;
    if (agentId === "mira" && !prisma) {
      return reply.code(503).send({ error: "Database unavailable" });
    }

    const reportStores = app.reportStores;
    const timezone = await getOrgTimezone(app.prisma, orgId);
    const targets = await loadAgentTargets(app.prisma, agentId, orgId);

    // Meta Ads spend provider — decorated in apps/api/src/bootstrap/wire-metrics.ts.
    // Falls back to the null-returning provider in test harnesses that build a
    // Fastify app without calling wireMetricsProvider.
    const getMetaSpendCents = app.metaSpendProvider ?? (async () => null);

    const store: MetricsSignalStore = {
      countBookingsCreated: ({ orgId: o, excludeStatuses, from, to }) =>
        reportStores.bookings.countExcludingStatuses({
          orgId: o,
          excludeStatuses,
          from,
          to,
        }),
      countConversionsByType: ({ orgId: o, type, from, to }) =>
        reportStores.conversions.countByType(o, type, from, to),
      getMetaSpendCents: ({ orgId: o, from, to }) => getMetaSpendCents({ orgId: o, from, to }),
    };

    const miraReader = prisma ? new PrismaMiraCreativeReadModelReader(prisma) : undefined;

    try {
      const vm = await projectMetrics({
        orgId,
        agentKey: agentId as "alex" | "riley" | "mira",
        now: new Date(),
        timezone,
        store,
        targets,
        ...(agentId === "mira" && miraReader ? { miraReader } : {}),
      });
      return reply.code(200).send({ vm });
    } catch (err) {
      app.log.error({ err }, "metrics projection failed");
      return reply.code(500).send({ error: "Metrics projection failed" });
    }
  });
};
