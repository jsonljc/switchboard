// ---------------------------------------------------------------------------
// GET /api/dashboard/agents/:agentId/activity (A.4)
//
// Emits ActivityRow[] (from @switchboard/schemas) directly. Audit query is
// org-scoped at the Prisma layer (deps.fetchAuditEntries); translator filters
// by the legacy actor convention (actorId === agentKey OR
// snapshot.agentRole === agentKey OR UUID-actorId-→-alex). Preview fetches
// are batched via ActivityPreviewReader (one Prisma findMany per request).
//
// limit clamps to [1, 200] with default 50; the post-translate result is
// sliced to honor the cap (the deps layer over-fetches to leave room for
// the in-TS agent filter to drop non-matching rows).
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { translateAuditToCockpitActivity } from "@switchboard/core";
import type { AgentHomeKey } from "@switchboard/core";
import { AgentKeySchema } from "@switchboard/schemas";
import type { ActivityRow } from "@switchboard/schemas";
import type { CockpitActivityDeps } from "../../lib/cockpit-activity-deps.js";
import { requireOrganizationScope } from "../../utils/require-org.js";

const ParamsSchema = z.object({ agentId: AgentKeySchema });

const QuerySchema = z.object({
  limit: z
    .union([
      z
        .string()
        .regex(/^\d+$/)
        .transform((s) => parseInt(s, 10)),
      z.number(),
    ])
    .optional(),
  expandPreview: z.union([z.literal("false"), z.literal("true"), z.boolean()]).optional(),
});

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const ALEX_RILEY_ONLY = ["alex", "riley"] as const;

export function cockpitActivityRoutes(deps: CockpitActivityDeps): FastifyPluginAsync {
  return async (app) => {
    // Dev/test mode: allow `x-org-id` header to set the org scope (mirrors
    // sibling agent-home routes). Production auth middleware sets
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

    app.get("/agents/:agentId/activity", async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid agentId" });

      const { agentId } = params.data;
      if (!ALEX_RILEY_ONLY.includes(agentId as (typeof ALEX_RILEY_ONLY)[number])) {
        return reply.code(404).send({ error: "Agent not available on home" });
      }

      const query = QuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "Invalid query" });

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const rawLimit = query.data.limit ?? DEFAULT_LIMIT;
      const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)));

      // expandPreview defaults to true; false only when explicitly "false" or boolean false.
      const ep = query.data.expandPreview;
      const expandPreview = !(ep === false || ep === "false");

      try {
        const entries = await deps.fetchAuditEntries({ orgId, limit });
        const agentKey = agentId as AgentHomeKey; // narrowed by ALEX_RILEY_ONLY guard above
        const translated = await translateAuditToCockpitActivity({
          entries,
          previewReader: deps.previewReader,
          orgId,
          agentKey,
          limit,
          expandPreview,
        });
        const rows: ActivityRow[] = translated.slice(0, limit);
        return reply.code(200).send({ rows });
      } catch (err) {
        app.log.error({ err }, "cockpit activity route failed");
        return reply.code(500).send({ error: "Activity feed failed" });
      }
    });
  };
}
