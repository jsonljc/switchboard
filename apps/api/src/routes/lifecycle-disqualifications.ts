// apps/api/src/routes/lifecycle-disqualifications.ts
// ---------------------------------------------------------------------------
// Phase 3b — operator-facing lifecycle disqualification API
//
// Endpoints:
//   GET  /api/dashboard/lifecycle/disqualifications/pending
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/confirm
//   POST /api/dashboard/lifecycle/disqualifications/:threadId/dismiss
//
// Auth: uses request.organizationIdFromAuth (set by authMiddleware in prod;
// set via preHandler hook from `x-org-id` header in dev/test — mirrors the
// decisions route pattern). principalIdFromAuth supplies the operatorId; falls
// back to "system:unknown" in dev mode where no API key is bound to a principal.
//
// POST routes use PlatformIngress.submit (Wave 2 Phase 1b.3 migration).
// ---------------------------------------------------------------------------
import type { FastifyInstance } from "fastify";
import {
  isPendingDisqualification,
  type LifecycleSnapshotStore,
  type LifecycleTransitionStore,
} from "@switchboard/core";
import { getIdempotencyKey } from "../utils/idempotency-key.js";
import { ingressErrorToReply } from "../utils/ingress-error-to-reply.js";
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
  // Dev/test mode: allow `x-org-id` header to set the org scope.
  // In production the auth middleware sets organizationIdFromAuth before handlers run.
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

  // ---------------------------------------------------------------------------
  // GET /api/dashboard/lifecycle/disqualifications/pending
  // ---------------------------------------------------------------------------
  app.get(
    "/api/dashboard/lifecycle/disqualifications/pending",
    {
      schema: {
        description:
          "List all pending proposed-disqualification snapshots for the authenticated org.",
        tags: ["Dashboard", "Lifecycle"],
      },
    },
    async (request, reply) => {
      const orgId = request.organizationIdFromAuth;
      if (!orgId) {
        return reply.code(403).send({
          error: "Forbidden: organization-scoped authentication is required",
          statusCode: 403,
        });
      }

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
      const orgId = request.organizationIdFromAuth;
      const operatorId = request.principalIdFromAuth ?? "system:unknown";
      if (!orgId) {
        return reply.code(403).send({
          error: "Forbidden: organization-scoped authentication is required",
          statusCode: 403,
        });
      }

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      if (!app.disqualificationHook) {
        return reply
          .code(503)
          .send({ error: "Disqualification capability not available", statusCode: 503 });
      }

      const idempotencyKey = getIdempotencyKey(request);

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: operatorId, type: "user" },
        intent: CONFIRM_DISQUALIFICATION_INTENT,
        parameters: {
          conversationThreadId: request.params.threadId,
          operatorNote: request.body?.operatorNote,
        },
        trigger: "api",
        surface: { surface: "api" },
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
      const orgId = request.organizationIdFromAuth;
      const operatorId = request.principalIdFromAuth ?? "system:unknown";
      if (!orgId) {
        return reply.code(403).send({
          error: "Forbidden: organization-scoped authentication is required",
          statusCode: 403,
        });
      }

      if (!app.platformIngress) {
        return reply.code(503).send({ error: "Platform ingress not available", statusCode: 503 });
      }
      if (!app.disqualificationHook) {
        return reply
          .code(503)
          .send({ error: "Disqualification capability not available", statusCode: 503 });
      }

      const idempotencyKey = getIdempotencyKey(request);

      const response = await app.platformIngress.submit({
        organizationId: orgId,
        actor: { id: operatorId, type: "user" },
        intent: DISMISS_DISQUALIFICATION_INTENT,
        parameters: {
          conversationThreadId: request.params.threadId,
          operatorNote: request.body?.operatorNote,
        },
        trigger: "api",
        surface: { surface: "api" },
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
