// @route-class: lifecycle
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  StaleVersionError,
  DispatchAdmissionError,
  respondToApproval,
  respondToParkedLifecycle,
  ParkedLifecycleNotFoundError,
  ParkedLifecycleAlreadyRespondedError,
  ParkedLifecycleExpiredError,
} from "@switchboard/core";
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

/**
 * Lifecycle-native respond leg: the :id is an ApprovalLifecycle id (exactly
 * what routes/actions.ts returns as approvalRequest.id when lifecycleService
 * is wired). No legacy ApprovalRequest row exists for these units. The
 * transition + dispatch logic lives in core respondToParkedLifecycle; this
 * helper only does surface work (org access, structured error mapping).
 */
async function respondViaParkedLifecycle(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    lifecycleId: string;
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash?: string;
    note?: string;
    selfApprovalAllowed: boolean;
  },
) {
  if (!app.lifecycleService || !app.workTraceStore) {
    return reply
      .code(404)
      .send({ error: "Approval not found", code: "not_found", statusCode: 404 });
  }
  // Lookup failures (e.g. DB outage) keep the structured error contract: a
  // 503 with a code, never a code-less 400 from the legacy catch upstream.
  let lifecycle;
  try {
    lifecycle = await app.lifecycleService.getLifecycleById(input.lifecycleId);
  } catch (err) {
    app.log.error(
      { err, lifecycleId: input.lifecycleId },
      "Parked lifecycle lookup failed during respond",
    );
    return reply.code(503).send({
      error: "Approval lookup failed; try again shortly",
      code: "lookup_failed",
      statusCode: 503,
    });
  }
  if (!lifecycle) {
    return reply
      .code(404)
      .send({ error: "Approval not found", code: "not_found", statusCode: 404 });
  }
  if (!assertOrgAccess(request, lifecycle.organizationId, reply)) return;
  if (input.action === "patch") {
    return reply.code(400).send({
      error: "patch is not supported for lifecycle-native approvals",
      code: "patch_unsupported",
      statusCode: 400,
    });
  }
  if (input.action === "approve" && !input.bindingHash) {
    return reply.code(400).send({
      error: "bindingHash is required for approve actions",
      code: "binding_hash_required",
      statusCode: 400,
    });
  }
  try {
    const result = await respondToParkedLifecycle(
      {
        lifecycleService: app.lifecycleService,
        workTraceStore: app.workTraceStore,
        platformLifecycle: app.platformLifecycle,
        auditLedger: app.auditLedger,
        logger: app.log,
        selfApprovalAllowed: input.selfApprovalAllowed,
      },
      {
        lifecycleId: input.lifecycleId,
        action: input.action,
        respondedBy: input.respondedBy,
        bindingHash: input.bindingHash,
        note: input.note,
      },
    );
    return reply.code(200).send({
      envelope: null,
      approvalState: result.approvalState,
      executionResult: result.executionResult,
    });
  } catch (err) {
    if (err instanceof ParkedLifecycleNotFoundError) {
      return reply
        .code(404)
        .send({ error: "Approval not found", code: "not_found", statusCode: 404 });
    }
    if (err instanceof ParkedLifecycleAlreadyRespondedError) {
      return reply.code(409).send({
        error: sanitizeErrorMessage(err, 409),
        code: "already_responded",
        statusCode: 409,
      });
    }
    if (err instanceof ParkedLifecycleExpiredError) {
      return reply
        .code(409)
        .send({ error: sanitizeErrorMessage(err, 409), code: "expired", statusCode: 409 });
    }
    if (err instanceof StaleVersionError) {
      return reply.code(409).send({
        error: "Conflict: approval is being responded to concurrently",
        code: "conflict",
        statusCode: 409,
      });
    }
    if (err instanceof DispatchAdmissionError) {
      return reply.code(409).send({
        error: sanitizeErrorMessage(err, 409),
        code: "admission_failed",
        statusCode: 409,
      });
    }
    const message = err instanceof Error ? err.message : "Approval response failed";
    const code = /stale binding/i.test(message)
      ? "stale_binding"
      : /self-approval/i.test(message)
        ? "self_approval"
        : "respond_failed";
    return reply.code(400).send({ error: sanitizeErrorMessage(err, 400), code, statusCode: 400 });
  }
}

