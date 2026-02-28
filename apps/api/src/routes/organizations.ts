import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { generateIntegrationGuide } from "@switchboard/core";
import type { PrismaConnectionStore as PrismaConnectionStoreType } from "@switchboard/db";

let _storeModule: { PrismaConnectionStore: typeof PrismaConnectionStoreType } | null = null;
async function getConnectionStore(prisma: any): Promise<InstanceType<typeof PrismaConnectionStoreType>> {
  if (!_storeModule) {
    _storeModule = await import("@switchboard/db") as any;
  }
  return new _storeModule!.PrismaConnectionStore(prisma);
}

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
      selectedCartridgeId?: string;
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
        selectedCartridgeId: body.selectedCartridgeId ?? null,
        onboardingComplete: body.onboardingComplete ?? false,
      },
      update: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.runtimeType !== undefined && { runtimeType: body.runtimeType }),
        ...(body.runtimeConfig !== undefined && { runtimeConfig: body.runtimeConfig as any }),
        ...(body.governanceProfile !== undefined && { governanceProfile: body.governanceProfile }),
        ...(body.selectedCartridgeId !== undefined && { selectedCartridgeId: body.selectedCartridgeId }),
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

  // POST /api/organizations/:orgId/provision — provision managed channels
  app.post("/:orgId/provision", {
    schema: {
      description: "Provision managed channels for an organization.",
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
      channels: Array<{
        channel: "telegram" | "slack";
        botToken: string;
        webhookSecret?: string;
        signingSecret?: string;
      }>;
    };

    if (!body.channels || !Array.isArray(body.channels) || body.channels.length === 0) {
      return reply.code(400).send({ error: "At least one channel is required", statusCode: 400 });
    }

    const connectionStore = await getConnectionStore(app.prisma);
    const chatPublicUrl = process.env["CHAT_PUBLIC_URL"] ?? "http://localhost:3001";
    const chatInternalUrl = process.env["CHAT_INTERNAL_URL"] ?? "http://localhost:3001";
    const internalSecret = process.env["INTERNAL_API_SECRET"];

    const results: Array<{
      channel: string;
      botUsername?: string;
      webhookUrl?: string;
      status: string;
      note?: string;
    }> = [];

    for (const ch of body.channels) {
      const validChannels = ["telegram", "slack"];
      if (!validChannels.includes(ch.channel)) {
        return reply.code(400).send({ error: `Invalid channel: ${ch.channel}`, statusCode: 400 });
      }

      if (!ch.botToken) {
        return reply.code(400).send({ error: `Bot token is required for ${ch.channel}`, statusCode: 400 });
      }

      if (ch.channel === "slack" && !ch.signingSecret) {
        return reply.code(400).send({ error: "Signing secret is required for Slack", statusCode: 400 });
      }

      // 1. Validate token
      let botUsername: string | undefined;
      if (ch.channel === "telegram") {
        try {
          const res = await fetch(`https://api.telegram.org/bot${ch.botToken}/getMe`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            return reply.code(400).send({
              error: `Invalid Telegram bot token: API returned ${res.status}`,
              statusCode: 400,
            });
          }
          const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
          if (!data.ok) {
            return reply.code(400).send({ error: "Invalid Telegram bot token", statusCode: 400 });
          }
          botUsername = data.result?.username ? `@${data.result.username}` : undefined;
        } catch (err) {
          return reply.code(400).send({
            error: `Failed to validate Telegram bot token: ${err instanceof Error ? err.message : "unknown error"}`,
            statusCode: 400,
          });
        }
      } else if (ch.channel === "slack") {
        try {
          const res = await fetch("https://slack.com/api/auth.test", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${ch.botToken}`,
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            return reply.code(400).send({
              error: `Invalid Slack bot token: API returned ${res.status}`,
              statusCode: 400,
            });
          }
          const data = (await res.json()) as { ok: boolean; user?: string; error?: string };
          if (!data.ok) {
            return reply.code(400).send({
              error: `Invalid Slack bot token: ${data.error ?? "unknown error"}`,
              statusCode: 400,
            });
          }
          botUsername = data.user;
        } catch (err) {
          return reply.code(400).send({
            error: `Failed to validate Slack bot token: ${err instanceof Error ? err.message : "unknown error"}`,
            statusCode: 400,
          });
        }
      }

      // 2. Store credentials
      const connectionId = randomUUID();
      const serviceId = `${ch.channel}-bot`;
      const credentials: Record<string, unknown> = { botToken: ch.botToken };
      if (ch.webhookSecret) credentials["webhookSecret"] = ch.webhookSecret;
      if (ch.signingSecret) credentials["signingSecret"] = ch.signingSecret;

      await connectionStore.save({
        id: connectionId,
        serviceId,
        serviceName: `${ch.channel} bot`,
        organizationId: orgId,
        authType: "api_key",
        credentials,
        scopes: [],
        refreshStrategy: "manual",
        status: "connected",
        lastHealthCheck: new Date(),
      });

      // 3. Create ManagedChannel
      const webhookId = randomUUID();
      const webhookPath = `/webhook/managed/${webhookId}`;

      const managedChannel = await app.prisma.managedChannel.upsert({
        where: { organizationId_channel: { organizationId: orgId, channel: ch.channel } },
        create: {
          organizationId: orgId,
          channel: ch.channel,
          connectionId,
          botUsername: botUsername ?? null,
          webhookPath,
          status: "provisioning",
        },
        update: {
          connectionId,
          botUsername: botUsername ?? null,
          webhookPath,
          status: "provisioning",
          statusDetail: null,
        },
      });

      // 4. Register webhook (Telegram only)
      let webhookRegistered = false;
      if (ch.channel === "telegram") {
        try {
          const webhookUrl = `${chatPublicUrl}${webhookPath}`;
          const setWebhookBody: Record<string, unknown> = { url: webhookUrl };
          if (ch.webhookSecret) {
            setWebhookBody["secret_token"] = ch.webhookSecret;
          }
          const res = await fetch(`https://api.telegram.org/bot${ch.botToken}/setWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(setWebhookBody),
            signal: AbortSignal.timeout(10_000),
          });
          const data = (await res.json()) as { ok: boolean; description?: string };
          webhookRegistered = data.ok;
          if (!data.ok) {
            app.log.warn({ description: data.description }, "Failed to set Telegram webhook");
          }
        } catch (err) {
          app.log.error(err, "Error setting Telegram webhook");
        }
      }

      // 5. Update status
      await app.prisma.managedChannel.update({
        where: { id: managedChannel.id },
        data: {
          status: "active",
          webhookRegistered,
        },
      });

      // 6. Notify chat server
      try {
        const notifyHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (internalSecret) {
          notifyHeaders["Authorization"] = `Bearer ${internalSecret}`;
        }
        await fetch(`${chatInternalUrl}/internal/provision-notify`, {
          method: "POST",
          headers: notifyHeaders,
          body: JSON.stringify({ managedChannelId: managedChannel.id }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        app.log.warn(err, "Failed to notify chat server (it may need to be restarted)");
      }

      const result: typeof results[number] = {
        channel: ch.channel,
        botUsername,
        status: "active",
      };

      if (ch.channel === "slack") {
        result.webhookUrl = `${chatPublicUrl}${webhookPath}`;
        result.note = "Set this as your Slack app's Event Subscriptions Request URL";
      }

      results.push(result);
    }

    // Update org config
    const managedChannelNames = results.map((r) => r.channel);
    await app.prisma.organizationConfig.update({
      where: { id: orgId },
      data: {
        managedChannels: managedChannelNames,
        provisioningStatus: "active",
      },
    });

    return reply.code(200).send({
      channels: results,
      provisioningStatus: "active",
    });
  });

  // GET /api/organizations/:orgId/channels — list managed channels
  app.get("/:orgId/channels", {
    schema: {
      description: "List managed channels for an organization.",
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

    const channels = await app.prisma.managedChannel.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        channel: true,
        botUsername: true,
        webhookPath: true,
        webhookRegistered: true,
        status: true,
        statusDetail: true,
        lastHealthCheck: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return reply.code(200).send({ channels });
  });
};
