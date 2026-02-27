import type { FastifyPluginAsync } from "fastify";
import type { AuditQueryFilter } from "@switchboard/core";
import { assertOrgAccess } from "../utils/org-access.js";
import { requireRole } from "../utils/require-role.js";

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
    if (query.limit) filter.limit = Math.min(parseInt(query.limit, 10), 1000);
    // Scope audit queries to the authenticated org when available
    if (request.organizationIdFromAuth) filter.organizationId = request.organizationIdFromAuth;

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
      description: "Verify the integrity of the audit hash chain. Processes entries in chunks to avoid OOM.",
      tags: ["Audit"],
      querystring: {
        type: "object",
        properties: {
          deep: { type: "string", enum: ["true", "false"] },
          limit: { type: "integer", minimum: 1, maximum: 100000 },
        },
      },
    },
  }, async (request, reply) => {
    if (!(await requireRole(request, reply, "admin", "operator"))) return;

    const query = request.query as { deep?: string; limit?: string };
    const maxEntries = Math.min(
      parseInt(query.limit ?? "10000", 10) || 10000,
      100000,
    );
    const chunkSize = 1000;

    // Scope to authenticated org when available
    const baseFilter: AuditQueryFilter = {};
    if (request.organizationIdFromAuth) {
      baseFilter.organizationId = request.organizationIdFromAuth;
    }

    let totalChecked = 0;
    let previousLastHash: string | null = null;
    let brokenAt: number | null = null;
    const hashMismatches: Array<{ index: number; entryId: string; expected: string; actual: string }> = [];
    const isDeep = query.deep === "true";

    while (totalChecked < maxEntries) {
      const take = Math.min(chunkSize, maxEntries - totalChecked);
      const chunk = await app.auditLedger.query({
        ...baseFilter,
        limit: take,
        offset: totalChecked,
      });

      if (chunk.length === 0) break;

      if (isDeep) {
        const result = await app.auditLedger.deepVerify(chunk);

        // Adjust indices to account for offset
        for (const m of result.hashMismatches) {
          hashMismatches.push({
            ...m,
            index: m.index + totalChecked,
          });
        }

        // Check chain link between chunks
        if (previousLastHash !== null && chunk.length > 0) {
          const firstInChunk = chunk[0]!;
          if (firstInChunk.previousEntryHash !== previousLastHash && brokenAt === null) {
            brokenAt = totalChecked;
          }
        }

        if (result.chainBrokenAt !== null && brokenAt === null) {
          brokenAt = result.chainBrokenAt + totalChecked;
        }
      } else {
        // Shallow: just check chain links
        const result = await app.auditLedger.verifyChain(chunk);

        // Check chain link between chunks
        if (previousLastHash !== null && chunk.length > 0) {
          const firstInChunk = chunk[0]!;
          if (firstInChunk.previousEntryHash !== previousLastHash && brokenAt === null) {
            brokenAt = totalChecked;
          }
        }

        if (result.brokenAt !== null && brokenAt === null) {
          brokenAt = result.brokenAt + totalChecked;
        }
      }

      previousLastHash = chunk[chunk.length - 1]!.entryHash;
      totalChecked += chunk.length;

      if (chunk.length < take) break; // No more entries
    }

    if (isDeep) {
      return reply.code(200).send({
        mode: "deep",
        valid: hashMismatches.length === 0 && brokenAt === null,
        entriesChecked: totalChecked,
        chainValid: brokenAt === null,
        chainBrokenAt: brokenAt,
        hashMismatches,
      });
    }

    return reply.code(200).send({
      mode: "shallow",
      valid: brokenAt === null,
      entriesChecked: totalChecked,
      brokenAt,
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
    if (!assertOrgAccess(request, entry.organizationId, reply)) return;
    return reply.code(200).send({ entry });
  });
};
