import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StaleVersionError } from "@switchboard/core";
import { ApprovalRespondBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";

const respondJsonSchema = zodToJsonSchema(ApprovalRespondBodySchema, { target: "openApi3" });

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

        // Phase 2 gap: respond still uses legacy PlatformLifecycle path.
        // Migration to ApprovalLifecycleService requires delegation chain + envelope integration.
        const response = await app.platformLifecycle.respondToApproval({
          approvalId: id,
          action: body.action,
          respondedBy: body.respondedBy,
          bindingHash: body.bindingHash ?? "",
          patchValue: body.patchValue,
        });

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

  // POST /api/approvals/:id/remind - Re-notify approvers
  app.post(
    "/:id/remind",
    {
      schema: {
        description: "Re-send approval notification to designated approvers.",
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

      if (approval.state.status !== "pending") {
        return reply.code(400).send({
          error: `Cannot remind: approval status is ${approval.state.status}`,
          statusCode: 400,
        });
      }

      // Re-notify via the orchestrator's notifier if available
      const envelope = await app.storageContext.envelopes.getById(approval.envelopeId);
      const trace = envelope?.decisions[0];

      if (trace) {
        const { buildApprovalNotification } = await import("@switchboard/core");
        const notification = buildApprovalNotification(approval.request, trace);

        // approvalNotifier is wired inside the orchestrator, not as a Fastify decorator.
        // Reminder notifications are best-effort — skip if not available.
        const notifier = (
          app as unknown as { approvalNotifier?: { notify(n: unknown): Promise<void> } }
        ).approvalNotifier;
        if (notifier) {
          await notifier.notify(notification);
        }
      }

      return reply.code(200).send({
        reminded: true,
        approvalId: id,
        approvers: approval.request.approvers,
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
