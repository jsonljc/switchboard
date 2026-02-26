import type { FastifyPluginAsync } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StaleVersionError } from "@switchboard/core";
import { ApprovalRespondBodySchema } from "../validation.js";
import { sanitizeErrorMessage } from "../utils/error-sanitizer.js";
import { assertOrgAccess } from "../utils/org-access.js";

const respondJsonSchema = zodToJsonSchema(ApprovalRespondBodySchema, { target: "openApi3" });

export const approvalsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/approvals/:id/respond - Respond to an approval request
  app.post("/:id/respond", {
    schema: {
      description: "Respond to a pending approval request (approve, reject, or patch).",
      tags: ["Approvals"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: respondJsonSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsed = ApprovalRespondBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.issues });
    }
    const body = parsed.data;

    try {
      // Org access check for the approval resource
      const approval = await app.storageContext.approvals.getById(id);
      if (!approval) {
        return reply.code(404).send({ error: "Approval not found" });
      }
      if (!assertOrgAccess(request, approval.organizationId, reply)) return;

      // Verify that respondedBy matches the authenticated principal when auth is configured.
      // This prevents approval spoofing where a user claims to be a different principal.
      const authenticatedPrincipal = request.principalIdFromAuth;
      if (authenticatedPrincipal && authenticatedPrincipal !== body.respondedBy) {
        return reply.code(403).send({
          error: `Forbidden: authenticated principal '${authenticatedPrincipal}' cannot respond as '${body.respondedBy}'`,
        });
      }

      // Require bindingHash for approve/patch to ensure integrity verification
      if ((body.action === "approve" || body.action === "patch") && !body.bindingHash) {
        return reply.code(400).send({
          error: "bindingHash is required for approve and patch actions",
        });
      }

      const response = await app.orchestrator.respondToApproval({
        approvalId: id,
        action: body.action,
        respondedBy: body.respondedBy,
        bindingHash: body.bindingHash ?? "",
        patchValue: body.patchValue,
      });

      return reply.code(200).send({
        envelope: response.envelope,
        approvalState: response.approvalState,
        executionResult: response.executionResult,
      });
    } catch (err) {
      if (err instanceof StaleVersionError) {
        return reply.code(409).send({
          error: "Conflict: approval has already been responded to",
        });
      }
      return reply.code(400).send({
        error: sanitizeErrorMessage(err, 400),
      });
    }
  });

  // GET /api/approvals/pending - List pending approval requests
  app.get("/pending", {
    schema: {
      description: "List all pending approval requests.",
      tags: ["Approvals"],
    },
  }, async (request, reply) => {
    const pending = await app.storageContext.approvals.listPending(
      request.organizationIdFromAuth,
    );
    return reply.code(200).send({
      approvals: pending.map((a) => ({
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
  });

  // POST /api/approvals/:id/remind - Re-notify approvers
  app.post("/:id/remind", {
    schema: {
      description: "Re-send approval notification to designated approvers.",
      tags: ["Approvals"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const approval = await app.storageContext.approvals.getById(id);
    if (!approval) {
      return reply.code(404).send({ error: "Approval not found" });
    }

    if (!assertOrgAccess(request, approval.organizationId, reply)) return;

    if (approval.state.status !== "pending") {
      return reply.code(400).send({ error: `Cannot remind: approval status is ${approval.state.status}` });
    }

    // Re-notify via the orchestrator's notifier if available
    const envelope = await app.storageContext.envelopes.getById(approval.envelopeId);
    const trace = envelope?.decisions[0];

    if (trace) {
      const { buildApprovalNotification } = await import("@switchboard/core");
      const notification = buildApprovalNotification(approval.request, trace);

      // Use the orchestrator's notifier if configured
      const orch = app.orchestrator as unknown as Record<string, unknown>;
      if (orch["approvalNotifier"]) {
        const notifier = orch["approvalNotifier"] as { notify: (n: unknown) => Promise<void> };
        await notifier.notify(notification);
      }
    }

    return reply.code(200).send({
      reminded: true,
      approvalId: id,
      approvers: approval.request.approvers,
    });
  });

  // GET /api/approvals/:id - Get approval request details
  app.get("/:id", {
    schema: {
      description: "Get approval request details by ID.",
      tags: ["Approvals"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const approval = await app.storageContext.approvals.getById(id);
    if (!approval) {
      return reply.code(404).send({ error: "Approval not found" });
    }

    if (!assertOrgAccess(request, approval.organizationId, reply)) return;

    return reply.code(200).send({
      request: approval.request,
      state: approval.state,
      envelopeId: approval.envelopeId,
    });
  });
};
