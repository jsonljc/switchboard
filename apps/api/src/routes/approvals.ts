import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  StaleVersionError,
  transitionApproval,
  computeBindingHash,
  hashObject,
} from "@switchboard/core";
import type { ApprovalLifecycleService, LifecycleRecord, ApprovalState } from "@switchboard/core";
import type { ApprovalRequest } from "@switchboard/schemas";
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

        // Detect lifecycle-backed approvals and route through ApprovalLifecycleService.
        // Fallback to legacy PlatformLifecycle for approvals without a lifecycle record.
        const lifecycleService = app.lifecycleService;
        let lifecycle: import("@switchboard/core").LifecycleRecord | null = null;
        if (lifecycleService) {
          lifecycle = await lifecycleService.findByEnvelopeId(approval.envelopeId);
        }

        let response: {
          envelope: unknown;
          approvalState: unknown;
          executionResult: unknown;
        };

        if (lifecycle && lifecycleService) {
          // --- Lifecycle path ---
          response = await respondViaLifecycle({
            lifecycleService,
            lifecycle,
            approval,
            body,
            app,
          });
        } else {
          // --- Legacy path ---
          const legacyResponse = await app.platformLifecycle.respondToApproval({
            approvalId: id,
            action: body.action,
            respondedBy: body.respondedBy,
            bindingHash: body.bindingHash ?? "",
            patchValue: body.patchValue,
          });
          response = {
            envelope: legacyResponse.envelope,
            approvalState: legacyResponse.approvalState,
            executionResult: legacyResponse.executionResult,
          };
        }

        // Session resume hook: check if this approval is linked to a paused agent session.
        // All state transitions are encapsulated in SessionManager.resumeAfterApproval().
        // Rule: No route directly mutates session stores.
        let resumeWarning: string | undefined;
        if (app.sessionManager && body.action === "approve") {
          try {
            const result = await app.sessionManager.resumeAfterApproval(id, {
              approvalId: id,
              action: body.action,
              patchValue: body.patchValue,
              respondedBy: body.respondedBy,
              resolvedAt: new Date().toISOString(),
            });

            // Gateway invocation removed — WorkflowEngine will handle resume dispatch in Phase 3.
            if (result) {
              app.log.info(
                { sessionId: result.session.id, runId: result.run.id },
                "Session resumed after approval (workflow dispatch pending Phase 3)",
              );
            }
          } catch (err) {
            // Log but don't fail the approval response — resume is best-effort.
            // Return warning so caller knows the resume did not proceed.
            app.log.error({ err, approvalId: id }, "Failed to enqueue session resume");
            resumeWarning = err instanceof Error ? err.message : "Failed to enqueue session resume";
          }
        }

        return reply.code(200).send({
          envelope: response.envelope,
          approvalState: response.approvalState,
          executionResult: response.executionResult,
          ...(resumeWarning ? { resumeWarning } : {}),
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

// ---------------------------------------------------------------------------
// Lifecycle-backed approval handler
// ---------------------------------------------------------------------------

async function respondViaLifecycle(params: {
  lifecycleService: ApprovalLifecycleService;
  lifecycle: LifecycleRecord;
  approval: {
    request: ApprovalRequest;
    state: ApprovalState;
    envelopeId: string;
    organizationId?: string | null;
  };
  body: {
    action: "approve" | "reject" | "patch";
    respondedBy: string;
    bindingHash?: string;
    patchValue?: Record<string, unknown>;
  };
  app: FastifyInstance;
}): Promise<{ envelope: unknown; approvalState: unknown; executionResult: unknown }> {
  const { lifecycleService, lifecycle, approval, body, app } = params;

  // Update legacy approval state for backwards compatibility
  const newState = transitionApproval(
    approval.state,
    body.action,
    body.respondedBy,
    body.patchValue,
  );
  await app.storageContext.approvals.updateState(
    approval.request.id,
    newState,
    approval.state.version,
  );

  if (body.action === "reject") {
    if (!app.workTraceStore) {
      throw new Error("WorkTraceStore not available for lifecycle rejection");
    }
    await lifecycleService.rejectLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: body.respondedBy,
      traceStore: app.workTraceStore,
    });

    const envelope = await app.storageContext.envelopes.getById(approval.envelopeId);
    if (envelope) {
      await app.storageContext.envelopes.update(envelope.id, { status: "denied" });
    }

    return {
      envelope: envelope ?? null,
      approvalState: newState,
      executionResult: null,
    };
  }

  if (body.action === "patch") {
    if (!body.patchValue) {
      throw new Error("patchValue is required for patch action");
    }

    // Merge patched parameters into existing parameters
    const trace = await getWorkTrace(app, approval.envelopeId);
    const patchedParams = { ...(trace?.parameters ?? {}), ...body.patchValue };

    // Compute new binding hash for the patched revision
    const newBindingHash = computeBindingHash({
      envelopeId: approval.envelopeId,
      envelopeVersion: (approval.state.version ?? 0) + 1,
      actionId: approval.request.actionId,
      parameters: patchedParams,
      decisionTraceHash: hashObject({ governance: "patched" }),
      contextSnapshotHash: hashObject({ actor: body.respondedBy }),
    });

    const revision = await lifecycleService.createRevision({
      lifecycleId: lifecycle.id,
      parametersSnapshot: patchedParams,
      approvalScopeSnapshot: {},
      bindingHash: newBindingHash,
      createdBy: body.respondedBy,
      sourceBindingHash: body.bindingHash ?? "",
      rationale: "Patched via approval respond",
    });

    return {
      envelope: null,
      approvalState: { ...newState, bindingHash: revision.bindingHash },
      executionResult: null,
    };
  }

  // --- approve ---
  const trace = await getWorkTrace(app, approval.envelopeId);
  const workUnit = reconstructWorkUnit(trace, approval);

  const { lifecycle: updatedLifecycle, executableWorkUnit } =
    await lifecycleService.approveLifecycle({
      lifecycleId: lifecycle.id,
      respondedBy: body.respondedBy,
      clientBindingHash: body.bindingHash ?? "",
      workUnit,
      actionEnvelopeId: approval.envelopeId,
      constraints: (trace?.governanceConstraints as unknown as Record<string, unknown>) ?? {},
    });

  // Update envelope status
  const envelope = await app.storageContext.envelopes.getById(approval.envelopeId);
  if (envelope) {
    await app.storageContext.envelopes.update(envelope.id, { status: "approved" });
  }

  app.log.info(
    { lifecycleId: updatedLifecycle.id, executableWorkUnitId: executableWorkUnit.id },
    "Approval responded via lifecycle service",
  );

  return {
    envelope: envelope ?? null,
    approvalState: newState,
    executionResult: { executableWorkUnitId: executableWorkUnit.id },
  };
}

