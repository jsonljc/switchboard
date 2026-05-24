// @route-class: read-only
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { projectWins, type WinsSignalStore } from "@switchboard/core";
import { AgentKeySchema } from "@switchboard/schemas";
import { requireOrganizationScope } from "../../utils/require-org.js";
import { getOrgTimezone } from "../../lib/org-timezone.js";

const ParamsSchema = z.object({
  agentId: AgentKeySchema,
});
const QuerySchema = z.object({
  window: z.enum(["today", "week", "month"]).default("today"),
});

const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

export const winsRoute: FastifyPluginAsync = async (app) => {
  // Dev/test mode: allow `x-org-id` header to set the org scope (mirrors
  // decisions route). In production, the auth middleware sets
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

  app.get("/agents/:agentId/wins", async (request, reply) => {
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

    if (!app.recommendationStore) {
      return reply.code(503).send({ error: "Recommendations store unavailable" });
    }

    const timezone = await getOrgTimezone(app.prisma, orgId);

    const recommendationStore = app.recommendationStore;

    const store: WinsSignalStore = {
      async listResolvedForAgent({ orgId: o, agentKey, statuses, resolvedSince, limit }) {
        const rows = await recommendationStore.listResolvedForAgent({
          orgId: o,
          agentKey,
          statuses,
          resolvedSince,
          limit,
        });
        // Defensive: the store's filter requires non-null actedAt,
        // but we drop any row with null actedAt rather than fabricating recency.
        return rows.flatMap((r) => {
          if (!r.actedAt) {
            app.log.warn(
              { recommendationId: r.id, orgId: o },
              "wins: dropped row with null actedAt despite store filter",
            );
            return [];
          }
          return [
            {
              id: r.id,
              agentKey: r.agentKey as "alex" | "riley",
              status: r.status as "acted" | "confirmed",
              intent: r.intent,
              humanSummary: r.humanSummary,
              occurredAt: r.actedAt,
              undoableUntil: r.undoableUntil,
              targetEntities: r.targetEntities,
            },
          ];
        });
      },
    };

    try {
      const vm = await projectWins({
        orgId,
        agentKey: agentId as "alex" | "riley",
        window: query.data.window,
        now: new Date(),
        timezone,
        store,
      });
      return reply.code(200).send({ vm });
    } catch (err) {
      app.log.error({ err }, "wins projection failed");
      return reply.code(500).send({ error: "Wins projection failed" });
    }
  });
};
