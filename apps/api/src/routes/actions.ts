import type { FastifyPluginAsync } from "fastify";

export const actionsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/actions/propose - Create a new action proposal via envelope
  app.post("/propose", async (request, reply) => {
    const body = request.body as {
      actionType: string;
      parameters: Record<string, unknown>;
      principalId: string;
      organizationId?: string;
      cartridgeId?: string;
      message?: string;
    };

    const envelope = {
      id: `env_${Date.now()}`,
      version: 0,
      incomingMessage: null,
      conversationId: null,
      proposals: [
        {
          id: `prop_${Date.now()}`,
          actionType: body.actionType,
          parameters: body.parameters,
          evidence: body.message ?? "API-initiated action",
          confidence: 1.0,
          originatingMessageId: "",
        },
      ],
      resolvedEntities: [],
      plan: null,
      decisions: [],
      approvalRequests: [],
      executionResults: [],
      auditEntryIds: [],
      status: "proposed" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      parentEnvelopeId: null,
    };

    return reply.code(201).send({ envelope });
  });

  // GET /api/actions/:id - Get action/envelope by ID
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // In production, would look up from database
    return reply.code(200).send({ id, status: "not_found" });
  });

  // POST /api/actions/:id/undo - Request undo for an executed action
  app.post("/:id/undo", async (request, reply) => {
    const { id } = request.params as { id: string };

    const undoEnvelope = {
      id: `env_undo_${Date.now()}`,
      version: 0,
      incomingMessage: null,
      conversationId: null,
      proposals: [
        {
          id: `prop_undo_${Date.now()}`,
          actionType: "system.undo",
          parameters: { originalActionId: id },
          evidence: "User-initiated undo",
          confidence: 1.0,
          originatingMessageId: "",
        },
      ],
      resolvedEntities: [],
      plan: null,
      decisions: [],
      approvalRequests: [],
      executionResults: [],
      auditEntryIds: [],
      status: "proposed" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      parentEnvelopeId: id,
    };

    return reply.code(201).send({ envelope: undoEnvelope });
  });

  // POST /api/actions/batch - Create a batch of actions with a plan
  app.post("/batch", async (request, reply) => {
    const body = request.body as {
      proposals: Array<{
        actionType: string;
        parameters: Record<string, unknown>;
      }>;
      strategy: "atomic" | "best_effort" | "sequential";
      approvalMode: "per_action" | "single_approval";
      principalId: string;
    };

    const envelopeId = `env_${Date.now()}`;
    const proposals = body.proposals.map((p, i) => ({
      id: `prop_${Date.now()}_${i}`,
      actionType: p.actionType,
      parameters: p.parameters,
      evidence: "Batch action",
      confidence: 1.0,
      originatingMessageId: "",
    }));

    const envelope = {
      id: envelopeId,
      version: 0,
      incomingMessage: null,
      conversationId: null,
      proposals,
      resolvedEntities: [],
      plan: {
        id: `plan_${Date.now()}`,
        envelopeId,
        strategy: body.strategy,
        approvalMode: body.approvalMode,
        summary: null,
        proposalOrder: proposals.map((p) => p.id),
      },
      decisions: [],
      approvalRequests: [],
      executionResults: [],
      auditEntryIds: [],
      status: "proposed" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      parentEnvelopeId: null,
    };

    return reply.code(201).send({ envelope });
  });
};
