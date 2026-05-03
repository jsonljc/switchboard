import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import {
  actOnRecommendation,
  type RecommendationAction,
  type RecommendationSurface,
  type RecommendationStatus,
} from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

const ACT_HTTP_RATE_LIMIT_MAX = parseInt(
  process.env["RECOMMENDATION_ACT_RATE_LIMIT_MAX"] ?? "300",
  10,
);
const ACT_HTTP_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env["RECOMMENDATION_ACT_RATE_LIMIT_WINDOW_MS"] ?? "60000",
  10,
);

const VALID_SURFACES: ReadonlySet<RecommendationSurface> = new Set(["queue", "shadow_action"]);
const VALID_ACTIONS: ReadonlySet<RecommendationAction> = new Set([
  "primary",
  "secondary",
  "dismiss",
  "confirm",
  "undo",
]);

function parseSinceMs(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(\d+)h$/.exec(s);
  if (!m) return undefined;
  return parseInt(m[1]!, 10) * 60 * 60 * 1000;
}

type RecommendationRow = NonNullable<
  Awaited<ReturnType<NonNullable<FastifyInstance["recommendationStore"]>["getById"]>>
>;

function rowToApiShape(row: RecommendationRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.orgId,
    agentKey: row.agentKey,
    intent: row.intent,
    action: row.action,
    humanSummary: row.humanSummary,
    confidence: row.confidence,
    dollarsAtRisk: row.dollarsAtRisk,
    riskLevel: row.riskLevel,
    surface: row.surface,
    status: row.status,
    parameters: row.parameters,
    targetEntities: row.targetEntities,
    sourceAgent: row.sourceAgent,
    sourceWorkflow: row.sourceWorkflow,
    actedBy: row.actedBy,
    actedAt: row.actedAt?.toISOString() ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    undoableUntil: row.undoableUntil?.toISOString() ?? null,
  };
}

export const recommendationsRoutes: FastifyPluginAsync = async (app) => {
  if (!app.recommendationStore) {
    app.log.warn("[recommendations] route registered without store; will 503 on every request");
  }

  // Dev/test mode (authDisabled): default organizationIdFromAuth + principalIdFromAuth
  // so requireOrganizationScope and acting actor have sensible values. In production
  // (authDisabled === false) the auth middleware sets these from API_KEY_METADATA, and
  // requireOrganizationScope correctly 403s when they are missing.
  app.addHook("preHandler", async (request) => {
    if (app.authDisabled === true) {
      if (!request.organizationIdFromAuth) {
        request.organizationIdFromAuth = "default";
      }
      if (!request.principalIdFromAuth) {
        request.principalIdFromAuth = "default";
      }
    }
  });

  app.get(
    "/",
    {
      schema: {
        description: "List recommendations by surface",
        tags: ["Recommendations"],
      },
    },
    async (request, reply) => {
      if (!app.recommendationStore) {
        return reply
          .code(503)
          .send({ error: "Recommendations store unavailable", statusCode: 503 });
      }
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const q = request.query as {
        surface?: string;
        status?: string;
        since?: string;
        limit?: string;
      };
      if (!q.surface || !VALID_SURFACES.has(q.surface as RecommendationSurface)) {
        return reply.code(400).send({
          error: "surface query param required (queue|shadow_action)",
          statusCode: 400,
        });
      }
      const limit = q.limit ? Math.min(parseInt(q.limit, 10) || 50, 200) : 50;
      const rows = await app.recommendationStore.listBySurface({
        orgId,
        surface: q.surface as Exclude<RecommendationSurface, "dropped">,
        status: (q.status ?? "pending") as RecommendationStatus,
        sinceMs: parseSinceMs(q.since),
        limit,
      });
      return reply.code(200).send({ recommendations: rows.map(rowToApiShape) });
    },
  );

  app.post(
    "/:id/act",
    {
      schema: {
        description: "Act on a recommendation (primary | secondary | dismiss | confirm | undo).",
        tags: ["Recommendations"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["action"],
          properties: {
            action: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      config: {
        rateLimit: {
          max: ACT_HTTP_RATE_LIMIT_MAX,
          timeWindow: ACT_HTTP_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      if (!app.recommendationStore) {
        return reply
          .code(503)
          .send({ error: "Recommendations store unavailable", statusCode: 503 });
      }
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const body = request.body as { action?: string; note?: string };

      if (!body?.action || !VALID_ACTIONS.has(body.action as RecommendationAction)) {
        return reply.code(400).send({
          error: `action must be one of ${[...VALID_ACTIONS].join("|")}`,
          statusCode: 400,
        });
      }

      const row = await app.recommendationStore.getById(id);
      if (!row) {
        return reply.code(404).send({ error: "Recommendation not found", statusCode: 404 });
      }
      if (row.orgId !== orgId) {
        return reply.code(404).send({ error: "Recommendation not found", statusCode: 404 });
      }

      const principalId = request.principalIdFromAuth ?? "dashboard-user";

      try {
        const result = await actOnRecommendation(app.recommendationStore, {
          recommendationId: id,
          orgId,
          actor: { principalId, type: "operator" },
          action: body.action as RecommendationAction,
          note: body.note,
        });

        if (result.status === "ok") {
          return reply.code(200).send({ recommendation: rowToApiShape(result.row) });
        }
        // already_terminal | expired | undo_window_closed all map to 409 with current row
        return reply.code(409).send({
          error: result.status,
          recommendation: rowToApiShape(result.row),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("queue surface accepts") || msg.includes("shadow surface accepts")) {
          return reply.code(400).send({ error: msg, statusCode: 400 });
        }
        if (msg.includes("org mismatch")) {
          return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
        }
        if (msg.includes("not found")) {
          return reply.code(404).send({ error: msg, statusCode: 404 });
        }
        return reply.code(500).send({ error: msg, statusCode: 500 });
      }
    },
  );
};
