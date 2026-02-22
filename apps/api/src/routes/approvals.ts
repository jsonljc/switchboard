import type { FastifyPluginAsync } from "fastify";

export const approvalsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/approvals/:id/respond - Respond to an approval request
  app.post("/:id/respond", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      action: "approve" | "reject" | "patch";
      respondedBy: string;
      patchValue?: Record<string, unknown>;
      bindingHash?: string;
    };

    try {
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
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /api/approvals/pending - List pending approval requests
  app.get("/pending", async (_request, reply) => {
    const pending = await app.storageContext.approvals.listPending();
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

  // GET /api/approvals/:id - Get approval request details
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const approval = await app.storageContext.approvals.getById(id);
    if (!approval) {
      return reply.code(404).send({ error: "Approval not found" });
    }

    return reply.code(200).send({
      request: approval.request,
      state: approval.state,
      envelopeId: approval.envelopeId,
    });
  });
};
