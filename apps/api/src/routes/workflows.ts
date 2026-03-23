// ---------------------------------------------------------------------------
// Workflow Routes — CRUD operations for workflows, actions, and checkpoints
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { resolveCheckpoint } from "@switchboard/core";

export async function workflowRoutes(fastify: FastifyInstance): Promise<void> {
  const workflowDeps = fastify.workflowDeps;
  if (!workflowDeps) {
    fastify.log.warn("[workflow-routes] Workflow deps not available — skipping workflow routes");
    return;
  }

  const { workflowEngine, store } = workflowDeps;

  // GET /:id — get a single workflow
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const workflow = await workflowEngine.getWorkflow(request.params.id);
    if (!workflow) {
      return reply.status(404).send({ error: "Workflow not found" });
    }
    return reply.send(workflow);
  });

  // GET / — list workflows with optional filters
  fastify.get<{
    Querystring: { organizationId?: string; status?: string; limit?: string };
  }>("/", async (request, reply) => {
    const { organizationId, status, limit } = request.query;
    const workflows = await store.workflows.list({
      organizationId,
      status: status as never,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return reply.send(workflows);
  });

  // POST /:id/cancel — cancel a workflow
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (request, reply) => {
    try {
      await workflowEngine.cancelWorkflow(request.params.id);
      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // GET /actions/pending — list pending actions for an org
  fastify.get<{
    Querystring: { organizationId: string; limit?: string };
  }>("/actions/pending", async (request, reply) => {
    const { organizationId, limit } = request.query;
    if (!organizationId) {
      return reply.status(400).send({ error: "organizationId required" });
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
      return reply.status(400).send({ error: message });
    }
  });
}
