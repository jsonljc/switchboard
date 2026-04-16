import type { FastifyPluginAsync } from "fastify";
import { PrismaKnowledgeEntryStore } from "@switchboard/db";
import {
  KnowledgeEntryCreateSchema,
  KnowledgeEntryUpdateSchema,
  KnowledgeKindSchema,
} from "@switchboard/schemas";
import { requireOrganizationScope } from "../utils/require-org.js";

export const knowledgeEntryRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/knowledge-entries
  app.get("/", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const query = request.query as { kind?: string; scope?: string };
    const store = new PrismaKnowledgeEntryStore(app.prisma);

    const kindParse = query.kind ? KnowledgeKindSchema.safeParse(query.kind) : undefined;
    if (query.kind && !kindParse?.success) {
      return reply.code(400).send({ error: "Invalid kind filter", statusCode: 400 });
    }

    const entries = await store.list(orgId, {
      kind: kindParse?.data,
      scope: query.scope,
    });

    return reply.send({ entries });
  });

  // GET /api/knowledge-entries/:id
  app.get("/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const entry = await app.prisma.knowledgeEntry.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!entry) {
      return reply.code(404).send({ error: "Not found", statusCode: 404 });
    }

    return reply.send({ entry });
  });

  // POST /api/knowledge-entries
  app.post("/", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const parsed = KnowledgeEntryCreateSchema.safeParse({
      ...(request.body as object),
      organizationId: orgId,
    });

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        statusCode: 400,
      });
    }

    const store = new PrismaKnowledgeEntryStore(app.prisma);
    const entry = await store.create(parsed.data);

    return reply.code(201).send({ entry });
  });

  // PATCH /api/knowledge-entries/:id
  app.patch("/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const parsed = KnowledgeEntryUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        statusCode: 400,
      });
    }

    const store = new PrismaKnowledgeEntryStore(app.prisma);
    try {
      const entry = await store.update(id, orgId, parsed.data);
      return reply.send({ entry });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message, statusCode: 404 });
    }
  });

  // DELETE /api/knowledge-entries/:id
  app.delete("/:id", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };
    const store = new PrismaKnowledgeEntryStore(app.prisma);

    try {
      await store.deactivate(id, orgId);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message, statusCode: 404 });
    }
  });
};
