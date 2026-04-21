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
    actionType: "digital-ads.campaign.pause",
    parameters: { campaignId: "camp_123" },
    principalId: "default",
    cartridgeId: "digital-ads",
    organizationId: "default",
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

    // Without Idempotency-Key header, the propose endpoint now returns 400
    expect(first.statusCode).toBe(400);

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      payload: proposePayload,
    });

    // Both get fresh 400 responses
    expect(second.statusCode).toBe(400);
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
    // Different keys produce different work units
    expect(first.json().workUnitId).not.toBe(second.json().workUnitId);
  });

  it("returns 409 when the same key is used on a different route", async () => {
    const propose = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "cross-route-key" },
      payload: proposePayload,
    });

    expect(propose.statusCode).toBe(201);

    const execute = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "idempotency-key": "cross-route-key" },
      payload: {
        actorId: "default",
        organizationId: "default",
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_execute" },
          sideEffect: true,
        },
      },
    });

    expect(execute.statusCode).toBe(409);
    expect(execute.json().error).toContain("Idempotency-Key");
  });

  it("returns 409 when the same key is used with a different payload", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "same-key-diff-body" },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "same-key-diff-body" },
      payload: {
        ...proposePayload,
        parameters: { campaignId: "camp_changed" },
      },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain("Idempotency-Key");
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
