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

  // The idempotency fingerprint derives org/actor from request.organizationIdFromAuth /
  // principalIdFromAuth. Since #575, buildDevAuthFallback runs as a global preHandler
  // BEFORE the idempotency middleware (mirroring production auth ordering), so those
  // fields are resolved (from x-org-id / x-principal-id, default "default") at both the
  // check-time preHandler and the store-time onSend. The fingerprint is therefore stable
  // across legs without the old x-organization-id band-aid; tests just send x-org-id.
  const ORG_HEADER = { "x-org-id": "default", "x-principal-id": "default" };

  // Regression for #575: in dev/test the identity is resolved by the global
  // buildDevAuthFallback (registered before the idempotency middleware, mirroring
  // production auth ordering) reading x-org-id / x-principal-id. The replay must
  // return the cached response WITHOUT the x-organization-id fingerprint band-aid.
  // Before the fix the route-scoped fallback ran after the idempotency check, so the
  // identity was unset at check-time but resolved at store-time → fingerprint
  // mismatch → 409. The dev convention sends both identity headers (as production
  // auth populates both org and actor before idempotency).
  it("dedupes replay when identity resolves via x-org-id/x-principal-id (no x-organization-id band-aid)", async () => {
    const headers = {
      "idempotency-key": "ordering-fix-key",
      "x-org-id": "default",
      "x-principal-id": "default",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers,
      payload: proposePayload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers,
      payload: proposePayload,
    });

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
  });

  // Regression for #575 (follow-up): a dev/test replay with NO identity headers must
  // still dedupe. The route-scoped buildDevAuthFallback defaults org/actor to "default"
  // AFTER the idempotency check; the middleware now stashes the CHECK-time fingerprint
  // and reuses it at store, so check and store are symmetric by construction even when
  // identity is defaulted late. Before the stash fix the store leg recomputed the
  // fingerprint with the late-defaulted "default" values → mismatch → spurious 409.
  it("dedupes replay with no identity headers (late-defaulted org/actor stay symmetric)", async () => {
    const headers = { "idempotency-key": "headerless-replay-key" };

    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers,
      payload: proposePayload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers,
      payload: proposePayload,
    });

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
  });

  it("returns cached response for duplicate POST with same Idempotency-Key", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "key-1", ...ORG_HEADER },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "key-1", ...ORG_HEADER },
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

  it("does not overwrite cached entry when a mismatch 409 is returned", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "overwrite-test-key", ...ORG_HEADER },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    // Trigger a 409 mismatch with a different route
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/execute",
      headers: { "idempotency-key": "overwrite-test-key", ...ORG_HEADER },
      payload: {
        actorId: "default",
        organizationId: "default",
        action: {
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: "camp_mismatch" },
          sideEffect: true,
        },
      },
    });

    expect(mismatch.statusCode).toBe(409);

    // Original replay should still work after the mismatch
    const replay = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: { "idempotency-key": "overwrite-test-key", ...ORG_HEADER },
      payload: proposePayload,
    });

    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(firstBody);
  });

  it("returns 409 when the same key is used by a different org", async () => {
    // The fingerprint reads request.organizationIdFromAuth, resolved by the global
    // buildDevAuthFallback from x-org-id (#575). Two requests with the same key but a
    // different x-org-id resolve to distinct orgs → distinct fingerprints → 409. This
    // proves cross-tenant safety through the real identity path (the cache key itself is
    // only the bare idempotency-key, so org in the fingerprint is the cross-tenant guard).
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: {
        "idempotency-key": "cross-org-key",
        "x-org-id": "org_alpha",
      },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);

    // Same key, same payload, different org
    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: {
        "idempotency-key": "cross-org-key",
        "x-org-id": "org_beta",
      },
      payload: proposePayload,
    });

    // Different org = different fingerprint = 409 mismatch
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain("Idempotency-Key");
  });

  it("returns 409 when the same key is used by a different principal", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: {
        "idempotency-key": "cross-actor-key",
        "x-principal-id": "user_alice",
      },
      payload: proposePayload,
    });

    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/actions/propose",
      headers: {
        "idempotency-key": "cross-actor-key",
        "x-principal-id": "user_bob",
      },
      payload: proposePayload,
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
