// @route-class: lifecycle
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { respondToChannelApproval } from "@switchboard/core";
import type { OperatorChannelBindingStore } from "@switchboard/core";
import { InternalChatApprovalRespondBodySchema } from "../validation.js";

// Internal chat-approval bridge (spec
// docs/superpowers/specs/2026-06-05-chat-approval-bridge-design.md).
//
// The chat process forwards webhook-authenticated channel identity; this route
// re-derives the operator principal SERVER-SIDE from the org-scoped
// OperatorChannelBinding + role check and runs the same unified respond engine
// as POST /api/approvals/:id/respond. Trust model: INTERNAL_API_SECRET
// authenticates the CALLER PROCESS, not an operator. respondedBy never crosses
// this wire (the strict body schema 400s it); the binding lookup is the only
// identity authority.
//
// HTTP discipline (spec 3.1): 200 + outcome JSON for every FLOW outcome,
// refusals included; non-2xx only for bridge-level failures (400 shape, 401
// secret, 503 unconfigured, 429 rate limit). The path is excluded from the
// API-key auth middleware (exact path) and self-authenticates here, fail
// closed, mirroring apps/chat/src/main.ts /internal/provision-notify.
//
// Logging discipline (spec 4.1): log approvalId, org, channel, and the
// outcome code; never channelIdentifier (operator phone/user ids),
// bindingHash, or any part of the secret.

const INTERNAL_RATE_LIMIT_MAX = 300; // operator taps are human-scale
const INTERNAL_RATE_LIMIT_WINDOW_MS = 60_000;

export interface InternalChatApprovalsOptions {
  /** Test seam; production builds PrismaOperatorChannelBindingStore from app.prisma. */
  bindingStore?: OperatorChannelBindingStore;
}

type SecretCheck = "ok" | "unconfigured" | "unauthorized";

function validateInternalSecret(request: FastifyRequest): SecretCheck {
  const secret = process.env["INTERNAL_API_SECRET"];
  if (!secret) return "unconfigured";
  const header = request.headers.authorization;
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return "unauthorized";
  if (!timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return "unauthorized";
  return "ok";
}

export const internalChatApprovalsRoutes: FastifyPluginAsync<InternalChatApprovalsOptions> = async (
  app,
  opts,
) => {
  // Same four-eyes posture as the public respond route and PlatformLifecycle.
  const selfApprovalAllowed = !!process.env["ALLOW_SELF_APPROVAL"];

  let bindingStore: OperatorChannelBindingStore | null = opts.bindingStore ?? null;
  if (!bindingStore && app.prisma) {
    const { PrismaOperatorChannelBindingStore } = await import("@switchboard/db");
    bindingStore = new PrismaOperatorChannelBindingStore(app.prisma);
  }

  app.post(
    "/respond",
    {
      schema: {
        description:
          "Internal chat-approval bridge: re-derives the operator principal from " +
          "OperatorChannelBinding and runs the unified respond engine. " +
          "Authenticated by INTERNAL_API_SECRET, not API keys.",
        tags: ["Internal"],
        // Public /docs is auth-excluded; an internal surface must not
        // advertise itself in the public OpenAPI document (spec 4.1).
        hide: true,
      },
      config: {
        rateLimit: {
          max: INTERNAL_RATE_LIMIT_MAX,
          timeWindow: INTERNAL_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const secretCheck = validateInternalSecret(request);
      if (secretCheck === "unconfigured") {
        request.log.error(
          "INTERNAL_API_SECRET is not configured; rejecting chat approval bridge request",
        );
        return reply.code(503).send({
          error: "Internal authentication not configured",
          code: "bridge_not_configured",
          statusCode: 503,
        });
      }
      if (secretCheck === "unauthorized") {
        return reply
          .code(401)
          .send({ error: "Unauthorized", code: "unauthorized", statusCode: 401 });
      }

      const parsed = InternalChatApprovalRespondBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
          statusCode: 400,
        });
      }
      const body = parsed.data;

      if (!bindingStore) {
        // No database: no OperatorChannelBinding rows can exist, so no
        // identity can ever be derived. Fail closed; never an in-memory
        // authority shortcut.
        return reply.code(503).send({
          error: "Approval bridge requires a database-backed binding store",
          code: "bridge_not_configured",
          statusCode: 503,
        });
      }

      const outcome = await respondToChannelApproval(
        {
          approvalStore: app.storageContext.approvals,
          bindingStore,
          identityStore: app.storageContext.identity,
          respondDeps: {
            approvalStore: app.storageContext.approvals,
            envelopeStore: app.storageContext.envelopes,
            workTraceStore: app.workTraceStore,
            lifecycleService: app.lifecycleService,
            platformLifecycle: app.platformLifecycle,
            sessionManager: app.sessionManager,
            auditLedger: app.auditLedger,
            logger: request.log,
            selfApprovalAllowed,
          },
        },
        {
          approvalId: body.approvalId,
          action: body.action,
          bindingHash: body.bindingHash,
          organizationId: body.organizationId,
          channel: body.channel,
          channelIdentifier: body.channelIdentifier,
        },
      );

      request.log.info(
        {
          approvalId: body.approvalId,
          action: body.action,
          organizationId: body.organizationId,
          channel: body.channel,
          outcome:
            outcome.kind === "refused"
              ? `refused:${outcome.code}`
              : `responded:${String(outcome.executionSuccess)}`,
        },
        "Chat approval bridge respond",
      );
      return reply.code(200).send(outcome);
    },
  );
};
