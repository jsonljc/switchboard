import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { projectMetrics, type MetricsSignalStore } from "@switchboard/core";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });
const QuerySchema = z.object({ window: z.enum(["week"]).default("week") });

const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

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
    if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
      return reply.code(404).send({ error: "Agent not available on home" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    if (!app.reportStores) {
      return reply.code(503).send({ error: "Stores unavailable" });
    }

    const reportStores = app.reportStores;
    const timezone = await getOrgTimezone(app.prisma, orgId);

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
    };

    try {
      const vm = await projectMetrics({
        orgId,
        agentKey: agentId as "alex" | "riley",
        now: new Date(),
        timezone,
        store,
      });
      return reply.code(200).send({ vm });
    } catch (err) {
      app.log.error({ err }, "metrics projection failed");
      return reply.code(500).send({ error: "Metrics projection failed" });
    }
  });
};
