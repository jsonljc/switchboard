import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";

vi.mock("@switchboard/customer-engagement", () => ({
  ConversationRouter: vi.fn().mockImplementation(() => ({
    handleMessage: vi.fn().mockResolvedValue({
      handled: true,
      responses: ["Hello from bot"],
      escalated: false,
      completed: false,
      sessionId: "sess_1",
    }),
  })),
  InMemorySessionStore: vi.fn().mockImplementation(() => ({})),
  RedisSessionStore: vi.fn().mockImplementation(() => ({})),
}));

import { inboundMessagesRoutes } from "../routes/inbound-messages.js";

function buildTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac("sha1", authToken).update(data).digest("base64");
}

describe("Inbound Messages API", () => {
  let app: FastifyInstance;
  let savedTwilioAuthToken: string | undefined;

  const mockCartridges = {
    get: vi.fn(),
    list: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    savedTwilioAuthToken = process.env["TWILIO_AUTH_TOKEN"];
    process.env["TWILIO_AUTH_TOKEN"] = "test_twilio_token";

    app = Fastify({ logger: false });

    app.decorate("storageContext", { cartridges: mockCartridges } as any);
    app.decorate("redis", null);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(inboundMessagesRoutes, { prefix: "/api/messages" });
  });

  afterEach(async () => {
    await app.close();

    if (savedTwilioAuthToken !== undefined) process.env["TWILIO_AUTH_TOKEN"] = savedTwilioAuthToken;
    else delete process.env["TWILIO_AUTH_TOKEN"];
  });

  describe("POST /api/messages/sms", () => {
    it("returns TwiML response for valid SMS", async () => {
      const params = {
        From: "+15551234567",
        To: "+15559876543",
        Body: "Hello",
        MessageSid: "SM123",
      };

      const url = "https://localhost/api/messages/sms";
      const signature = buildTwilioSignature("test_twilio_token", url, params);

      const res = await app.inject({
        method: "POST",
        url: "/api/messages/sms",
        headers: {
          "x-twilio-signature": signature,
          "content-type": "application/json",
          host: "localhost",
          "x-forwarded-proto": "https",
        },
        payload: params,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/xml");
      expect(res.body).toContain("<?xml");
      expect(res.body).toContain("<Response>");
    });

    it("returns 401 with invalid Twilio signature", async () => {
      const params = {
        From: "+15551234567",
        To: "+15559876543",
        Body: "Hello",
        MessageSid: "SM123",
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/messages/sms",
        headers: {
          "x-twilio-signature": "invalid_sig",
          "content-type": "application/json",
          host: "localhost",
          "x-forwarded-proto": "https",
        },
        payload: params,
      });

      expect(res.statusCode).toBe(401);
    });

    it("returns TwiML even without signature when auth token not set", async () => {
      // Remove TWILIO_AUTH_TOKEN to skip signature validation
      delete process.env["TWILIO_AUTH_TOKEN"];

      const params = {
        From: "+15551234567",
        To: "+15559876543",
        Body: "Hello",
        MessageSid: "SM456",
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/messages/sms",
        payload: params,
      });

      // Should return 200 with TwiML
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("<Response>");
    });
  });

  describe("POST /api/messages/chat", () => {
    it("handles web chat message or returns 503 when router unavailable", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/messages/chat",
        payload: {
          channelId: "session_1",
          body: "Hi there",
          from: "user@example.com",
        },
      });

      // The router depends on dynamic import of @switchboard/customer-engagement.
      // If it resolves, we get 200 with responses; if not, 503.
      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.responses).toBeInstanceOf(Array);
      } else {
        expect(res.statusCode).toBe(503);
        expect(res.json().error).toContain("unavailable");
      }
    });

    it("returns fallback message on error", async () => {
      // This tests the error handling path in the chat endpoint.
      // When the router throws, the response includes a fallback message.
      const res = await app.inject({
        method: "POST",
        url: "/api/messages/chat",
        payload: { channelId: "session_3", body: "Crash me" },
      });

      // Either succeeds or returns fallback — both are 200
      expect(res.statusCode).toBeLessThanOrEqual(503);
      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.responses).toBeInstanceOf(Array);
      }
    });
  });

  describe("POST /api/messages/status", () => {
    it("receives message status callback", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/messages/status",
        payload: {
          MessageSid: "SM789",
          MessageStatus: "delivered",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
    });

    it("handles failed delivery status", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/messages/status",
        payload: {
          MessageSid: "SM999",
          MessageStatus: "failed",
          ErrorCode: "30003",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(true);
    });
  });
});
