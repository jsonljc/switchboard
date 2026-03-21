import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getConnectionStore } from "../utils/connection-store.js";
import { createLogger } from "../logger.js";

const ChannelProvisionBody = z.object({
  channels: z
    .array(
      z.object({
        channel: z.enum(["telegram", "slack", "whatsapp"]),
        botToken: z.string().max(500).optional(),
        webhookSecret: z.string().max(500).optional(),
        signingSecret: z.string().max(500).optional(),
        token: z.string().max(500).optional(),
        phoneNumberId: z.string().max(100).optional(),
        appSecret: z.string().max(500).optional(),
        verifyToken: z.string().max(500).optional(),
      }),
    )
    .min(1, "At least one channel is required"),
});

const logger = createLogger("org-channels");

/**
 * Organization channel management routes — provision, delete, and list managed channels.
 */
export const orgChannelsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/organizations/:orgId/provision — provision managed channels
  app.post(
    "/:orgId/provision",
    {
      schema: {
        description: "Provision managed channels for an organization.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { orgId } = request.params as { orgId: string };

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const parsed = ChannelProvisionBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid request body",
          details: parsed.error.issues,
          statusCode: 400,
        });
      }
      const body = parsed.data;

      const connectionStore = await getConnectionStore(app.prisma);

      if (!process.env["CREDENTIALS_ENCRYPTION_KEY"]) {
        return reply.code(503).send({
          error:
            "Credential encryption is not configured. Set CREDENTIALS_ENCRYPTION_KEY environment variable.",
          statusCode: 503,
        });
      }

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
        const validChannels = ["telegram", "slack", "whatsapp"];
        if (!validChannels.includes(ch.channel)) {
          return reply.code(400).send({ error: `Invalid channel: ${ch.channel}`, statusCode: 400 });
        }

        if (ch.channel === "whatsapp") {
          if (!ch.token) {
            return reply
              .code(400)
              .send({ error: "Token is required for WhatsApp", statusCode: 400 });
          }
          if (!ch.phoneNumberId) {
            return reply
              .code(400)
              .send({ error: "Phone Number ID is required for WhatsApp", statusCode: 400 });
          }
        } else if (!ch.botToken) {
          return reply
            .code(400)
            .send({ error: `Bot token is required for ${ch.channel}`, statusCode: 400 });
        }

        if (ch.channel === "slack" && !ch.signingSecret) {
          return reply
            .code(400)
            .send({ error: "Signing secret is required for Slack", statusCode: 400 });
        }

        // 1. Validate token
        const botUsername = await validateChannelToken(ch, reply);
        if (botUsername === null) return; // reply already sent by validation

        // 2. Store credentials
        const connectionId = randomUUID();
        const serviceId = `${ch.channel}-bot`;
        let credentials: Record<string, unknown>;
        if (ch.channel === "whatsapp") {
          credentials = {
            token: ch.token,
            phoneNumberId: ch.phoneNumberId,
          };
          if (ch.appSecret) credentials["appSecret"] = ch.appSecret;
          if (ch.verifyToken) credentials["verifyToken"] = ch.verifyToken;
        } else {
          credentials = { botToken: ch.botToken };
          if (ch.webhookSecret) credentials["webhookSecret"] = ch.webhookSecret;
          if (ch.signingSecret) credentials["signingSecret"] = ch.signingSecret;
        }

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
            botUsername: (typeof botUsername === "string" ? botUsername : undefined) ?? null,
            webhookPath,
            status: "provisioning",
          },
          update: {
            connectionId,
            botUsername: (typeof botUsername === "string" ? botUsername : undefined) ?? null,
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

        const result: (typeof results)[number] = {
          channel: ch.channel,
          botUsername: typeof botUsername === "string" ? botUsername : undefined,
          status: "active",
        };

        if (ch.channel === "slack") {
          result.webhookUrl = `${chatPublicUrl}${webhookPath}`;
          result.note = "Set this as your Slack app's Event Subscriptions Request URL";
        }

        if (ch.channel === "whatsapp") {
          result.webhookUrl = `${chatPublicUrl}${webhookPath}`;
          result.note =
            "Set this URL as your WhatsApp webhook callback URL in the Meta App Dashboard. The verify token is the one you provided during provisioning.";
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
    },
  );

  // DELETE /api/organizations/:orgId/channels/:channelId — remove a managed channel
  app.delete(
    "/:orgId/channels/:channelId",
    {
      schema: {
        description: "Delete a managed channel and its associated connection.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available", statusCode: 503 });
      }

      const { orgId, channelId } = request.params as { orgId: string; channelId: string };

      if (request.organizationIdFromAuth && orgId !== request.organizationIdFromAuth) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      const managedChannel = await app.prisma.managedChannel.findUnique({
        where: { id: channelId },
      });

      if (!managedChannel || managedChannel.organizationId !== orgId) {
        return reply.code(404).send({ error: "Channel not found", statusCode: 404 });
      }

      // Delete the managed channel
      await app.prisma.managedChannel.delete({ where: { id: channelId } });

      // Delete the associated connection
      if (managedChannel.connectionId) {
        const connectionStore = await getConnectionStore(app.prisma);
        try {
          await connectionStore.delete(managedChannel.connectionId);
        } catch (err) {
          logger.warn(
            { err, connectionId: managedChannel.connectionId },
            "Failed to delete connection (may already be deleted)",
          );
        }
      }

      // Update managedChannels array in org config
      const remaining = await app.prisma.managedChannel.findMany({
        where: { organizationId: orgId },
        select: { channel: true },
      });
      const remainingNames = remaining.map((r: (typeof remaining)[number]) => r.channel);

      await app.prisma.organizationConfig.update({
        where: { id: orgId },
        data: {
          managedChannels: remainingNames,
          ...(remainingNames.length === 0 && { provisioningStatus: "inactive" }),
        },
      });

      return reply.code(200).send({ deleted: true });
    },
  );

  // GET /api/organizations/:orgId/channels — list managed channels
  app.get(
    "/:orgId/channels",
    {
      schema: {
        description: "List managed channels for an organization.",
        tags: ["Organizations"],
      },
    },
    async (request, reply) => {
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
    },
  );
};

