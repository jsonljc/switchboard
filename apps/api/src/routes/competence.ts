import type { FastifyPluginAsync } from "fastify";
import { paginationParams, paginate } from "@switchboard/core";

export const competenceRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/competence/records
  app.get(
    "/records",
    {
      schema: { description: "List competence records.", tags: ["Competence"] },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const { limit, offset } = paginationParams(query);
      const principalId = query["principalId"];

      if (principalId) {
        const records = await app.storageContext.competence.listRecords(principalId);
        const sliced = records.slice(offset, offset + limit);
        return reply.code(200).send(paginate(sliced, records.length, { limit, offset }));
      }

      // Without principalId, return empty (listRecords requires it)
      return reply.code(200).send(paginate([], 0, { limit, offset }));
    },
  );

  // GET /api/competence/records/:principalId/:actionType
  app.get(
    "/records/:principalId/:actionType",
    {
      schema: { description: "Get a specific competence record.", tags: ["Competence"] },
    },
    async (request, reply) => {
      const { principalId, actionType } = request.params as {
        principalId: string;
        actionType: string;
      };

      const record = await app.storageContext.competence.getRecord(principalId, actionType);
      if (!record) {
        return reply.code(404).send({ error: "Competence record not found" });
      }
      return reply.code(200).send({ record });
    },
  );

  // GET /api/competence/policies
  app.get(
    "/policies",
    {
      schema: { description: "List competence policies.", tags: ["Competence"] },
    },
    async (_request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const policies = await app.prisma.competencePolicy.findMany({
        orderBy: { createdAt: "desc" },
      });

      return reply.code(200).send({ policies });
    },
  );

  // POST /api/competence/policies
  app.post(
    "/policies",
    {
      schema: { description: "Create a competence policy.", tags: ["Competence"] },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const body = request.body as {
        name: string;
        description?: string;
        actionTypePattern?: string;
        thresholds: Record<string, unknown>;
        enabled?: boolean;
      };

      const policy = await app.prisma.competencePolicy.create({
        data: {
          name: body.name,
          description: body.description ?? "",
          actionTypePattern: body.actionTypePattern ?? null,
          thresholds: body.thresholds as object,
          enabled: body.enabled ?? true,
        },
      });

      return reply.code(201).send({ policy });
    },
  );

  // PUT /api/competence/policies/:id
  app.put(
    "/policies/:id",
    {
      schema: { description: "Update a competence policy.", tags: ["Competence"] },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      const updateData: Record<string, unknown> = {};
      if (body["name"] !== undefined) updateData["name"] = body["name"];
      if (body["description"] !== undefined) updateData["description"] = body["description"];
      if (body["actionTypePattern"] !== undefined)
        updateData["actionTypePattern"] = body["actionTypePattern"];
      if (body["thresholds"] !== undefined) updateData["thresholds"] = body["thresholds"];
      if (body["enabled"] !== undefined) updateData["enabled"] = body["enabled"];

      const policy = await app.prisma.competencePolicy.update({
        where: { id },
        data: updateData,
      });

      return reply.code(200).send({ policy });
    },
  );

  // DELETE /api/competence/policies/:id
  app.delete(
    "/policies/:id",
    {
      schema: { description: "Delete a competence policy.", tags: ["Competence"] },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const { id } = request.params as { id: string };
      await app.prisma.competencePolicy.delete({ where: { id } });

      return reply.code(200).send({ id, deleted: true });
    },
  );
};
