import type { FastifyPluginAsync } from "fastify";
import { generateIntegrationGuide } from "@switchboard/core";

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/organizations/:orgId/config
  app.get("/:orgId/config", {
    schema: {
      description: "Get organization configuration.",
      tags: ["Organizations"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { orgId } = request.params as { orgId: string };

    // Scope check
    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const config = await app.prisma.organizationConfig.findUnique({ where: { id: orgId } });
    if (!config) {
      return reply.code(404).send({ error: "Organization config not found", statusCode: 404 });
    }

    return reply.code(200).send({ config });
  });

  // PUT /api/organizations/:orgId/config
  app.put("/:orgId/config", {
    schema: {
      description: "Create or update organization configuration.",
      tags: ["Organizations"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { orgId } = request.params as { orgId: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const body = request.body as {
      name?: string;
      runtimeType?: string;
      runtimeConfig?: Record<string, unknown>;
      governanceProfile?: string;
      onboardingComplete?: boolean;
    };

    const config = await app.prisma.organizationConfig.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        name: body.name ?? "",
        runtimeType: body.runtimeType ?? "http",
        runtimeConfig: (body.runtimeConfig ?? {}) as any,
        governanceProfile: body.governanceProfile ?? "guarded",
        onboardingComplete: body.onboardingComplete ?? false,
      },
      update: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.runtimeType !== undefined && { runtimeType: body.runtimeType }),
        ...(body.runtimeConfig !== undefined && { runtimeConfig: body.runtimeConfig as any }),
        ...(body.governanceProfile !== undefined && { governanceProfile: body.governanceProfile }),
        ...(body.onboardingComplete !== undefined && { onboardingComplete: body.onboardingComplete }),
      },
    });

    return reply.code(200).send({ config });
  });

  // GET /api/organizations/:orgId/integration — returns integration guide
  app.get("/:orgId/integration", {
    schema: {
      description: "Get integration guide for the organization's chosen runtime type.",
      tags: ["Organizations"],
    },
  }, async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
    }

    const { orgId } = request.params as { orgId: string };
    const query = request.query as { runtimeType?: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    const config = await app.prisma.organizationConfig.findUnique({ where: { id: orgId } });
    const runtimeType = query.runtimeType ?? config?.runtimeType ?? "http";

    const apiBaseUrl = process.env["API_BASE_URL"] ?? "http://localhost:3000";

    const guide = generateIntegrationGuide({
      runtimeType,
      apiBaseUrl,
      apiKey: "<your-api-key>",
      organizationId: orgId,
    });

    return reply.code(200).send({ guide });
  });

  // POST /api/organizations/:orgId/provision — stub for Track B
  app.post("/:orgId/provision", {
    schema: {
      description: "Provision managed channels for an organization (coming soon).",
      tags: ["Organizations"],
    },
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };

    if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
      return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
    }

    return reply.code(501).send({
      error: "Managed channel provisioning is not yet implemented",
      statusCode: 501,
    });
  });
};
