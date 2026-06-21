// @route-class: ingress-receiver
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
  /**
   * Resolves the org's Alex AgentDeployment so a CTWA lead is attributed to that
   * deployment id (not the channel-connection id) on the ActivityLog feed - the
   * per-Alex CRM feed reads ActivityLog.listByDeployment. Narrowed to the single
   * method the route needs; satisfied structurally by `PrismaDeploymentResolver`.
   */
  deploymentResolver?: {
    resolveByOrgAndSlug(
      organizationId: string,
      skillSlug: string,
    ): Promise<{ deploymentId: string }>;
  };
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

  app.post("/webhook/managed/:webhookId", { config: { rawBody: true } }, async (request, reply) => {
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

    // Fail closed: an adapter with no verifyRequest cannot authenticate the
    // payload, so we must not process it. (The Slack url_verification handshake
    // above is the only path allowed through before this gate.)
    if (!gatewayEntry.adapter.verifyRequest) {
      app.log.warn(
        { webhookPath, channel: gatewayEntry.channel },
        "Managed webhook adapter has no verifyRequest — rejecting unsigned payload",
      );
      return reply.code(401).send({ error: "Signature verification unavailable" });
    }
    // Verify the HMAC against the EXACT bytes the platform signed. fastify-raw-body
    // (registered in main.ts; opted in via { config: { rawBody: true } } above) populates
    // request.rawBody for the JSON path, and the Slack form parser sets it for interactive
    // payloads. Re-serializing request.body (JSON.stringify) is not byte-identical to what
    // Meta/Slack signed (key order, unicode escaping, whitespace), so it silently 401s valid
    // inbound messages (security audit F9). If raw capture is unavailable, fail closed: a
    // re-serialized HMAC can only ever produce a false rejection, never a valid match, so the
    // old fallback added no security and only hid a wiring regression.
    const rawBody = (request as unknown as { rawBody?: string }).rawBody;
    if (typeof rawBody !== "string") {
      app.log.error(
        { webhookPath, channel: gatewayEntry.channel },
        "Managed webhook raw body unavailable (raw-body capture not wired); rejecting",
      );
      return reply.code(401).send({ error: "Signature verification unavailable" });
    }
    const headers = request.headers as Record<string, string | undefined>;
    if (!gatewayEntry.adapter.verifyRequest(rawBody, headers)) {
      return reply.code(401).send({ error: "Invalid signature" });
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
      const orgId = gatewayEntry.orgId;
      // Attribute the lead to the org's Alex AgentDeployment (mirroring the Meta
      // Instant-Form path) so it lands on Alex's per-deployment ActivityLog feed
      // (listByDeployment). lead.intake is platform-direct, so this payload
      // deploymentId is the sole attribution source - the channel-connection id
      // would silently miss Alex's feed. Fall back to the connection id (and warn)
      // if Alex can't be resolved: never drop a paid lead.
      let leadDeploymentId = gatewayEntry.deploymentConnectionId;
      if (deps.deploymentResolver) {
        try {
          const alex = await deps.deploymentResolver.resolveByOrgAndSlug(orgId, "alex");
          leadDeploymentId = alex.deploymentId;
        } catch (err: unknown) {
          console.warn("[managed-webhook] CTWA Alex resolution failed; using connection id", {
            err,
            organizationId: orgId,
            connectionId: gatewayEntry.deploymentConnectionId,
          });
        }
      }
      void deps.ctwaAdapter
        .ingest({
          from: incoming.principalId,
          metadata: incoming.metadata,
          organizationId: orgId,
          deploymentId: leadDeploymentId,
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
          // Stable channel user identity (Slack U..., Telegram from.id, WhatsApp
          // phone). Approval responses bind on this; conversations key on sessionId.
          principalId: incoming.principalId,
          text: incoming.text,
          providerMessageId: rawMessageId ?? undefined,
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
