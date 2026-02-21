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

    // In production:
    // 1. Look up the approval request
    // 2. Verify binding hash matches current state
    // 3. Check if respondent is authorized
    // 4. Transition approval state
    // 5. If approved, queue action for execution
    // 6. Audit the response

    return reply.code(200).send({
      approvalId: id,
      status: body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "patched",
      respondedBy: body.respondedBy,
      respondedAt: new Date().toISOString(),
      patchValue: body.patchValue ?? null,
    });
  });

  // GET /api/approvals/pending - List pending approval requests
  app.get("/pending", async (_request, reply) => {
    // In production, would query database for pending approvals
    return reply.code(200).send({ approvals: [] });
  });

  // GET /api/approvals/:id - Get approval request details
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(200).send({ id, status: "not_found" });
  });
};
