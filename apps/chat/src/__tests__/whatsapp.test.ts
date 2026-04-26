import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";
import { registerManagedWebhookRoutes, type CtwaAdapterLike } from "../routes/managed-webhook.js";
import type { GatewayEntry } from "../managed/runtime-registry.js";

describe("WhatsAppAdapter", () => {
  const adapter = new WhatsAppAdapter({
    token: "test_token",
    phoneNumberId: "123456789",
    appSecret: "test_secret",
    verifyToken: "verify_me",
  });

  describe("parseIncomingMessage", () => {
    it("should parse WhatsApp text message payload", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: { display_phone_number: "1234567890", phone_number_id: "123456789" },
                  contacts: [{ profile: { name: "John Doe" }, wa_id: "15551234567" }],
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.abc123",
                      timestamp: "1700000000",
                      text: { body: "Pause campaign ABC" },
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

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("Pause campaign ABC");
      expect(msg!.principalId).toBe("15551234567");
      expect(msg!.channel).toBe("whatsapp");
      expect(msg!.threadId).toBe("15551234567");
      expect(msg!.id).toBe("wamid.abc123");
    });

    it("should parse image as media message with attachment", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.abc123",
                      type: "image",
                      image: { id: "img_123" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg?.text).toBe("");
      expect(msg?.metadata?.["originalType"]).toBe("image");
      expect(msg?.metadata?.["mediaId"]).toBe("img_123");
      expect(msg?.attachments).toHaveLength(1);
    });

    it("should return null for empty payload", () => {
      expect(adapter.parseIncomingMessage(null)).toBeNull();
      expect(adapter.parseIncomingMessage({})).toBeNull();
      expect(adapter.parseIncomingMessage({ entry: [] })).toBeNull();
    });
  });

  describe("verifyRequest", () => {
    it("should verify valid HMAC-SHA256 signature", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const { createHmac } = require("node:crypto");
      const body = '{"test": true}';
      const sig = "sha256=" + createHmac("sha256", "test_secret").update(body).digest("hex");

      const result = adapter.verifyRequest(body, { "x-hub-signature-256": sig });
      expect(result).toBe(true);
    });

    it("should reject invalid signature", () => {
      const result = adapter.verifyRequest('{"test": true}', {
        "x-hub-signature-256": "sha256=invalid",
      });
      expect(result).toBe(false);
    });

    it("should reject missing signature", () => {
      const result = adapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
    });

    it("should fail closed when no app secret configured", () => {
      const noSecretAdapter = new WhatsAppAdapter({
        token: "test_token",
        phoneNumberId: "123456789",
      });
      const result = noSecretAdapter.verifyRequest('{"test": true}', {});
      expect(result).toBe(false);
    });
  });

  describe("interactive message parsing", () => {
    it("should parse interactive button_reply messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Jane" }, wa_id: "15559876543" }],
                  messages: [
                    {
                      from: "15559876543",
                      id: "wamid.btn123",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "button_reply",
                        button_reply: {
                          id: '{"action":"approve","approvalId":"appr_1","bindingHash":"abc"}',
                          title: "Approve",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe('{"action":"approve","approvalId":"appr_1","bindingHash":"abc"}');
      expect(msg!.principalId).toBe("15559876543");
      expect(msg!.metadata).toHaveProperty("interactiveType", "button_reply");
    });

    it("should parse interactive list_reply messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "15559876543",
                      id: "wamid.list123",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "list_reply",
                        list_reply: { id: "option_1", title: "Option 1" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.text).toBe("option_1");
    });
  });

  describe("handleVerification", () => {
    it("should respond to valid verification challenge", () => {
      const result = adapter.handleVerification({
        "hub.mode": "subscribe",
        "hub.verify_token": "verify_me",
        "hub.challenge": "challenge_123",
      });

      expect(result.status).toBe(200);
      expect(result.body).toBe("challenge_123");
    });

    it("should reject invalid verify token", () => {
      const result = adapter.handleVerification({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": "challenge_123",
      });

      expect(result.status).toBe(403);
    });
  });

  describe("extractMessageId", () => {
    it("should extract message ID from webhook payload", () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: "wamid.test123" }],
                },
              },
            ],
          },
        ],
      };

      expect(adapter.extractMessageId(payload)).toBe("wamid.test123");
    });
  });

  describe("referral extraction", () => {
    it("should extract referral data from text messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Ad User" }, wa_id: "15551112222" }],
                  messages: [
                    {
                      from: "15551112222",
                      id: "wamid.ref001",
                      timestamp: "1700000000",
                      text: { body: "Hi from ad" },
                      type: "text",
                      referral: {
                        source_id: "ad_123456",
                        source_type: "ad",
                        headline: "Book Now",
                        body: "50% off first visit",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata).toHaveProperty("sourceAdId", "ad_123456");
      expect(msg!.metadata).toHaveProperty("adSourceType", "ad");
      expect(msg!.metadata).toHaveProperty("adHeadline", "Book Now");
      expect(msg!.metadata).toHaveProperty("adBody", "50% off first visit");
      expect(msg!.metadata).toHaveProperty("contactName", "Ad User");
    });

    it("should extract referral data from interactive messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Jane" }, wa_id: "15559876543" }],
                  messages: [
                    {
                      from: "15559876543",
                      id: "wamid.ref_btn",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "button_reply",
                        button_reply: { id: "yes", title: "Yes" },
                      },
                      referral: {
                        source_id: "ad_789",
                        source_type: "post",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata).toHaveProperty("sourceAdId", "ad_789");
      expect(msg!.metadata).toHaveProperty("adSourceType", "post");
      expect(msg!.metadata).toHaveProperty("contactName", "Jane");
      expect(msg!.metadata).toHaveProperty("interactiveType", "button_reply");
    });

    it("should extract ctwa_clid and source_url from CTWA referral", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "CTWA User" }, wa_id: "6591234567" }],
                  messages: [
                    {
                      from: "6591234567",
                      id: "wamid.ctwa001",
                      timestamp: "1700000000",
                      text: { body: "hi" },
                      type: "text",
                      referral: {
                        source_id: "120000000",
                        source_type: "ad",
                        source_url: "https://fb.me/abc",
                        ctwa_clid: "ARxx_clickid_abc",
                        headline: "Book now",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata).toHaveProperty("ctwaClid", "ARxx_clickid_abc");
      expect(msg!.metadata).toHaveProperty("ctwaSourceUrl", "https://fb.me/abc");
      expect(msg!.metadata).toHaveProperty("sourceAdId", "120000000");
    });

    it("should omit ctwaClid when referral lacks it", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "6591234567",
                      id: "wamid.noctwa",
                      timestamp: "1700000000",
                      text: { body: "hi" },
                      type: "text",
                      referral: {
                        source_id: "ad_123",
                        source_type: "ad",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata["ctwaClid"]).toBeUndefined();
      expect(msg!.metadata["ctwaSourceUrl"]).toBeUndefined();
    });

    it("should not include referral fields when referral is absent", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.noref",
                      timestamp: "1700000000",
                      text: { body: "Normal message" },
                      type: "text",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata).not.toHaveProperty("sourceAdId");
      expect(msg!.metadata).not.toHaveProperty("adSourceType");
    });
  });

  describe("markAsRead", () => {
    it("should send read receipt to WhatsApp API", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

      await adapter.markAsRead("wamid.abc123");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(url).toContain("/123456789/messages");
      const body = JSON.parse(options!.body as string);
      expect(body).toEqual({
        messaging_product: "whatsapp",
        status: "read",
        message_id: "wamid.abc123",
      });

      fetchSpy.mockRestore();
    });
  });
});

