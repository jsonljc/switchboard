import type { FastifyPluginAsync } from "fastify";
import { randomUUID, createHmac } from "node:crypto";
import { requireRole } from "../utils/require-role.js";
import { requireOrganizationScope } from "../utils/require-org.js";
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";

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
      if (!app.prisma) {
        return reply.code(503).send({ error: "Database required for webhook management" });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      const webhooks = await app.prisma.webhookRegistration.findMany({
        where: { organizationId: orgId, active: true },
        orderBy: { createdAt: "desc" },
      });

      const sanitized = webhooks.map(({ secret: _s, ...rest }) => rest);
      return reply.code(200).send({ webhooks: sanitized });
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

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database required for webhook management" });
      }

      const { url, events } = request.body as { url: string; events: string[] };
      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;

      // Validate URL: HTTPS only, no private/internal IPs
      try {
        await assertSafeUrl(url);
      } catch (err) {
        const message = err instanceof SSRFError ? err.message : "Invalid webhook URL";
        return reply.code(400).send({ error: message, statusCode: 400 });
      }

      const webhook = await app.prisma.webhookRegistration.create({
        data: {
          organizationId: orgId,
          url,
          events,
          secret: randomUUID(),
        },
      });

      return reply.code(201).send({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        secret: webhook.secret,
        active: webhook.active,
        createdAt: webhook.createdAt.toISOString(),
      });
    },
  );

  // DELETE /api/webhooks/:id — deregister a webhook (soft-delete)
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

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database required for webhook management" });
      }

      const { id } = request.params as { id: string };
      const webhook = await app.prisma.webhookRegistration.findUnique({ where: { id } });
      if (!webhook) {
        return reply.code(404).send({ error: "Webhook not found", statusCode: 404 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (webhook.organizationId !== orgId) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      await app.prisma.webhookRegistration.update({
        where: { id },
        data: { active: false },
      });
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

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database required for webhook management" });
      }

      const { id } = request.params as { id: string };
      const webhook = await app.prisma.webhookRegistration.findUnique({ where: { id } });
      if (!webhook) {
        return reply.code(404).send({ error: "Webhook not found", statusCode: 404 });
      }

      const orgId = requireOrganizationScope(request, reply);
      if (!orgId) return;
      if (webhook.organizationId !== orgId) {
        return reply.code(403).send({ error: "Forbidden", statusCode: 403 });
      }

      // Re-validate URL at fetch time (DNS rebinding defense)
      try {
        await assertSafeUrl(webhook.url);
      } catch (err) {
        const message = err instanceof SSRFError ? err.message : "Invalid webhook URL";
        return reply.code(400).send({ error: message, statusCode: 400 });
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

        await app.prisma.webhookRegistration.update({
          where: { id },
          data: { lastTriggeredAt: new Date() },
        });

        return reply.code(200).send({
          success: response.ok,
          statusCode: response.status,
          lastTriggeredAt: new Date().toISOString(),
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
