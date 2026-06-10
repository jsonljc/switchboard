// @route-class: lifecycle
// ---------------------------------------------------------------------------
// Workflow Routes — CRUD operations for workflows, actions, and checkpoints
// ---------------------------------------------------------------------------
//
// Tenant isolation (audit finding F1). Every route fails closed via
// `requireOrg` / `requireOrgForMutation` (403 when the request carries no org
// binding) and gates the targeted resource against the AUTHENTICATED org via
// `assertOrgAccess` — never an optional client-supplied `?organizationId=`. The
// list routes derive their scope from `request.orgId` (auth), so a caller can
// only ever enumerate its own org's workflows/actions. Mirrors the entity-by-id
// tenant guard in `approvals.ts` and `action-lifecycle.ts`.

import type { FastifyInstance } from "fastify";
import { resolveCheckpoint } from "@switchboard/core";
import { WorkflowStatusSchema } from "@switchboard/schemas";
import { requireOrg, requireOrgForMutation } from "../decorators/org.js";
import { assertOrgAccess } from "../utils/org-access.js";

export async function workflowRoutes(fastify: FastifyInstance): Promise<void> {
  const workflowDeps = fastify.workflowDeps;
  if (!workflowDeps) {
    fastify.log.warn("[workflow-routes] Workflow deps not available — skipping workflow routes");
    return;
  }

  const { workflowEngine, store } = workflowDeps;

  // GET /:id — get a single workflow
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireOrg },
    async (request, reply) => {
      const workflow = await workflowEngine.getWorkflow(request.params.id);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found", statusCode: 404 });
      }
      // Tenant isolation: the workflow must belong to the authenticated org.
      if (!assertOrgAccess(request, workflow.organizationId, reply)) return;
      return reply.send(workflow);
    },
  );

  // GET / — list workflows for the authenticated org
  fastify.get<{ Querystring: { status?: string; limit?: string } }>(
    "/",
    { preHandler: requireOrg },
    async (request, reply) => {
      const { status, limit } = request.query;

      // Validate status if provided
      let validatedStatus: string | undefined;
      if (status) {
        const parsed = WorkflowStatusSchema.safeParse(status);
        if (!parsed.success) {
          return reply.status(400).send({ error: `Invalid status: ${status}`, statusCode: 400 });
        }
        validatedStatus = parsed.data;
      }

      // Org scope comes from the authenticated request, never a query param.
      const workflows = await store.workflows.list({
        organizationId: request.orgId,
        status: validatedStatus as undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      return reply.send(workflows);
    },
  );

  // POST /:id/cancel — cancel a workflow
  fastify.post<{ Params: { id: string } }>(
    "/:id/cancel",
    { preHandler: requireOrgForMutation },
    async (request, reply) => {
      try {
        // Tenant isolation: the workflow must belong to the authenticated org
        // before we cancel it.
        const workflow = await workflowEngine.getWorkflow(request.params.id);
        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found", statusCode: 404 });
        }
        if (!assertOrgAccess(request, workflow.organizationId, reply)) return;

        await workflowEngine.cancelWorkflow(request.params.id);
        return reply.send({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message, statusCode: 400 });
      }
    },
  );

  // GET /actions/pending — list pending actions for the authenticated org
  fastify.get<{ Querystring: { limit?: string } }>(
    "/actions/pending",
    { preHandler: requireOrg },
    async (request, reply) => {
      const { limit } = request.query;
      // Org scope comes from the authenticated request, never a query param.
      const actions = await store.actions.listByStatus(
        request.orgId,
        "proposed",
        limit ? parseInt(limit, 10) : undefined,
      );
      return reply.send(actions);
    },
  );

  // POST /checkpoints/:id/resolve — resolve an approval checkpoint
  fastify.post<{
    Params: { id: string };
    Body: {
      decidedBy: string;
      action: "approve" | "reject" | "modify";
      fieldEdits?: Record<string, unknown>;
    };
  }>("/checkpoints/:id/resolve", { preHandler: requireOrgForMutation }, async (request, reply) => {
    try {
      const { decidedBy, action, fieldEdits } = request.body;

      // Resolve the tenant via the checkpoint's parent workflow. The checkpoint
      // carries no organizationId column; org is reached through the workflow
      // relation. We derive it here so the tenant-scoped update can filter on it.
      const checkpoint = await store.checkpoints.getById(request.params.id);
      if (!checkpoint) {
        return reply.status(404).send({ error: "Checkpoint not found", statusCode: 404 });
      }
      const workflow = await workflowEngine.getWorkflow(checkpoint.workflowId);
      if (!workflow) {
        return reply.status(404).send({ error: "Checkpoint not found", statusCode: 404 });
      }
      // Tenant isolation: the checkpoint's workflow must belong to the
      // authenticated org before we read, resolve, or resume it.
      if (!assertOrgAccess(request, workflow.organizationId, reply)) return;

      await resolveCheckpoint(store.checkpoints, workflow.organizationId, request.params.id, {
        decidedBy,
        action,
        fieldEdits,
      });

      // If approved or modified, resume the workflow
      if (action === "approve" || action === "modify") {
        await workflowEngine.resumeAfterApproval(checkpoint.workflowId, checkpoint.id);
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
