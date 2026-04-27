import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";
import {
  registerManagedWebhookRoutes,
  type ManagedWebhookDeps,
} from "../routes/managed-webhook.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";

const APP_SECRET = "test_secret";
const VERIFY_TOKEN = "verify_me";
const WEBHOOK_ID = "wa-test-123";
const WEBHOOK_PATH = `/webhook/managed/${WEBHOOK_ID}`;
const SENDER_PHONE = "6591234567";
const MESSAGE_TEXT = "Hi, I saw your ad";
const REPLY_TEXT = "Hello from Alex";

function buildTextPayload(from: string, text: string): Record<string, unknown> {
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
              contacts: [{ profile: { name: "Test User" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: "wamid.test123",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
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

describe("managed-webhook external contract pin", () => {
  // External contract pinned: /webhook/managed/:connectionId
  // Mirrored regex in apps/api/src/lib/__tests__/managed-webhook-path.test.ts.
  // Duplication is intentional; do not introduce a cross-app import.
  const MANAGED_WEBHOOK_PATH_REGEX = /^\/webhook\/managed\/[a-zA-Z0-9_-]+$/;

  it("conforms to the contract regex (chat side)", () => {
    expect("/webhook/managed/conn_abc12345").toMatch(MANAGED_WEBHOOK_PATH_REGEX);
    expect("/webhook/managed/conn_xyz789").toMatch(MANAGED_WEBHOOK_PATH_REGEX);
    expect("/webhook/managed/").not.toMatch(MANAGED_WEBHOOK_PATH_REGEX); // empty id rejected
    expect("/webhooks/managed/x").not.toMatch(MANAGED_WEBHOOK_PATH_REGEX); // wrong prefix rejected
  });
});

describe("WhatsApp wiring — managed webhook", () => {
  let app: FastifyInstance;
  const handleIncoming = vi.fn(async (_msg, replySink) => {
    await replySink.send(REPLY_TEXT);
  });
  let sendTextReply: ReturnType<typeof vi.fn>;
  const seenMessages = new Set<string>();
  const onStatusUpdate: ReturnType<
    typeof vi.fn<NonNullable<ManagedWebhookDeps["onStatusUpdate"]>>
  > = vi.fn(async () => {});

  beforeAll(async () => {
    const adapter = new WhatsAppAdapter({
      token: "test_token",
      phoneNumberId: "123456789",
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
    });

    sendTextReply = vi.fn(async () => {
      // Stub implementation - no actual HTTP call, no delay
    });

    const spiedAdapter = Object.create(adapter);
    spiedAdapter.sendTextReply = sendTextReply;

    const gatewayEntry: GatewayEntry = {
      gateway: { handleIncoming } as never,
      adapter: spiedAdapter,
      deploymentConnectionId: "conn-wa-123",
      channel: "whatsapp",
    };

    const registry = {
      getGatewayByWebhookPath(path: string) {
        return path === WEBHOOK_PATH ? gatewayEntry : null;
      },
    };

    const dedup = {
      async checkDedup(_channel: string, messageId: string): Promise<boolean> {
        const key = `${_channel}:${messageId}`;
        if (seenMessages.has(key)) return false;
        seenMessages.add(key);
        return true;
      },
    };

    app = Fastify({ logger: false });
    registerManagedWebhookRoutes(app, { registry, onStatusUpdate, dedup });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("routes signed text message through gateway", async () => {
    const payload = buildTextPayload(SENDER_PHONE, MESSAGE_TEXT);
    const body = JSON.stringify(payload);
    const signature = signBody(body, APP_SECRET);

    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": signature },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    expect(handleIncoming).toHaveBeenCalledOnce();
    const [msg] = handleIncoming.mock.calls[0]!;
    expect(msg).toMatchObject({
      channel: "whatsapp",
      sessionId: SENDER_PHONE,
      text: MESSAGE_TEXT,
      token: "conn-wa-123",
    });

    expect(sendTextReply).toHaveBeenCalledOnce();
    expect(sendTextReply).toHaveBeenCalledWith(SENDER_PHONE, REPLY_TEXT);
  });

  it("returns verification challenge", async () => {
    const response = await app.inject({
      method: "GET",
      url: WEBHOOK_PATH,
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "challenge_abc",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("challenge_abc");
  });

  it("rejects bad signature before reaching gateway", async () => {
    handleIncoming.mockClear();

    const payload = buildTextPayload(SENDER_PHONE, MESSAGE_TEXT);

    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": "sha256=wrong" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid signature" });
    expect(handleIncoming).not.toHaveBeenCalled();
  });

  it("deduplicates repeated WhatsApp webhooks", async () => {
    handleIncoming.mockClear();
    seenMessages.clear();

    const payload = buildTextPayload(SENDER_PHONE, "duplicate test");
    const body = JSON.stringify(payload);
    const signature = signBody(body, APP_SECRET);
    const headers = { "x-hub-signature-256": signature };

    // First request should process
    const res1 = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });
    expect(res1.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledOnce();

    handleIncoming.mockClear();

    // Second request with same payload should be deduped
    const res2 = await app.inject({ method: "POST", url: WEBHOOK_PATH, payload, headers });
    expect(res2.statusCode).toBe(200);
    expect(handleIncoming).not.toHaveBeenCalled();
  });

  it("handles status webhook without dispatching to gateway", async () => {
    handleIncoming.mockClear();
    onStatusUpdate.mockClear();

    const statusPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
                statuses: [
                  {
                    id: "wamid.status1",
                    recipient_id: SENDER_PHONE,
                    status: "delivered",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const body = JSON.stringify(statusPayload);
    const signature = signBody(body, APP_SECRET);

    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload: statusPayload,
      headers: { "x-hub-signature-256": signature },
    });

    expect(response.statusCode).toBe(200);
    expect(handleIncoming).not.toHaveBeenCalled();
    expect(onStatusUpdate).toHaveBeenCalledOnce();
    expect(onStatusUpdate.mock.calls[0]![0]).toMatchObject({
      messageId: "wamid.status1",
      recipientId: SENDER_PHONE,
      status: "delivered",
    });
  });
});
