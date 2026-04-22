// ---------------------------------------------------------------------------
// Workflow Routes — CRUD operations for workflows, actions, and checkpoints
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { resolveCheckpoint } from "@switchboard/core";
import { WorkflowStatusSchema } from "@switchboard/schemas";

export async function workflowRoutes(fastify: FastifyInstance): Promise<void> {
  const workflowDeps = fastify.workflowDeps;
  if (!workflowDeps) {
    fastify.log.warn("[workflow-routes] Workflow deps not available — skipping workflow routes");
    return;
  }

  const { workflowEngine, store } = workflowDeps;

  // GET /:id — get a single workflow
  fastify.get<{ Params: { id: string }; Querystring: { organizationId?: string } }>(
    "/:id",
    async (request, reply) => {
      const workflow = await workflowEngine.getWorkflow(request.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found", statusCode: 404 });
      }
      // Verify org scoping if provided
      if (
        request.query.organizationId &&
        workflow.organizationId !== request.query.organizationId
      ) {
        return reply.status(404).send({ error: "Workflow not found", statusCode: 404 });
      }
      return reply.send(workflow);
    },
  );

  // GET / — list workflows with optional filters
  fastify.get<{
    Querystring: { organizationId?: string; status?: string; limit?: string };
  }>("/", async (request, reply) => {
    const { organizationId, status, limit } = request.query;
    if (!organizationId) {
      return reply.status(400).send({ error: "organizationId required", statusCode: 400 });
    }

    // Validate status if provided
    let validatedStatus: string | undefined;
    if (status) {
      const parsed = WorkflowStatusSchema.safeParse(status);
      if (!parsed.success) {
        return reply.status(400).send({ error: `Invalid status: ${status}`, statusCode: 400 });
      }
      validatedStatus = parsed.data;
    }

    const workflows = await store.workflows.list({
      organizationId,
      status: validatedStatus as undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return reply.send(workflows);
  });

  // POST /:id/cancel — cancel a workflow
  fastify.post<{ Params: { id: string }; Querystring: { organizationId?: string } }>(
    "/:id/cancel",
    async (request, reply) => {
      try {
        // Verify the workflow belongs to the caller's org
        if (request.query.organizationId) {
          const workflow = await workflowEngine.getWorkflow(request.params.id);
          if (!workflow || workflow.organizationId !== request.query.organizationId) {
            return reply.status(404).send({ error: "Workflow not found", statusCode: 404 });
          }
        }
        await workflowEngine.cancelWorkflow(request.params.id);
        return reply.send({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message, statusCode: 400 });
      }
    },
  );

  // GET /actions/pending — list pending actions for an org
  fastify.get<{
    Querystring: { organizationId: string; limit?: string };
  }>("/actions/pending", async (request, reply) => {
    const { organizationId, limit } = request.query;
    if (!organizationId) {
      return reply.status(400).send({ error: "organizationId required", statusCode: 400 });
    }
    const actions = await store.actions.listByStatus(
      organizationId,
      "proposed",
      limit ? parseInt(limit, 10) : undefined,
    );
    return reply.send(actions);
  });

  // POST /checkpoints/:id/resolve — resolve an approval checkpoint
  fastify.post<{
    Params: { id: string };
    Body: {
      decidedBy: string;
      action: "approve" | "reject" | "modify";
      fieldEdits?: Record<string, unknown>;
    };
  }>("/checkpoints/:id/resolve", async (request, reply) => {
    try {
      const { decidedBy, action, fieldEdits } = request.body;
      await resolveCheckpoint(store.checkpoints, request.params.id, {
        decidedBy,
        action,
        fieldEdits,
      });

      // If approved or modified, resume the workflow
      if (action === "approve" || action === "modify") {
        const checkpoint = await store.checkpoints.getById(request.params.id);
        if (checkpoint) {
          await workflowEngine.resumeAfterApproval(checkpoint.workflowId, checkpoint.id);
        }
      }

      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message, statusCode: 404 });
      }
      return reply.status(400).send({ error: message, statusCode: 400 });
    }
  });
}
