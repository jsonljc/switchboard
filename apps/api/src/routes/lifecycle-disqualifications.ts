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
// ---------------------------------------------------------------------------
import type { FastifyInstance } from "fastify";
import {
  isPendingDisqualification,
  type LifecycleSnapshotStore,
  type LifecycleTransitionStore,
  type DisqualificationResolutionHook,
} from "@switchboard/core";

export interface LifecycleDisqualificationsRouteDeps {
  snapshotStore: Pick<LifecycleSnapshotStore, "listPendingDisqualifications">;
  transitionStore: Pick<LifecycleTransitionStore, "findLatestProposal">;
  disqualificationHook: Pick<DisqualificationResolutionHook, "confirm" | "dismiss">;
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

      let out;
      try {
        out = await deps.disqualificationHook.confirm({
          organizationId: orgId,
          conversationThreadId: request.params.threadId,
          operatorId,
          operatorNote: request.body?.operatorNote,
        });
      } catch (err) {
        console.warn(
          `[lifecycle] disqualification confirm threw unexpectedly for thread ${request.params.threadId}:`,
          err instanceof Error ? err.message : String(err),
        );
        return reply.code(404).send({ reason: "not_found" });
      }

      if (out.result === "confirmed") {
        return reply.code(200).send({ result: "confirmed" });
      }
      if (out.result === "already_applied") {
        return reply.code(200).send({ result: "confirmed", alreadyApplied: true });
      }
      if (out.result === "not_found") {
        return reply.code(404).send({ reason: "not_found" });
      }
      if (out.result === "capability_disabled") {
        return reply.code(404).send({ reason: "not_found" });
      }
      // conflict — out.reason is "already_booked" | "not_proposed" | "already_disqualified"
      return reply.code(409).send({ reason: out.reason });
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

      let out;
      try {
        out = await deps.disqualificationHook.dismiss({
          organizationId: orgId,
          conversationThreadId: request.params.threadId,
          operatorId,
          operatorNote: request.body?.operatorNote,
        });
      } catch (err) {
        console.warn(
          `[lifecycle] disqualification dismiss threw unexpectedly for thread ${request.params.threadId}:`,
          err instanceof Error ? err.message : String(err),
        );
        return reply.code(404).send({ reason: "not_found" });
      }

      if (out.result === "dismissed") {
        return reply.code(200).send({ result: "dismissed", restoredStatus: out.restoredStatus });
      }
      if (out.result === "not_found") {
        return reply.code(404).send({ reason: "not_found" });
      }
      if (out.result === "capability_disabled") {
        return reply.code(404).send({ reason: "not_found" });
      }
      // conflict — out.reason is "not_proposed"
      return reply.code(409).send({ reason: out.reason });
    },
  );
}
