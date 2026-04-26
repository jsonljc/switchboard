import type { FastifyInstance } from "fastify";
import type { ReplySink } from "@switchboard/core";
import type { GatewayEntry } from "../managed/runtime-registry.js";
import type { FailedMessageStore } from "../dlq/failed-message-store.js";

/**
 * Minimal contract used by the managed webhook route to forward CTWA-tagged
 * inbound WhatsApp messages into the lead intake pipeline. Matches the public
 * surface of `CtwaAdapter` from `@switchboard/ad-optimizer`.
 */
export interface CtwaAdapterLike {
  ingest(
    msg: {
      from: string;
      metadata: Record<string, unknown>;
      organizationId: string;
      deploymentId: string;
    },
    opts?: { parentWorkUnitId?: string },
  ): Promise<void>;
}

export interface ManagedWebhookDeps {
  registry: {
    getGatewayByWebhookPath(path: string): GatewayEntry | null;
  };
  failedMessageStore?: FailedMessageStore | null;
  dedup?: {
    checkDedup(channel: string, messageId: string): Promise<boolean>;
  };
  ctwaAdapter?: CtwaAdapterLike;
  onStatusUpdate?: (
    status: {
      messageId: string;
      recipientId: string;
      status: string;
      timestamp: Date;
      errorCode?: string;
      errorTitle?: string;
      pricingCategory?: string;
      billable?: boolean;
    },
    orgId?: string,
  ) => Promise<void>;
}

export function registerManagedWebhookRoutes(app: FastifyInstance, deps: ManagedWebhookDeps): void {
  const { registry, failedMessageStore } = deps;

  app.get("/webhook/managed/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const webhookPath = `/webhook/managed/${webhookId}`;
    const entry = registry.getGatewayByWebhookPath(webhookPath);

    if (!entry) {
      return reply.code(404).send("Not found");
    }

    if (entry.adapter.handleVerification) {
      const query = request.query as Record<string, string | undefined>;
      const result = entry.adapter.handleVerification(query);
      return reply.code(result.status).send(result.body);
    }

    return reply.code(200).send("OK");
  });

  app.post("/webhook/managed/:webhookId", async (request, reply) => {
    const { webhookId } = request.params as { webhookId: string };
    const webhookPath = `/webhook/managed/${webhookId}`;

    const gatewayEntry = registry.getGatewayByWebhookPath(webhookPath);
    if (!gatewayEntry) {
      app.log.warn({ webhookPath }, "No gateway entry found for webhook path");
      return reply.code(200).send({ ok: true });
    }

    const payload = request.body as Record<string, unknown>;
    if (gatewayEntry.channel === "slack" && payload["type"] === "url_verification") {
      return reply.code(200).send({ challenge: payload["challenge"] });
    }

    if (gatewayEntry.adapter.verifyRequest) {
      const rawBody =
        ((request as unknown as Record<string, unknown>).rawBody as string) ??
        JSON.stringify(request.body);
      const headers = request.headers as Record<string, string | undefined>;
      if (!gatewayEntry.adapter.verifyRequest(rawBody, headers)) {
        return reply.code(401).send({ error: "Invalid signature" });
      }
    }

    if (gatewayEntry.channel === "whatsapp" && deps.onStatusUpdate) {
      const wa = gatewayEntry.adapter as import("../adapters/whatsapp.js").WhatsAppAdapter;
      if (typeof wa.parseStatusUpdate === "function") {
        const statusUpdate = wa.parseStatusUpdate(request.body);
        if (statusUpdate) {
          deps
            .onStatusUpdate(statusUpdate, gatewayEntry.orgId)
            .catch((err: unknown) => app.log.error(err, "Status update processing error"));
          return reply.code(200).send({ ok: true });
        }
      }
    }

    if (deps.dedup && gatewayEntry.adapter.extractMessageId) {
      const msgId = gatewayEntry.adapter.extractMessageId(request.body);
      if (msgId) {
        const isNew = await deps.dedup.checkDedup(gatewayEntry.channel, msgId);
        if (!isNew) {
          return reply.code(200).send({ ok: true });
        }
      }
    }

    const incoming = gatewayEntry.adapter.parseIncomingMessage(request.body);
    if (!incoming) {
      return reply.code(200).send({ ok: true });
    }

    // Fire-and-forget CTWA lead intake: when an inbound WhatsApp message carries
    // a `ctwa_clid` referral (Click-to-WhatsApp ad), dispatch it through the
    // PlatformIngress lead.intake front door so a Contact gets created with
    // sourceType="ctwa". Idempotent on the (phone, ctwa_clid) pair downstream,
    // so ordering vs. Alex's reply does not matter. Failures must never block
    // the existing message-handling flow.
    if (
      deps.ctwaAdapter &&
      gatewayEntry.channel === "whatsapp" &&
      gatewayEntry.orgId &&
      typeof incoming.metadata?.["ctwaClid"] === "string" &&
      (incoming.metadata["ctwaClid"] as string).length > 0
    ) {
      void deps.ctwaAdapter
        .ingest({
          from: incoming.principalId,
          metadata: incoming.metadata,
          organizationId: gatewayEntry.orgId,
          deploymentId: gatewayEntry.deploymentConnectionId,
        })
        .catch((err: unknown) =>
          console.warn("[managed-webhook] CTWA intake failed", {
            err,
            from: incoming.principalId,
          }),
        );
    }

    const rawMessageId = gatewayEntry.adapter.extractMessageId(request.body);
    if (rawMessageId && gatewayEntry.channel === "whatsapp") {
      const wa = gatewayEntry.adapter as import("../adapters/whatsapp.js").WhatsAppAdapter;
      if (typeof wa.markAsRead === "function") {
        wa.markAsRead(rawMessageId).catch(() => {});
      }
    }

    const threadId = incoming.threadId ?? incoming.principalId;
    const replySink: ReplySink = {
      send: async (text) => gatewayEntry.adapter.sendTextReply(threadId, text),
    };

    try {
      await gatewayEntry.gateway.handleIncoming(
        {
          channel: gatewayEntry.channel,
          token: gatewayEntry.deploymentConnectionId,
          sessionId: threadId,
          text: incoming.text,
        },
        replySink,
      );
    } catch (err) {
      app.log.error(err, "Gateway webhook processing error");
      failedMessageStore
        ?.record({
          channel: gatewayEntry.channel,
          webhookPath,
          rawPayload: request.body as Record<string, unknown>,
          stage: "unknown",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorStack: err instanceof Error ? err.stack : undefined,
        })
        .catch((dlqErr: unknown) => app.log.error(dlqErr, "DLQ record error"));
    }
    return reply.code(200).send({ ok: true });
  });
}
