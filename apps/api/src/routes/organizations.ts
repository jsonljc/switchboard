import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";

const FORBIDDEN_UPDATE_FIELDS = new Set(["id", "managedChannels", "provisioningStatus"]);

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/organizations/:orgId/config
  app.get(
    "/:orgId/config",
    {
      schema: {
        description: "Read org config. Auto-creates with defaults if missing (idempotent upsert).",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const config = await app.prisma.organizationConfig.upsert({
        where: { id: orgId },
        create: {
          id: orgId,
          name: "",
          runtimeType: "http",
          runtimeConfig: {},
          governanceProfile: "guarded",
          onboardingComplete: false,
          managedChannels: [],
          provisioningStatus: "pending",
        },
        update: {},
      });

      return reply.send({ config });
    },
  );

  // PUT /api/organizations/:orgId/config
  app.put(
    "/:orgId/config",
    {
      schema: {
        description:
          "Update org config. Rejects writes to id, managedChannels, provisioningStatus.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId } = request.params as { orgId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const body = request.body as Record<string, unknown>;
      const forbiddenKeys = Object.keys(body).filter((k) => FORBIDDEN_UPDATE_FIELDS.has(k));
      if (forbiddenKeys.length > 0) {
        return reply.code(400).send({
          error: `Cannot update server-derived fields: ${forbiddenKeys.join(", ")}`,
          statusCode: 400,
        });
      }

      const config = await app.prisma.organizationConfig.update({
        where: { id: orgId },
        data: body,
      });

      return reply.send({ config });
    },
  );
};
