import type { FastifyPluginAsync } from "fastify";
import { hashToken } from "../services/lead-webhook/token.js";
import { getNormalizer } from "../services/lead-webhook/normalizers/index.js";
import { normalizePhone, PhoneError } from "../services/lead-webhook/phone.js";
import { checkRateLimit } from "../services/lead-webhook/rate-limit.js";
import type { SourceType } from "../services/lead-webhook/types.js";

interface LeadWebhookRow {
  id: string;
  organizationId: string;
  tokenPrefix: string;
  sourceType: SourceType;
  status: "active" | "revoked";
  greetingTemplateName: string;
}

// NOTE: app.leadWebhookStore is declared on FastifyInstance in apps/api/src/app.ts.
// Do not redeclare here.

export const leadsInboundRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { webhookToken: string }; Body: Record<string, unknown> }>(
    "/leads/inbound/:webhookToken",
    async (request, reply) => {
      const token = request.params.webhookToken;
      const tokenHash = hashToken(token);

      const webhook = (await app.leadWebhookStore.findByTokenHash(
        tokenHash,
      )) as LeadWebhookRow | null;
      if (!webhook) {
        app.log.info({ reason: "invalid_token" }, "lead.webhook.rejected");
        return reply.code(401).send({ error: "invalid_token" });
      }

      const rl = await checkRateLimit(app.redis, tokenHash);
      if (!rl.allowed) {
        app.log.info(
          { tokenPrefix: webhook.tokenPrefix, reason: "rate_limited" },
          "lead.webhook.rejected",
        );
        return reply.code(429).send({ error: "rate_limited", retryAfter: rl.retryAfterSeconds });
      }

      const normalizer = getNormalizer(webhook.sourceType);
      const normalized = normalizer(request.body ?? {});

      if (normalized.phone) {
        try {
          normalized.phone = normalizePhone(normalized.phone, null);
        } catch (e) {
          if (e instanceof PhoneError) {
            return reply.code(400).send({ error: "invalid_phone", reason: e.reason });
          }
          throw e;
        }
      }

      if (!normalized.phone && !normalized.email) {
        app.log.info(
          { tokenPrefix: webhook.tokenPrefix, reason: "missing_contact" },
          "lead.webhook.rejected",
        );
        return reply
          .code(400)
          .send({ error: "missing_contact", message: "phone or email required" });
      }

      app.log.info(
        {
          tokenPrefix: webhook.tokenPrefix,
          organizationId: webhook.organizationId,
          source: normalized.source,
          hasPhone: Boolean(normalized.phone),
          hasEmail: Boolean(normalized.email),
        },
        "lead.webhook.received",
      );

      const dedupeKey =
        normalized.dedupeKey ??
        `website-lead-${tokenHash.slice(0, 16)}-${normalized.phone ?? normalized.email}-${Math.floor(
          Date.now() / (5 * 60_000),
        )}`;

      const submitResult = await app.platformIngress.submit({
        intent: "website.lead.intake",
        organizationId: webhook.organizationId,
        actor: { id: "system", type: "service" },
        parameters: {
          ...normalized,
          greetingTemplateName: webhook.greetingTemplateName,
        },
        trigger: "api",
        surface: { surface: "api" },
        targetHint: { skillSlug: "alex" },
        idempotencyKey: dedupeKey,
      });

      if (!submitResult.ok) {
        app.log.error({ error: submitResult.error.message }, "website.lead.intake submit failed");
        return reply.code(500).send({ error: "intake_failed" });
      }

      // Fire-and-forget; do not block the response
      app.leadWebhookStore.touchLastUsed(webhook.id).catch(() => undefined);

      app.log.info(
        {
          workUnitId: submitResult.workUnit.id,
          idempotencyKey: dedupeKey,
        },
        "lead.webhook.normalized",
      );

      return reply.code(202).send({
        received: true,
        workUnitId: submitResult.workUnit.id,
        traceId: submitResult.workUnit.traceId,
      });
    },
  );
};
