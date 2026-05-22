// @route-class: operator-direct
// apps/api/src/routes/lifecycle-disqualifications.ts
// ---------------------------------------------------------------------------
// Phase 3b — operator-facing lifecycle disqualification API
//
// Endpoints:
//   GET  /api/dashboard/lifecycle/disqualifications/pending
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
//
// Auth: `buildDevAuthFallback` populates org/principal in dev/test mode;
// production auth middleware does it for real. The `requireOrg` /
// `requireOrgForMutation` decorators narrow `request.orgId` + `request.actorId`
// and fail-closed with 403 when no org is bound (Route Governance Contract v1).
//
// POST routes use PlatformIngress.submit (Wave 2 Phase 1b.3 migration) and
// mandate `Idempotency-Key` via `requireIdempotencyKey` (Contract §7.1).
// ---------------------------------------------------------------------------
import type { FastifyInstance } from "fastify";
import {
  isPendingDisqualification,
  type LifecycleSnapshotStore,
  type LifecycleTransitionStore,
} from "@switchboard/core";
import { requireIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
import { buildDevAuthFallback } from "../utils/auth-fallback.js";
import { requireOrg, requireOrgForMutation } from "../decorators/require-org.js";
import {
  CONFIRM_DISQUALIFICATION_INTENT,
  DISMISS_DISQUALIFICATION_INTENT,
  OPERATOR_INTENT_ERROR_CODES,
} from "../bootstrap/operator-intents.js";

export interface LifecycleDisqualificationsRouteDeps {
  snapshotStore: Pick<LifecycleSnapshotStore, "listPendingDisqualifications">;
  transitionStore: Pick<LifecycleTransitionStore, "findLatestProposal">;
}

export async function registerLifecycleDisqualificationsRoutes(
  app: FastifyInstance,
  deps: LifecycleDisqualificationsRouteDeps,
): Promise<void> {
  // Dev/test mode (authDisabled): populate organizationIdFromAuth + principalIdFromAuth
  // from x-org-id / x-principal-id headers (or fall back to "default"). In production
  // this hook is a no-op; the real auth middleware has already populated the fields.
  app.addHook("preHandler", buildDevAuthFallback(app));

  // ---------------------------------------------------------------------------
  // GET /api/dashboard/lifecycle/disqualifications/pending
  // ---------------------------------------------------------------------------
  app.get(
    "/api/dashboard/lifecycle/disqualifications/pending",
    {
      preHandler: requireOrg,
      schema: {
        description:
          "List all pending proposed-disqualification snapshots for the authenticated org.",
        tags: ["Dashboard", "Lifecycle"],
      },
    },
    async (request, reply) => {
      const { orgId } = request;

      const snapshots = await deps.snapshotStore.listPendingDisqualifications(orgId);
      const items: Array<{
        conversationThreadId: string;
        contactId: string;
        currentState: string;
        evidence: Record<string, unknown> | null;
      }> = [];

      for (const snap of snapshots) {
        if (!isPendingDisqualification(snap)) continue;
        const proposal = await deps.transitionStore.findLatestProposal(snap.conversationThreadId);
        items.push({
          conversationThreadId: snap.conversationThreadId,
          contactId: snap.contactId,
          currentState: snap.currentState,
          evidence: proposal?.evidence ?? null,
        });
      }

      return reply.code(200).send({ items });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
  // ---------------------------------------------------------------------------
  app.post<{
    Params: { threadId: string };
    Body: { operatorNote?: string };
  }>(
    "/api/dashboard/lifecycle/disqualifications/:threadId/confirm",
    {
      preHandler: requireOrgForMutation,
      schema: {
        description: "Confirm a proposed disqualification, advancing the thread to disqualified.",
        tags: ["Dashboard", "Lifecycle"],
        params: {
          type: "object",
          properties: { threadId: { type: "string" } },
          required: ["threadId"],
        },
        body: {
          type: "object",
          properties: { operatorNote: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      if (!app.disqualificationHook) {
        return reply
          .code(503)
          .send({ error: "Disqualification capability not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const { orgId, actorId } = request;

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: CONFIRM_DISQUALIFICATION_INTENT,
        parameters: {
          conversationThreadId: request.params.threadId,
          operatorNote: request.body?.operatorNote,
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
        const code = result.error?.code;
        if (
          code === OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_NOT_FOUND ||
          code === OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_HOOK_THROW
        ) {
          return reply.code(404).send({ reason: "not_found" });
        }
        if (code === OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_CONFLICT) {
          const reason = (result.outputs as { reason?: string } | undefined)?.reason;
          return reply.code(409).send({ reason });
        }
        // Any other handler failure is an unexpected execution error — throw so
        // the global error handler returns a scrubbed 500.
        throw new Error(result.error?.message ?? "Operator mutation execution failed");
      }

      // outcome === "completed" — unwrap result from outputs
      const outputs = result.outputs as {
        result?: string;
        alreadyApplied?: boolean;
      };

      if (!outputs?.result) {
        throw new Error("Disqualification confirm handler returned no result output");
      }

      if (outputs.alreadyApplied) {
        return reply.code(200).send({ result: "confirmed", alreadyApplied: true });
      }
      return reply.code(200).send({ result: "confirmed" });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
  // ---------------------------------------------------------------------------
  app.post<{
    Params: { threadId: string };
    Body: { operatorNote?: string };
  }>(
    "/api/dashboard/lifecycle/disqualifications/:threadId/dismiss",
    {
      preHandler: requireOrgForMutation,
      schema: {
        description:
          "Dismiss a proposed disqualification, restoring the prior qualification status.",
        tags: ["Dashboard", "Lifecycle"],
        params: {
          type: "object",
          properties: { threadId: { type: "string" } },
          required: ["threadId"],
        },
        body: {
          type: "object",
          properties: { operatorNote: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      if (!app.disqualificationHook) {
        return reply
          .code(503)
          .send({ error: "Disqualification capability not available", statusCode: 503 });
      }

      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;

      const { orgId, actorId } = request;

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: actorId, type: "user" },
        intent: DISMISS_DISQUALIFICATION_INTENT,
        parameters: {
          conversationThreadId: request.params.threadId,
          operatorNote: request.body?.operatorNote,
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
        const code = result.error?.code;
        if (
          code === OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_NOT_FOUND ||
          code === OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_HOOK_THROW
        ) {
          return reply.code(404).send({ reason: "not_found" });
        }
        if (code === OPERATOR_INTENT_ERROR_CODES.DISQUALIFICATION_CONFLICT) {
          const reason = (result.outputs as { reason?: string } | undefined)?.reason;
          return reply.code(409).send({ reason });
        }
        // Any other handler failure is an unexpected execution error — throw so
        // the global error handler returns a scrubbed 500.
        throw new Error(result.error?.message ?? "Operator mutation execution failed");
      }

      // outcome === "completed" — unwrap result from outputs
      const outputs = result.outputs as {
        result?: string;
        restoredStatus?: string;
      };

      if (!outputs?.result) {
        throw new Error("Disqualification dismiss handler returned no result output");
      }

      return reply.code(200).send({ result: "dismissed", restoredStatus: outputs.restoredStatus });
    },
  );
}
