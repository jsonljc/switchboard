import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { WhatsAppAdapter } from "../whatsapp.js";
import { registerManagedWebhookRoutes } from "../../routes/managed-webhook.js";
import type { GatewayEntry } from "../../managed/runtime-registry.js";
import { checkDedup } from "../../dedup/redis-dedup.js";

/**
 * AU-1: A captured Meta webhook must not produce duplicate downstream calls
 * when replayed. The chat server uses a (channel, messageId) deduplication
 * cache (`apps/chat/src/dedup/redis-dedup.ts`) wired into the managed
 * webhook route (`apps/chat/src/routes/managed-webhook.ts`).
 */

const APP_SECRET = "test_secret_wa_replay";
const WEBHOOK_ID = "wa-replay";
const WEBHOOK_PATH = `/webhook/managed/${WEBHOOK_ID}`;
const SENDER_PHONE = "6591110000";

function buildPayload(messageId: string): Record<string, unknown> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
              contacts: [{ profile: { name: "Replay Test" }, wa_id: SENDER_PHONE }],
              messages: [
                {
                  from: SENDER_PHONE,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: "replay payload" },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("WhatsApp webhook replay protection (AU-1)", () => {
  let app: FastifyInstance;
  const handleIncoming = vi.fn(async () => {});
  // Unique prefix per run avoids cross-test pollution in the in-memory dedup
  // FIFO (the production fallback path when Redis is not initialised).
  const RUN_PREFIX = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const adapter = new WhatsAppAdapter({
      token: "test_token",
      phoneNumberId: "123456789",
      appSecret: APP_SECRET,
    });

    const stubAdapter = Object.create(adapter) as typeof adapter;
    stubAdapter.sendTextReply = vi.fn(async () => {});
    stubAdapter.markAsRead = vi.fn(async () => {});

    const gatewayEntry: GatewayEntry = {
      gateway: { handleIncoming } as never,
      adapter: stubAdapter,
      deploymentConnectionId: "conn-wa-replay",
      channel: "whatsapp",
    };

    const registry = {
      getGatewayByWebhookPath(path: string) {
        return path === WEBHOOK_PATH ? gatewayEntry : null;
      },
    };

    // Use the real dedup module so this test exercises the same code path as
    // production. Without `initDedup()`, `checkDedup` falls back to its
    // in-memory FIFO — which is exactly what we want to validate here.
    app = Fastify({ logger: false });
    registerManagedWebhookRoutes(app, { registry, dedup: { checkDedup } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("invokes the gateway exactly once when the same messageId is delivered twice", async () => {
    handleIncoming.mockClear();

    const payload = buildPayload(`wamid.${RUN_PREFIX}_001`);
    const body = JSON.stringify(payload);
    const headers = { "x-hub-signature-256": signBody(body, APP_SECRET) };

    const first = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });
    const second = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledTimes(1);
  });

  it("processes distinct messageIds independently", async () => {
    handleIncoming.mockClear();

    const headers = (body: string) => ({ "x-hub-signature-256": signBody(body, APP_SECRET) });

    const payloadA = buildPayload(`wamid.${RUN_PREFIX}_002a`);
    const payloadB = buildPayload(`wamid.${RUN_PREFIX}_002b`);

    await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload: payloadA,
      headers: headers(JSON.stringify(payloadA)),
    });
    await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload: payloadB,
      headers: headers(JSON.stringify(payloadB)),
    });

    expect(handleIncoming).toHaveBeenCalledTimes(2);
  });
});
