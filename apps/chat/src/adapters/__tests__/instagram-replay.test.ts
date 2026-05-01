import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { InstagramAdapter } from "../instagram.js";
import { registerManagedWebhookRoutes } from "../../routes/managed-webhook.js";
import type { GatewayEntry } from "../../managed/runtime-registry.js";

/**
 * AU-1: Same replay-protection guarantee as WhatsApp, applied to the Instagram /
 * Messenger adapter. Both share the Meta `entry[].messaging[]` webhook shape
 * and route through `registerManagedWebhookRoutes`.
 */

const APP_SECRET = "test_secret_ig_replay";
const WEBHOOK_ID = "ig-replay";
const WEBHOOK_PATH = `/webhook/managed/${WEBHOOK_ID}`;
const SENDER_PSID = "ig_user_1";

function buildPayload(mid: string): Record<string, unknown> {
  return {
    object: "instagram",
    entry: [
      {
        id: "page_replay",
        time: 1700000000,
        messaging: [
          {
            sender: { id: SENDER_PSID },
            recipient: { id: "page_replay" },
            timestamp: 1700000000000,
            message: {
              mid,
              text: "replay payload",
            },
          },
        ],
      },
    ],
  };
}

function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("Instagram webhook replay protection (AU-1)", () => {
  let app: FastifyInstance;
  const handleIncoming = vi.fn(async () => {});
  const seenMessages = new Set<string>();

  beforeAll(async () => {
    const adapter = new InstagramAdapter({
      pageAccessToken: "test_page_token",
      appSecret: APP_SECRET,
      channel: "instagram",
    });

    const stubAdapter = Object.create(adapter) as typeof adapter;
    stubAdapter.sendTextReply = vi.fn(async () => {});

    const gatewayEntry: GatewayEntry = {
      gateway: { handleIncoming } as never,
      adapter: stubAdapter,
      deploymentConnectionId: "conn-ig-replay",
      channel: "instagram",
    };

    const registry = {
      getGatewayByWebhookPath(path: string) {
        return path === WEBHOOK_PATH ? gatewayEntry : null;
      },
    };

    const dedup = {
      async checkDedup(channel: string, messageId: string): Promise<boolean> {
        const key = `${channel}:${messageId}`;
        if (seenMessages.has(key)) return false;
        seenMessages.add(key);
        return true;
      },
    };

    app = Fastify({ logger: false });
    registerManagedWebhookRoutes(app, { registry, dedup });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("invokes the gateway exactly once when the same Instagram mid is delivered twice", async () => {
    handleIncoming.mockClear();
    seenMessages.clear();

    const payload = buildPayload("m_replay_001");
    const body = JSON.stringify(payload);
    const headers = { "x-hub-signature-256": signBody(body, APP_SECRET) };

    const first = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });
    const second = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledTimes(1);
  });

  it("processes distinct mids independently", async () => {
    handleIncoming.mockClear();
    seenMessages.clear();

    const headers = (body: string) => ({ "x-hub-signature-256": signBody(body, APP_SECRET) });

    const payloadA = buildPayload("m_replay_002a");
    const payloadB = buildPayload("m_replay_002b");

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
