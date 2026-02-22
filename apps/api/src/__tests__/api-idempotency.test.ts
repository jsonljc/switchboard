import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";
import { MemoryBackend } from "../middleware/idempotency.js";

describe("Idempotency Middleware", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  const proposePayload = {
    actionType: "ads.campaign.pause",
    parameters: { campaignId: "camp_123" },
    principalId: "default",
    cartridgeId: "ads-spend",
  };

  it("returns cached response for duplicate POST with same Idempotency-Key", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "key-1" },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "key-1" },
      payload: proposePayload,
    });

    // Cached response preserves original status code
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(firstBody);
  });

  it("does not cache GET requests", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "idempotency-key": "key-get" },
    });

    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "idempotency-key": "key-get" },
    });

    // Both are fresh responses (not cached — GET is excluded)
    expect(second.statusCode).toBe(200);
  });

  it("does not cache POST requests without Idempotency-Key header", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      payload: proposePayload,
    });

    // Both get fresh 201 responses with different envelope IDs
    expect(second.statusCode).toBe(201);
    expect(second.json().envelope.id).not.toBe(firstBody.envelope.id);
  });

  it("different keys get independent responses", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "key-a" },
      payload: proposePayload,
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "key-b" },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // Different keys produce different envelopes
    expect(first.json().envelope.id).not.toBe(second.json().envelope.id);
  });

  it("MemoryBackend expires entries after TTL", async () => {
    const backend = new MemoryBackend();

    await backend.set("test-key", '{"data":"cached"}', 1000);

    // Before expiry: value is returned
    const before = await backend.get("test-key");
    expect(before).toBe('{"data":"cached"}');

    // Advance Date.now past the TTL
    const originalNow = Date.now;
    Date.now = () => originalNow() + 1001;
    try {
      const after = await backend.get("test-key");
      expect(after).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });
});
