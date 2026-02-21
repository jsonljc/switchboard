import type { FastifyPluginAsync } from "fastify";

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/audit - Query audit ledger
  app.get("/", async (request, reply) => {
    const query = request.query as {
      eventType?: string;
      entityType?: string;
      entityId?: string;
      envelopeId?: string;
      after?: string;
      before?: string;
      limit?: string;
    };

    // In production, would query the audit ledger
    return reply.code(200).send({
      entries: [],
      total: 0,
      filter: query,
    });
  });

  // GET /api/audit/:id - Get single audit entry
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.code(200).send({ id, status: "not_found" });
  });

  // GET /api/audit/verify - Verify hash chain integrity
  app.get("/verify", async (_request, reply) => {
    // In production, would verify the hash chain
    return reply.code(200).send({
      valid: true,
      entriesChecked: 0,
      brokenAt: null,
    });
  });
};