export const approvalsRoutes: FastifyPluginAsync = async (app) => {
  // Self-approval is prevented on the lifecycle approval path unless explicitly
  // allowed (e.g. solo-operator deployments) via ALLOW_SELF_APPROVAL — the same
  // env that gates PlatformLifecycle.selfApprovalAllowed in app.ts, so both
  // response paths share one four-eyes posture.
  const selfApprovalAllowed = !!process.env["ALLOW_SELF_APPROVAL"];

  // POST /api/approvals/:id/respond - Respond to an approval request
  app.post(
    "/:id/respond",
    {
      schema: {
        description:
          "Respond to a pending approval request (approve, reject, or patch). " +
          "The id is either a legacy approval id or an ApprovalLifecycle id " +
          "(the value propose returns as approvalRequest.id).",
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

      // Identity: respondedBy is SERVER-derived. When an authenticated
      // principal exists it IS the responder; a differing body value is a 403
      // (never silently reassigned). The body fallback is honored only when
      // auth is disabled (dev/test). Never respond as an unbound principal.
      const authPrincipal = request.principalIdFromAuth;
      let respondedBy: string;
      if (authPrincipal) {
        if (body.respondedBy && body.respondedBy !== authPrincipal) {
          return reply.code(403).send({
            error: `Forbidden: authenticated principal '${authPrincipal}' cannot respond as '${body.respondedBy}'`,
            code: "principal_mismatch",
            statusCode: 403,
          });
        }
        respondedBy = authPrincipal;
      } else if (app.authDisabled === true) {
        respondedBy = body.respondedBy ?? "default";
      } else {
        return reply.code(403).send({
          error: "Forbidden: authenticated request has no principal binding",
          code: "no_principal",
          statusCode: 403,
        });
      }

      try {
        // Org access check for the approval resource
        const approval = await app.storageContext.approvals.getById(id);
        if (!approval) {
          // Lifecycle-native fallback: parked WorkUnits have no ApprovalRequest
          // row; the id propose handed out is the lifecycle id.
          return respondViaParkedLifecycle(app, request, reply, {
            lifecycleId: id,
            action: body.action,
            respondedBy,
            bindingHash: body.bindingHash,
            note: body.note,
            selfApprovalAllowed,
          });
        }
        if (!assertOrgAccess(request, approval.organizationId, reply)) return;

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
            auditLedger: app.auditLedger,
            logger: app.log,
            selfApprovalAllowed,
          },
          {
            approvalId: id,
            action: body.action,
            respondedBy,
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
  //
  // DEPRECATED (2026-06-04): reads the legacy in-memory ApprovalStore, which is
  // EMPTY for lifecycle-parked units (the production shape). The operator
  // surface for parked approvals is the decisions feed
  // (GET /api/dashboard/decisions). Kept for the dev-no-DB legacy path until
  // migrated to lifecycleService.listPendingLifecycles() or retired.
  app.get(
    "/pending",
    {
      schema: {
        description:
          "DEPRECATED: superseded by the decisions feed (GET /api/dashboard/decisions). " +
          "List all pending approval requests from the legacy in-memory store.",
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
          // A.7c additions — optional payload fields forward when present.
          // Older approvals (pre-A.7c) lack payload.kind; the dashboard's rich
          // adapter falls through to legacyPendingApprovalToApprovalView.
          // Each field is included only when truthy so absent fields stay out
          // of the JSON response (avoiding noisy `null`s).
          ...(a.request.payload?.kind ? { kind: a.request.payload.kind } : {}),
          ...(a.request.payload?.body ? { body: a.request.payload.body } : {}),
          ...(a.request.payload?.quote ? { quote: a.request.payload.quote } : {}),
          ...(a.request.payload?.quoteFrom ? { quoteFrom: a.request.payload.quoteFrom } : {}),
        })),
      });
    },
  );
};

// Lifecycle-backed and legacy approval response are now in
// `@switchboard/core/approval/respond-to-approval` and shared with the chat gateway.
