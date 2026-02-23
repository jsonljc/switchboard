import type { FastifyPluginAsync } from "fastify";
import type { AuditQueryFilter } from "@switchboard/core";

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/audit - Query audit ledger
  app.get("/", {
    schema: {
      description: "Query audit ledger entries with optional filters.",
      tags: ["Audit"],
      querystring: {
        type: "object",
        properties: {
          eventType: { type: "string" },
          entityType: { type: "string" },
          entityId: { type: "string" },
          envelopeId: { type: "string" },
          after: { type: "string", format: "date-time" },
          before: { type: "string", format: "date-time" },
          limit: { type: "integer" },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as {
      eventType?: string;
      entityType?: string;
      entityId?: string;
      envelopeId?: string;
      after?: string;
      before?: string;
      limit?: string;
    };

    const filter: AuditQueryFilter = {};
    if (query.eventType) filter.eventType = query.eventType as AuditQueryFilter["eventType"];
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.envelopeId) filter.envelopeId = query.envelopeId;
    if (query.after) filter.after = new Date(query.after);
    if (query.before) filter.before = new Date(query.before);
    if (query.limit) filter.limit = parseInt(query.limit, 10);

    const entries = await app.auditLedger.query(filter);
    return reply.code(200).send({
      entries,
      total: entries.length,
      filter: query,
    });
  });

  // GET /api/audit/verify - Verify hash chain integrity (shallow: chain links only)
  app.get("/verify", {
    schema: {
      description: "Verify the integrity of the audit hash chain.",
      tags: ["Audit"],
      querystring: {
        type: "object",
        properties: {
          deep: { type: "string", enum: ["true", "false"] },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { deep?: string };
    const allEntries = await app.auditLedger.query({});

    if (query.deep === "true") {
      const result = await app.auditLedger.deepVerify(allEntries);
      return reply.code(200).send({
        mode: "deep",
        valid: result.valid,
        entriesChecked: result.entriesChecked,
        chainValid: result.chainValid,
        chainBrokenAt: result.chainBrokenAt,
        hashMismatches: result.hashMismatches,
      });
    }

    const result = await app.auditLedger.verifyChain(allEntries);
    return reply.code(200).send({
      mode: "shallow",
      valid: result.valid,
      entriesChecked: allEntries.length,
      brokenAt: result.brokenAt,
    });
  });

  // GET /api/audit/:id - Get single audit entry (must be after /verify to avoid route conflict)
  app.get("/:id", {
    schema: {
      description: "Get a single audit entry by ID.",
      tags: ["Audit"],
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await app.auditLedger.getById(id);
    if (!entry) {
      return reply.code(404).send({ error: "Audit entry not found" });
    }
    return reply.code(200).send({ entry });
  });
};
