import type { FastifyPluginAsync } from "fastify";
import { encryptCredentials } from "@switchboard/db";
import { requireOrganizationScope } from "../utils/require-org.js";

const ALLOWED_CONFIG_UPDATE_FIELDS = new Set([
  "name",
  "runtimeType",
  "runtimeConfig",
  "governanceProfile",
  "onboardingComplete",
]);

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
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (ALLOWED_CONFIG_UPDATE_FIELDS.has(key)) {
          data[key] = value;
        }
      }

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({
          error:
            "No valid update fields provided. Allowed: " +
            [...ALLOWED_CONFIG_UPDATE_FIELDS].join(", "),
          statusCode: 400,
        });
      }

      const config = await app.prisma.organizationConfig.update({
        where: { id: orgId },
        data,
      });

      return reply.send({ config });
    },
  );

  // GET /api/organizations/:orgId/channels
  app.get(
    "/:orgId/channels",
    {
      schema: {
        description: "List managed channels for the organization.",
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

      const channels = await app.prisma.managedChannel.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
      });

      const formatted = channels.map((ch) => ({
        id: ch.id,
        channel: ch.channel,
        botUsername: ch.botUsername,
        webhookPath: ch.webhookPath,
        webhookRegistered: ch.webhookRegistered,
        status: ch.status,
        statusDetail: ch.statusDetail,
        lastHealthCheck: ch.lastHealthCheck?.toISOString() ?? null,
        createdAt: ch.createdAt.toISOString(),
      }));

      return reply.send({ channels: formatted });
    },
  );

  // POST /api/organizations/:orgId/provision
  app.post(
    "/:orgId/provision",
    {
      schema: {
        description:
          "Provision one or more channels. Creates Connection + ManagedChannel rows. Synchronous — row creation and local validation only; external activation is deferred.",
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

      const { channels } = request.body as {
        channels: Array<{
          channel: string;
          botToken?: string;
          webhookSecret?: string;
          signingSecret?: string;
          token?: string;
          phoneNumberId?: string;
          appSecret?: string;
          verifyToken?: string;
        }>;
      };

      if (!Array.isArray(channels) || channels.length === 0) {
        return reply.code(400).send({ error: "channels array is required", statusCode: 400 });
      }

      const results = [];
      for (const ch of channels) {
        try {
          const encrypted = encryptCredentials({
            botToken: ch.botToken,
            webhookSecret: ch.webhookSecret,
            signingSecret: ch.signingSecret,
            token: ch.token,
            phoneNumberId: ch.phoneNumberId,
            appSecret: ch.appSecret,
            verifyToken: ch.verifyToken,
          });

          const connection = await app.prisma.connection.create({
            data: {
              id: `conn_${crypto.randomUUID().slice(0, 8)}`,
              organizationId: orgId,
              serviceId: ch.channel,
              serviceName: ch.channel,
              authType: "bot_token",
              credentials: encrypted,
              scopes: [],
            },
          });

          const webhookPath = `/webhooks/${ch.channel}/${crypto.randomUUID().slice(0, 12)}`;

          const managedChannel = await app.prisma.managedChannel.create({
            data: {
              organizationId: orgId,
              channel: ch.channel,
              connectionId: connection.id,
              webhookPath,
              botUsername: null,
            },
          });

          results.push({
            id: managedChannel.id,
            channel: managedChannel.channel,
            botUsername: managedChannel.botUsername,
            webhookPath: managedChannel.webhookPath,
            webhookRegistered: managedChannel.webhookRegistered,
            status: "active",
            statusDetail: null,
            lastHealthCheck: null,
            createdAt: managedChannel.createdAt.toISOString(),
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          results.push({
            id: null,
            channel: ch.channel,
            botUsername: null,
            webhookPath: null,
            webhookRegistered: false,
            status: "error",
            statusDetail: message,
            lastHealthCheck: null,
            createdAt: new Date().toISOString(),
          });
        }
      }

      return reply.send({ channels: results });
    },
  );

  // DELETE /api/organizations/:orgId/channels/:channelId
  app.delete(
    "/:orgId/channels/:channelId",
    {
      schema: {
        description: "Delete a managed channel (verifies org ownership).",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const authOrgId = requireOrganizationScope(request, reply);
      if (!authOrgId) return;

      const { orgId, channelId } = request.params as { orgId: string; channelId: string };
      if (orgId !== authOrgId) {
        return reply.code(403).send({ error: "Forbidden: org mismatch", statusCode: 403 });
      }

      const existing = await app.prisma.managedChannel.findUnique({
        where: { id: channelId },
      });

      if (!existing || existing.organizationId !== orgId) {
        return reply.code(404).send({ error: "Channel not found", statusCode: 404 });
      }

      await app.prisma.managedChannel.delete({ where: { id: channelId } });

      return reply.send({ deleted: true });
    },
  );
};