async function getWorkTrace(app: FastifyInstance, workUnitId: string) {
  if (!app.workTraceStore) return null;
  const result = await app.workTraceStore.getByWorkUnitId(workUnitId);
  return result?.trace ?? null;
}

function reconstructWorkUnit(
  trace: import("@switchboard/core/platform").WorkTrace | null,
  approval: {
    request: ApprovalRequest;
    envelopeId: string;
    organizationId?: string | null;
  },
): import("@switchboard/core/platform").WorkUnit {
  const fallbackDeployment: import("@switchboard/core/platform").DeploymentContext = {
    deploymentId: "",
    skillSlug: "",
    trustLevel: "supervised",
    trustScore: 0,
  };

  if (!trace) {
    // Minimal work unit from approval data when trace is unavailable
    return {
      id: approval.envelopeId,
      requestedAt: approval.request.createdAt.toISOString(),
      organizationId: approval.organizationId ?? "",
      actor: { id: "system", type: "system" },
      intent: approval.request.actionId,
      parameters: {},
      deployment: fallbackDeployment,
      resolvedMode: "cartridge",
      traceId: approval.envelopeId,
      trigger: "api",
      priority: "normal",
    };
  }

  return {
    id: trace.workUnitId,
    requestedAt: trace.requestedAt,
    organizationId: trace.organizationId,
    actor: trace.actor,
    intent: trace.intent,
    parameters: trace.parameters ?? {},
    deployment: trace.deploymentContext ?? fallbackDeployment,
    resolvedMode: trace.mode,
    idempotencyKey: trace.idempotencyKey,
    parentWorkUnitId: trace.parentWorkUnitId,
    traceId: trace.traceId,
    trigger: trace.trigger,
    priority: "normal",
  };
}
