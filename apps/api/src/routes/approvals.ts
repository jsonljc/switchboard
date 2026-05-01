import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StaleVersionError, respondToApproval } from "@switchboard/core";
import { ApprovalRespondBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";

const respondJsonSchema = zodToJsonSchema(ApprovalRespondBodySchema, { target: "openApi3" });

// Per-route override for the global @fastify/rate-limit plugin. Approval responses must not be
// starved by high-frequency reads sharing the same global window. Distinct from the per-responder
// PlatformLifecycle.approvalRateLimit (anti-rubber-stamping cap on a single user's approve/patch
// actions) — that is wired from APPROVAL_RATE_LIMIT_MAX in app.ts.
const APPROVAL_HTTP_RATE_LIMIT_MAX = parseInt(
  process.env["APPROVAL_HTTP_RATE_LIMIT_MAX"] ?? "300",
  10,
);
const APPROVAL_HTTP_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env["APPROVAL_HTTP_RATE_LIMIT_WINDOW_MS"] ?? "60000",
  10,
);

export const approvalsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/approvals/:id/respond - Respond to an approval request
  app.post(
    "/:id/respond",
    {
      schema: {
        description: "Respond to a pending approval request (approve, reject, or patch).",
        tags: ["Approvals"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: respondJsonSchema,
      },
      config: {
        rateLimit: {
          max: APPROVAL_HTTP_RATE_LIMIT_MAX,
          timeWindow: APPROVAL_HTTP_RATE_LIMIT_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const parsed = ApprovalRespondBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 });
      }
      const body = parsed.data;

      try {
        // Org access check for the approval resource
        const approval = await app.storageContext.approvals.getById(id);
        if (!approval) {
          return reply.code(404).send({ error: "Approval not found", statusCode: 404 });
        }
        if (!assertOrgAccess(request, approval.organizationId, reply)) return;

        // Verify that respondedBy matches the authenticated principal when auth is configured.
        // This prevents approval spoofing where a user claims to be a different principal.
        const authenticatedPrincipal = request.principalIdFromAuth;
        if (authenticatedPrincipal && authenticatedPrincipal !== body.respondedBy) {
          return reply.code(403).send({
            error: `Forbidden: authenticated principal '${authenticatedPrincipal}' cannot respond as '${body.respondedBy}'`,
            statusCode: 403,
          });
        }

        // Require bindingHash for approve/patch to ensure integrity verification
        if ((body.action === "approve" || body.action === "patch") && !body.bindingHash) {
          return reply.code(400).send({
            error: "bindingHash is required for approve and patch actions",
            statusCode: 400,
          });
        }

        const result = await respondToApproval(
          {
            approvalStore: app.storageContext.approvals,
            envelopeStore: app.storageContext.envelopes,
            workTraceStore: app.workTraceStore,
            lifecycleService: app.lifecycleService,
            platformLifecycle: app.platformLifecycle,
            sessionManager: app.sessionManager,
            logger: app.log,
          },
          {
            approvalId: id,
            action: body.action,
            respondedBy: body.respondedBy,
            bindingHash: body.bindingHash ?? "",
            patchValue: body.patchValue,
          },
          approval,
        );

        return reply.code(200).send({
          envelope: result.envelope,
          approvalState: result.approvalState,
          executionResult: result.executionResult,
          ...(result.resumeWarning ? { resumeWarning: result.resumeWarning } : {}),
        });
      } catch (err) {
        if (err instanceof StaleVersionError) {
          return reply.code(409).send({
            error: "Conflict: approval has already been responded to",
            statusCode: 409,
          });
        }
        return reply.code(400).send({
          error: sanitizeErrorMessage(err, 400),
          statusCode: 400,
        });
      }
    },
  );

  // GET /api/approvals/pending - List pending approval requests
  app.get(
    "/pending",
    {
      schema: {
        description: "List all pending approval requests.",
        tags: ["Approvals"],
      },
    },
    async (request, reply) => {
      // Phase 2 gap: reads from legacy ApprovalStore; will migrate to lifecycleService.listPendingLifecycles()
      const pending = await app.storageContext.approvals.listPending(
        request.organizationIdFromAuth,
      );
      const now = new Date();
      const activePending = pending.filter((a) => a.state.expiresAt > now);
      return reply.code(200).send({
        approvals: activePending.map((a) => ({
          id: a.request.id,
          summary: a.request.summary,
          riskCategory: a.request.riskCategory,
          status: a.state.status,
          envelopeId: a.envelopeId,
          expiresAt: a.state.expiresAt,
          bindingHash: a.request.bindingHash,
          createdAt: a.request.createdAt,
        })),
      });
    },
  );

  // GET /api/approvals/:id - Get approval request details
  app.get(
    "/:id",
    {
      schema: {
        description: "Get approval request details by ID.",
        tags: ["Approvals"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const approval = await app.storageContext.approvals.getById(id);
      if (!approval) {
        return reply.code(404).send({ error: "Approval not found", statusCode: 404 });
      }

      if (!assertOrgAccess(request, approval.organizationId, reply)) return;

      return reply.code(200).send({
        request: approval.request,
        state: approval.state,
        envelopeId: approval.envelopeId,
      });
    },
  );
};

// Lifecycle-backed and legacy approval response are now in
// `@switchboard/core/approval/respond-to-approval` and shared with the chat gateway.
