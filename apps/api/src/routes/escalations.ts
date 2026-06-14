// @route-class: lifecycle
// ---------------------------------------------------------------------------
// Escalation Inbox Routes — Owner escalation management backend
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { ConversationStateNotFoundError, ContactNotFoundError } from "@switchboard/core/platform";
import { requireOrganizationScope } from "../utils/require-org.js";
import { resolveOperatorActor } from "./operator-actor.js";
import { finalizeOperatorTrace } from "./work-trace-delivery-enrichment.js";

/** A rendered conversation turn: role "user"=lead, "assistant"=agent, "owner"=operator. */
interface ConversationTurn {
  role?: string;
  text?: string;
  timestamp?: string;
}

/**
 * Cap on transcript turns returned with an escalation. The handoff sheet renders
 * only the most recent turns, so a long thread does not need its full history
 * loaded; bound the read and return the most recent slice in chronological order.
 */
const MAX_TRANSCRIPT_MESSAGES = 100;

/** The Handoff fields the escalation payload needs. Structural (not the generated
 *  Prisma model type) so the route's Handoff rows satisfy it without apps/api
 *  taking a direct @prisma/client dependency. */
interface EscalationHandoffRow {
  id: string;
  sessionId: string | null;
  leadId: unknown;
  status: unknown;
  reason: unknown;
  conversationSummary: unknown;
  leadSnapshot: unknown;
  qualificationSnapshot: unknown;
  slaDeadlineAt: Date;
  acknowledgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Serialize a Handoff row into the escalation payload the inbox UI consumes. */
function toEscalationResponse(h: EscalationHandoffRow) {
  return {
    id: h.id,
    sessionId: h.sessionId,
    leadId: h.leadId,
    status: h.status,
    reason: h.reason,
    conversationSummary: h.conversationSummary,
    leadSnapshot: h.leadSnapshot,
    qualificationSnapshot: h.qualificationSnapshot,
    slaDeadlineAt: h.slaDeadlineAt.toISOString(),
    acknowledgedAt: h.acknowledgedAt?.toISOString() ?? null,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

export const escalationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/escalations — list escalations filtered by status
  app.get(
    "/",
    {
      schema: {
        description:
          "List escalations for the organization, filtered by status (default: pending).",
        tags: ["Escalations"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", default: "pending" },
            limit: { type: "number", default: 50, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { status = "pending", limit = 50 } = request.query as {
        status?: string;
        limit?: number;
      };

      const escalations = await app.prisma.handoff.findMany({
        where: {
          organizationId: orgId,
          status,
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 200),
      });

      const formatted = escalations.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        leadId: e.leadId,
        status: e.status,
        reason: e.reason,
        conversationSummary: e.conversationSummary,
        leadSnapshot: e.leadSnapshot,
        qualificationSnapshot: e.qualificationSnapshot,
        slaDeadlineAt: e.slaDeadlineAt.toISOString(),
        acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
        resolutionNote: e.resolutionNote ?? null,
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }));

      return reply.send({ escalations: formatted });
    },
  );

  // GET /api/escalations/:id — single escalation with conversation history
  app.get(
    "/:id",
    {
      schema: {
        description: "Get a single escalation with full conversation history.",
        tags: ["Escalations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };

      const handoff = await app.prisma.handoff.findUnique({
        where: { id },
      });

      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      // Assemble the lead/agent transcript. On the managed-channel path those
      // turns are written by the gateway to ConversationMessage, keyed by
      // contactId. Handoff.sessionId is NOT a session/thread key: it is the
      // WorkUnit traceId of the turn that escalated (skill-mode sets the skill
      // context sessionId to workUnit.traceId). So resolve the contact via that
      // turn's WorkTrace lineage (the gateway threads contactId onto every
      // turn's trace), then read the transcript by contactId.
      //
      // Both lookups are org-scoped (defense-in-depth, TI-5/TI-6): the Handoff
      // orgId guard above gates access, but a WorkTrace or ConversationMessage
      // row may carry a divergent org, so each lookup re-asserts the scope.
      let conversationHistory: ConversationTurn[] = [];
      if (handoff.sessionId) {
        const trace = await app.prisma.workTrace.findFirst({
          where: {
            traceId: handoff.sessionId,
            organizationId: orgId,
            contactId: { not: null },
          },
          orderBy: { requestedAt: "desc" },
          select: { contactId: true },
        });

        if (trace?.contactId) {
          const messages = await app.prisma.conversationMessage.findMany({
            where: { contactId: trace.contactId, orgId },
            orderBy: { createdAt: "desc" },
            take: MAX_TRANSCRIPT_MESSAGES,
          });
          // Reverse the newest-first slice back into chronological order.
          conversationHistory = messages.reverse().map((m) => ({
            role: m.direction === "inbound" ? "user" : "assistant",
            text: m.content,
            timestamp: m.createdAt.toISOString(),
          }));
        }
      }

      const escalation = {
        id: handoff.id,
        sessionId: handoff.sessionId,
        leadId: handoff.leadId,
        status: handoff.status,
        reason: handoff.reason,
        conversationSummary: handoff.conversationSummary,
        leadSnapshot: handoff.leadSnapshot,
        qualificationSnapshot: handoff.qualificationSnapshot,
        slaDeadlineAt: handoff.slaDeadlineAt.toISOString(),
        acknowledgedAt: handoff.acknowledgedAt?.toISOString() ?? null,
        resolutionNote: handoff.resolutionNote ?? null,
        resolvedAt: handoff.resolvedAt?.toISOString() ?? null,
        createdAt: handoff.createdAt.toISOString(),
        updatedAt: handoff.updatedAt.toISOString(),
      };

      return reply.send({ escalation, conversationHistory });
    },
  );

  // POST /api/escalations/:id/reply — owner replies and releases escalation
  app.post(
    "/:id/reply",
    {
      schema: {
        description:
          "Owner replies to escalation, updates status to released, and resumes conversation.",
        tags: ["Escalations"],
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const { message } = request.body as { message: string };

      if (!message || typeof message !== "string") {
        return reply.code(400).send({ error: "Message is required", statusCode: 400 });
      }

      const handoff = await app.prisma.handoff.findUnique({
        where: { id },
      });

      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      // Idempotency: a successful reply flips the handoff to "released" and leaves
      // it there, so an already-released handoff means this reply was already
      // delivered. Treat a re-POST as an idempotent no-op rather than delivering
      // the message a second time.
      if (handoff.status === "released") {
        return reply.send({ escalation: toEscalationResponse(handoff), replySent: true });
      }

      // Release the handoff up front. The mutation is org-scoped via updateMany so
      // it fails closed independently of the guard above (updateMany drops
      // Prisma's P2025, hence the count===0 guard). The release is NOT terminal:
      // if delivery then fails it is rolled back to "pending" (below) so the
      // escalation never lingers as released-but-undelivered and the owner can
      // retry — which the idempotency short-circuit would otherwise swallow.
      const releaseResult = await app.prisma.handoff.updateMany({
        where: { id, organizationId: orgId },
        data: { status: "released", acknowledgedAt: new Date() },
      });
      if (releaseResult.count === 0) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }
      const updatedHandoff = await app.prisma.handoff.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!updatedHandoff) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }
      const escalation = toEscalationResponse(updatedHandoff);

      // Compensating undo of the release above so a failed delivery reopens the
      // escalation for a retry. Scoped to status "released" so a concurrent
      // transition is never clobbered. CAVEAT: this reverts only the Handoff
      // status; the ConversationMessage transcript that releaseEscalationToAi
      // writes before delivery is NOT undone, so a retry re-appends the owner
      // line. That duplication is pre-existing (the prior code re-ran the store
      // call on every retry too); making releaseEscalationToAi idempotent is a
      // tracked follow-up, not in scope here.
      const rollbackRelease = () =>
        app.prisma!.handoff.updateMany({
          where: { id, organizationId: orgId, status: "released" },
          data: { status: "pending", acknowledgedAt: null },
        });

      // No session means no conversation to deliver to. Preserve the historical
      // behavior: the escalation stays released (the owner closed an undeliverable
      // handoff) and we return 502.
      if (!handoff.sessionId) {
        return reply.code(502).send({
          escalation,
          replySent: false,
          error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
          statusCode: 502,
        });
      }

      if (!app.conversationStateStore || !app.workTraceStore) {
        await rollbackRelease();
        return reply.code(503).send({ error: "Conversation store unavailable", statusCode: 503 });
      }

      // Resolve the escalate-tool contact via the WorkTrace lineage (mirrors the
      // GET transcript read): the escalate tool keys the handoff sessionId to a
      // workUnit.traceId, and the gateway threads contactId onto every turn's
      // trace. A resolved contactId routes the reply to ConversationMessage +
      // Contact-keyed delivery; a miss (gateway pre-input-gate handoffs have no
      // WorkTrace) falls back to the phone-threaded ConversationState (unchanged).
      const traceForContact = await app.prisma.workTrace.findFirst({
        where: {
          traceId: handoff.sessionId,
          organizationId: orgId,
          contactId: { not: null },
        },
        orderBy: { requestedAt: "desc" },
        select: { contactId: true },
      });
      const target = traceForContact?.contactId
        ? { contactId: traceForContact.contactId }
        : { threadId: handoff.sessionId };

      let storeResult;
      try {
        storeResult = await app.conversationStateStore.releaseEscalationToAi({
          organizationId: orgId,
          handoffId: handoff.id,
          operator: resolveOperatorActor(request),
          reply: { text: message },
          target,
        });
      } catch (err) {
        // Delivery is unresolved, so roll back the release => the escalation
        // reopens (pending) and the owner can retry.
        if (err instanceof ContactNotFoundError) {
          await rollbackRelease();
          return reply.code(502).send({
            escalation,
            replySent: false,
            error: "Reply saved but delivery is unresolved (contact not found).",
            statusCode: 502,
          });
        }
        // Missing phone-threaded ConversationState (gateway path): unchanged 404.
        if (err instanceof ConversationStateNotFoundError) {
          await rollbackRelease();
          return reply
            .code(404)
            .send({ error: "Conversation not found for escalation", statusCode: 404 });
        }
        await rollbackRelease();
        throw err;
      }

      const executionStartedAt = new Date();
      let deliveryAttempted = false;
      let deliveryResult = "no_notifier";
      if (app.agentNotifier) {
        deliveryAttempted = true;
        try {
          await app.agentNotifier.sendProactive(
            storeResult.destinationPrincipalId,
            storeResult.channel,
            message,
          );
          deliveryResult = "delivered";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[escalations] Channel delivery failed for ${handoff.sessionId}: ${msg}`);
          deliveryResult = `failed: ${msg}`;
        }
      }

      await finalizeOperatorTrace(app.workTraceStore, storeResult.workTraceId, {
        deliveryAttempted,
        deliveryResult,
        executionStartedAt,
        completedAt: new Date(),
        caller: "escalations.reply",
      });

      if (deliveryResult !== "delivered") {
        // Roll back the release so the escalation reopens (pending) and the owner
        // can retry; the idempotency short-circuit at the top only swallows
        // re-POSTs once the reply is actually delivered.
        await rollbackRelease();
        return reply.code(502).send({
          escalation,
          replySent: false,
          error: "Reply saved but channel delivery failed. Retry or contact customer directly.",
          statusCode: 502,
        });
      }

      return reply.send({ escalation, replySent: true });
    },
  );

  // POST /api/escalations/:id/resolve — mark escalation resolved with optional note
  app.post(
    "/:id/resolve",
    {
      schema: {
        description: "Mark an escalation as resolved with an optional internal note.",
        tags: ["Escalations"],
        body: {
          type: "object",
          properties: {
            resolutionNote: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const { id } = request.params as { id: string };
      const { resolutionNote } = (request.body as { resolutionNote?: string }) ?? {};

      const handoff = await app.prisma.handoff.findUnique({ where: { id } });

      if (!handoff || handoff.organizationId !== orgId) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      // Org-scoped write (updateMany + count===0 guard) so the mutation fails
      // closed independently of the guard above; updateMany drops P2025.
      const resolveResult = await app.prisma.handoff.updateMany({
        where: { id, organizationId: orgId },
        data: {
          status: "resolved",
          resolutionNote: resolutionNote ?? null,
          resolvedAt: new Date(),
        },
      });
      if (resolveResult.count === 0) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }
      const updatedHandoff = await app.prisma.handoff.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!updatedHandoff) {
        return reply.code(404).send({ error: "Escalation not found", statusCode: 404 });
      }

      return reply.send({
        escalation: {
          id: updatedHandoff.id,
          sessionId: updatedHandoff.sessionId,
          leadId: updatedHandoff.leadId,
          status: updatedHandoff.status,
          reason: updatedHandoff.reason,
          resolutionNote: updatedHandoff.resolutionNote,
          resolvedAt: updatedHandoff.resolvedAt?.toISOString() ?? null,
          slaDeadlineAt: updatedHandoff.slaDeadlineAt.toISOString(),
          createdAt: updatedHandoff.createdAt.toISOString(),
          updatedAt: updatedHandoff.updatedAt.toISOString(),
        },
      });
    },
  );
};
