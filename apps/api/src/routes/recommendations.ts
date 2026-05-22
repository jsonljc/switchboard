// @route-class: operator-direct
import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import { z } from "zod";
import { type RecommendationSurface, type RecommendationStatus } from "@switchboard/core";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { replyValidationError } from "../utils/validation-error.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
import {
  ACT_ON_RECOMMENDATION_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

const ACT_HTTP_RATE_LIMIT_MAX = parseInt(
  process.env["RECOMMENDATION_ACT_RATE_LIMIT_MAX"] ?? "300",
  10,
);
const ACT_HTTP_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env["RECOMMENDATION_ACT_RATE_LIMIT_WINDOW_MS"] ?? "60000",
  10,
);

const VALID_SURFACES: ReadonlySet<RecommendationSurface> = new Set(["queue", "shadow_action"]);

const ActBodySchema = z.object({
  action: z.enum(["primary", "secondary", "dismiss", "confirm", "undo"]),
  note: z.string().optional(),
});

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

  // Dev/test mode (authDisabled): populate organizationIdFromAuth + principalIdFromAuth
  // from x-org-id / x-principal-id headers (or fall back to "default"). In production
  // this hook is a no-op; the real auth middleware has already populated the fields.
  app.addHook("preHandler", buildDevAuthFallback(app));

  app.get(
    "/",
    {
      preHandler: requireOrg,
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
      const { orgId } = request;

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
      preHandler: requireOrgForMutation,
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
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }

      const { orgId, actorId } = request;
      const { id } = request.params as { id: string };

      const parsed = ActBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return replyValidationError(reply, parsed.error);
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: ACT_ON_RECOMMENDATION_INTENT,
        parameters: {
          recommendationId: id,
          action: parsed.data.action,
          note: parsed.data.note,
        },
        trigger: "api",
        surface: { surface: "api" },
        idempotencyKey,
      });

      if (!response.ok) {
        return ingressErrorToReply(response.error, reply);
      }

      const { result } = response;
      if (result.outcome === "failed") {
        if (result.error?.code === OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_NOT_FOUND) {
          return reply.code(404).send({ error: "Recommendation not found", statusCode: 404 });
        }
        if (result.error?.code === OPERATOR_INTENT_ERROR_CODES.RECOMMENDATION_INVALID_ACTION) {
          return reply.code(400).send({ error: result.error.message, statusCode: 400 });
        }
        // Any other handler failure is an unexpected execution error. Throw so
        // the global error handler returns a scrubbed 500 — don't echo internal
        // error codes to the client.
        throw new Error(result.error?.message ?? "Operator mutation execution failed");
      }

      const actResult = (
        result.outputs as { result?: { status: string; row: Parameters<typeof rowToApiShape>[0] } }
      ).result;
      if (!actResult) {
        throw new Error("Operator mutation handler returned no result output");
      }
      if (actResult.status === "ok") {
        return reply.code(200).send({ recommendation: rowToApiShape(actResult.row) });
      }
      // already_terminal | expired | undo_window_closed all map to 409 with current row
      return reply.code(409).send({
        error: actResult.status,
        recommendation: rowToApiShape(actResult.row),
      });
    },
  );
};
