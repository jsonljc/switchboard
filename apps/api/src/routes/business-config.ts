// ---------------------------------------------------------------------------
// Business Config API Routes — GET/PUT config, GET versions
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import { BusinessProfileSchema } from "@switchboard/schemas";
import { DeploymentReadinessChecker } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";

export const businessConfigRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/business-config/:orgId
  app.get(
    "/:orgId",
    {
      schema: {
        description: "Get the current business config for an organization.",
        tags: ["Business Config"],
        params: {
          type: "object",
          properties: { orgId: { type: "string" } },
          required: ["orgId"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const { PrismaBusinessConfigStore } = await import("@switchboard/db");
      const store = new PrismaBusinessConfigStore(app.prisma);
      const config = await store.getByOrgId(orgId);

      if (!config) {
        return reply.code(404).send({ error: "No config found for this organization" });
      }
      return reply.code(200).send({ config });
    },
  );

  // PUT /api/business-config/:orgId
  app.put(
    "/:orgId",
    {
      schema: {
        description: "Update the business config for an organization.",
        tags: ["Business Config"],
        params: {
          type: "object",
          properties: { orgId: { type: "string" } },
          required: ["orgId"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const parsed = BusinessProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid config", details: parsed.error.issues });
      }

      const { PrismaBusinessConfigStore } = await import("@switchboard/db");
      const store = new PrismaBusinessConfigStore(app.prisma);
      await store.save(
        orgId,
        parsed.data,
        request.principalIdFromAuth ?? "unknown",
        (request.body as Record<string, unknown>)["changeDescription"] as string | undefined,
      );

      return reply.code(200).send({ success: true });
    },
  );

  // GET /api/business-config/:orgId/versions
  app.get(
    "/:orgId/versions",
    {
      schema: {
        description: "List config version history.",
        tags: ["Business Config"],
        params: {
          type: "object",
          properties: { orgId: { type: "string" } },
          required: ["orgId"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const { PrismaBusinessConfigStore } = await import("@switchboard/db");
      const store = new PrismaBusinessConfigStore(app.prisma);
      const versions = await store.listVersions(orgId);
      return reply.code(200).send({ versions });
    },
  );

  // GET /api/business-config/:orgId/readiness
  app.get(
    "/:orgId/readiness",
    {
      schema: {
        description: "Check deployment readiness for an organization.",
        tags: ["Business Config"],
        params: {
          type: "object",
          properties: { orgId: { type: "string" } },
          required: ["orgId"],
        },
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const { PrismaBusinessConfigStore } = await import("@switchboard/db");
      const store = new PrismaBusinessConfigStore(app.prisma);
      const config = await store.getByOrgId(orgId);

      if (!config) {
        return reply.code(404).send({ error: "No config found" });
      }

      // Check if any channel is configured
      const orgConfig = await app.prisma.organizationConfig.findUnique({
        where: { id: orgId },
        select: { managedChannels: true },
      });
      const channelConfigured = (orgConfig?.managedChannels?.length ?? 0) > 0;

      const checker = new DeploymentReadinessChecker();
      const result = checker.check(config, channelConfigured);
      return reply.code(200).send(result);
    },
  );
};