// ---------------------------------------------------------------------------
// Channel token validation helpers
// ---------------------------------------------------------------------------

interface ChannelSpec {
  channel: "telegram" | "slack" | "whatsapp";
  botToken?: string;
  token?: string;
  phoneNumberId?: string;
}

/**
 * Validate channel bot token against the provider API.
 * Returns the bot username on success, or `null` if the reply was already sent with an error.
 */
async function validateChannelToken(
  ch: ChannelSpec,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
): Promise<string | undefined | null> {
  if (ch.channel === "telegram") {
    return validateTelegramToken(ch.botToken!, reply);
  }
  if (ch.channel === "slack") {
    return validateSlackToken(ch.botToken!, reply);
  }
  if (ch.channel === "whatsapp") {
    return validateWhatsAppToken(ch.token!, ch.phoneNumberId!, reply);
  }
  return undefined;
}

async function validateTelegramToken(
  botToken: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
): Promise<string | undefined | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      reply.code(400).send({
        error: `Invalid Telegram bot token: API returned ${res.status}`,
        statusCode: 400,
      });
      return null;
    }
    const data = (await res.json()) as { ok: boolean; result?: { username?: string } };
    if (!data.ok) {
      reply.code(400).send({ error: "Invalid Telegram bot token", statusCode: 400 });
      return null;
    }
    return data.result?.username ? `@${data.result.username}` : undefined;
  } catch (err) {
    reply.code(400).send({
      error: `Failed to validate Telegram bot token: ${err instanceof Error ? err.message : "unknown error"}`,
      statusCode: 400,
    });
    return null;
  }
}

async function validateSlackToken(
  botToken: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
): Promise<string | undefined | null> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      reply.code(400).send({
        error: `Invalid Slack bot token: API returned ${res.status}`,
        statusCode: 400,
      });
      return null;
    }
    const data = (await res.json()) as { ok: boolean; user?: string; error?: string };
    if (!data.ok) {
      reply.code(400).send({
        error: `Invalid Slack bot token: ${data.error ?? "unknown error"}`,
        statusCode: 400,
      });
      return null;
    }
    return data.user;
  } catch (err) {
    reply.code(400).send({
      error: `Failed to validate Slack bot token: ${err instanceof Error ? err.message : "unknown error"}`,
      statusCode: 400,
    });
    return null;
  }
}

async function validateWhatsAppToken(
  token: string,
  phoneNumberId: string,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } },
): Promise<string | undefined | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      reply.code(400).send({
        error: `Invalid WhatsApp credentials: API returned ${res.status}`,
        statusCode: 400,
      });
      return null;
    }
    const data = (await res.json()) as {
      verified_name?: string;
      display_phone_number?: string;
    };
    return data.verified_name ?? data.display_phone_number ?? undefined;
  } catch (err) {
    reply.code(400).send({
      error: `Failed to validate WhatsApp credentials: ${err instanceof Error ? err.message : "unknown error"}`,
      statusCode: 400,
    });
    return null;
  }
}