describe("WhatsApp managed webhook — CTWA adapter wiring", () => {
  const APP_SECRET = "ctwa_test_secret";
  const WEBHOOK_ID = "wa-ctwa-1";
  const WEBHOOK_PATH = `/webhook/managed/${WEBHOOK_ID}`;
  const ORG_ID = "org_test_ctwa";
  const CONNECTION_ID = "conn_wa_ctwa";
  const SENDER_PHONE = "6591234567";
  let app: FastifyInstance;
  const ingest = vi.fn<CtwaAdapterLike["ingest"]>(async () => {});
  const handleIncoming = vi.fn(async () => {});

  function buildPayload(referral?: Record<string, unknown>): Record<string, unknown> {
    const message: Record<string, unknown> = {
      from: SENDER_PHONE,
      id: `wamid.ctwa-${Date.now()}-${Math.random()}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      text: { body: "Hi from the ad" },
      type: "text",
    };
    if (referral) message["referral"] = referral;
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: { display_phone_number: "1", phone_number_id: "2" },
                contacts: [{ profile: { name: "Lead" }, wa_id: SENDER_PHONE }],
                messages: [message],
              },
              field: "messages",
            },
          ],
        },
      ],
    };
  }

  function sign(body: string): string {
    return "sha256=" + createHmac("sha256", APP_SECRET).update(body).digest("hex");
  }

  beforeAll(async () => {
    const adapter = new WhatsAppAdapter({
      token: "t",
      phoneNumberId: "2",
      appSecret: APP_SECRET,
    });
    const spied = Object.create(adapter);
    spied.sendTextReply = vi.fn(async () => {});
    spied.markAsRead = vi.fn(async () => {});

    const gatewayEntry: GatewayEntry = {
      gateway: { handleIncoming } as never,
      adapter: spied,
      deploymentConnectionId: CONNECTION_ID,
      channel: "whatsapp",
      orgId: ORG_ID,
    };
    const registry = {
      getGatewayByWebhookPath: (path: string) => (path === WEBHOOK_PATH ? gatewayEntry : null),
    };

    app = Fastify({ logger: false });
    registerManagedWebhookRoutes(app, {
      registry,
      ctwaAdapter: { ingest },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("invokes CtwaAdapter.ingest for messages with ctwa_clid", async () => {
    ingest.mockClear();
    handleIncoming.mockClear();

    const payload = buildPayload({
      source_id: "ad_1",
      source_type: "ad",
      source_url: "https://fb.me/abc",
      ctwa_clid: "ARxx_test_clid",
    });
    const body = JSON.stringify(payload);
    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": sign(body) },
    });

    expect(response.statusCode).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
    const [arg] = ingest.mock.calls[0]!;
    expect(arg).toMatchObject({
      from: SENDER_PHONE,
      organizationId: ORG_ID,
      deploymentId: CONNECTION_ID,
    });
    expect(arg.metadata).toMatchObject({ ctwaClid: "ARxx_test_clid" });
    // Existing dispatch must still happen — CTWA wiring does not short-circuit.
    expect(handleIncoming).toHaveBeenCalledOnce();
  });

  it("does NOT call CtwaAdapter.ingest for messages without ctwa_clid", async () => {
    ingest.mockClear();
    handleIncoming.mockClear();

    const payload = buildPayload(); // no referral at all
    const body = JSON.stringify(payload);
    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": sign(body) },
    });

    expect(response.statusCode).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(handleIncoming).toHaveBeenCalledOnce();
  });

  it("does NOT call CtwaAdapter.ingest when referral is present but ctwa_clid is missing", async () => {
    ingest.mockClear();

    const payload = buildPayload({ source_id: "ad_2", source_type: "ad" });
    const body = JSON.stringify(payload);
    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": sign(body) },
    });

    expect(response.statusCode).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("does not block the message flow when CTWA ingest rejects", async () => {
    ingest.mockClear();
    handleIncoming.mockClear();
    // Pending promise that never resolves — verifies fire-and-forget.
    ingest.mockImplementationOnce(() => new Promise(() => {}));

    const payload = buildPayload({
      source_id: "ad_3",
      source_type: "ad",
      ctwa_clid: "ARxx_pending_clid",
    });
    const body = JSON.stringify(payload);
    const response = await app.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      payload,
      headers: { "x-hub-signature-256": sign(body) },
    });

    expect(response.statusCode).toBe(200);
    expect(handleIncoming).toHaveBeenCalledOnce();
  });
});
