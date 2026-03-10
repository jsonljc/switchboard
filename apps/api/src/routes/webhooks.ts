import type { FastifyPluginAsync } from "fastify";
import { randomUUID, createHmac } from "node:crypto";
import { requireRole } from "../utils/require-role.js";
import { requireOrganizationScope } from "../utils/require-org.js";

interface WebhookRegistration {
  id: string;
  url: string;
  events: string[];
  secret: string;
  organizationId: string;
  active: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

// In-memory store — production would use Prisma
const webhookStore = new Map<string, WebhookRegistration>();

function getOrgWebhooks(orgId: string): WebhookRegistration[] {
  return [...webhookStore.values()].filter((w) => w.organizationId === orgId);
}

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/webhooks — list registered webhooks
  app.get(
    "/",
    {
      schema: {
        description: "List registered webhooks for the organization.",
        tags: ["Webhooks"],
      },
    },
    async (request, reply) => {
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      const webhooks = getOrgWebhooks(orgId).map(({ secret: _s, ...rest }) => rest);
      return reply.code(200).send({ webhooks });
    },
  );

  // POST /api/webhooks — register a new webhook
  app.post(
    "/",
    {
      schema: {
        description: "Register a new webhook endpoint.",
        tags: ["Webhooks"],
        body: {
          type: "object",
          required: ["url", "events"],
          properties: {
            url: { type: "string", format: "uri" },
            events: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireRole(request, reply, "admin", "operator"))) return;

      const { url, events } = request.body as { url: string; events: string[] };
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      // Validate URL scheme
      if (!url.startsWith("https://")) {
        return reply.code(400).send({ error: "Webhook URL must use HTTPS" });
      }

      const webhook: WebhookRegistration = {
        id: `wh_${randomUUID()}`,
        url,
        events,
        secret: randomUUID(),
        organizationId: orgId,
        active: true,
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null,
      };

      webhookStore.set(webhook.id, webhook);

      return reply.code(201).send({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secret: webhook.secret,
        active: webhook.active,
        createdAt: webhook.createdAt,
      });
    },
  );

  // DELETE /api/webhooks/:id — deregister a webhook
  app.delete(
    "/:id",
    {
      schema: {
        description: "Deregister a webhook.",
        tags: ["Webhooks"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireRole(request, reply, "admin", "operator"))) return;

      const { id } = request.params as { id: string };
      const webhook = webhookStore.get(id);
      if (!webhook) {
        return reply.code(404).send({ error: "Webhook not found" });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (webhook.organizationId !== orgId) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      webhookStore.delete(id);
      return reply.code(200).send({ deleted: true });
    },
  );

  // POST /api/webhooks/:id/test — send a test payload
  app.post(
    "/:id/test",
    {
      schema: {
        description: "Send a test payload to a webhook endpoint.",
        tags: ["Webhooks"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireRole(request, reply, "admin", "operator"))) return;

      const { id } = request.params as { id: string };
      const webhook = webhookStore.get(id);
      if (!webhook) {
        return reply.code(404).send({ error: "Webhook not found" });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (webhook.organizationId !== orgId) {
        return reply.code(403).send({ error: "Forbidden" });
      }

      const testPayload = {
        event: "webhook.test",
        timestamp: new Date().toISOString(),
        data: { message: "This is a test payload from Switchboard." },
      };

      const payloadStr = JSON.stringify(testPayload);
      const signature = createHmac("sha256", webhook.secret).update(payloadStr).digest("hex");

      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Switchboard-Signature": signature,
            "X-Switchboard-Event": "webhook.test",
          },
          body: payloadStr,
          signal: AbortSignal.timeout(10_000),
        });

        webhook.lastTriggeredAt = new Date().toISOString();

        return reply.code(200).send({
          success: response.ok,
          statusCode: response.status,
          lastTriggeredAt: webhook.lastTriggeredAt,
        });
      } catch (err) {
        return reply.code(200).send({
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );
};
