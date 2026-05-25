// apps/api/src/routes/__tests__/revenue-ingress.test.ts
// ---------------------------------------------------------------------------
// Integration tests for POST /api/:orgId/revenue — PlatformIngress migration
// (#654-B Task 6). Proves WorkTrace persistence, idempotency replay,
// missing-key rejection, and cross-tenant isolation.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";
import type { RevenueStore } from "@switchboard/core";
import type { LifecycleRevenueEvent } from "@switchboard/schemas";
import { buildTestServer } from "../../__tests__/test-server.js";
import { RECORD_REVENUE_INTENT } from "../../bootstrap/operator-intents.js";

function makeEvent(overrides: Partial<LifecycleRevenueEvent> = {}): LifecycleRevenueEvent {
  return {
    id: "rev_1",
    organizationId: "org_a",
    contactId: "c1",
    opportunityId: "opp_1",
    amount: 100,
    currency: "SGD",
    type: "payment",
    status: "confirmed",
    recordedBy: "owner",
    externalReference: null,
    verified: false,
    sourceCampaignId: null,
    sourceAdId: null,
    recordedAt: new Date("2026-05-25T00:00:00.000Z"),
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRevenueStore(recordImpl?: RevenueStore["record"]): RevenueStore {
  return {
    record: vi.fn(recordImpl ?? (async () => makeEvent())),
    findByOpportunity: vi.fn(async () => []),
    findByContact: vi.fn(async () => []),
    sumByOrg: vi.fn(async () => ({ totalAmount: 0, count: 0 })),
    sumByCampaign: vi.fn(async () => []),
  };
}

describe("POST /api/:orgId/revenue — PlatformIngress migration (#654-B)", () => {
  it("201 + WorkTrace + persistence + outbox: happy path records revenue and writes outbox", async () => {
    const revenueStore = makeRevenueStore();
    const outboxWriter = { write: vi.fn(async () => {}) };
    const { app } = await buildTestServer({ revenueStore, outboxWriter });
    const prevCount = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/revenue",
      headers: {
        "Idempotency-Key": "rev-happy-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { contactId: "c1", amount: 100 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { event: LifecycleRevenueEvent };
    // Response event matches the mock event returned by revenueStore.record
    expect(body.event).toMatchObject({
      id: "rev_1",
      organizationId: "org_a",
      contactId: "c1",
      amount: 100,
    });

    // revenueStore.record was called once with the correct parameters
    expect(revenueStore.record).toHaveBeenCalledTimes(1);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a", contactId: "c1", amount: 100 }),
    );

    // outboxWriter.write was called once with the expected arguments
    expect(outboxWriter.write).toHaveBeenCalledTimes(1);
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_rev_rev_1",
      "purchased",
      expect.objectContaining({
        type: "purchased",
        contactId: "c1",
        value: 100,
        source: "revenue-api",
        organizationId: "org_a",
      }),
    );

    // WorkTrace was persisted with the expected shape
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace).toBeDefined();
    expect(app.lastIngressTrace!.intent).toBe(RECORD_REVENUE_INTENT);
    expect(app.lastIngressTrace!.mode).toBe("operator_mutation");
    expect(app.lastIngressTrace!.outcome).toBe("completed");
    expect(app.lastIngressTrace!.organizationId).toBe("org_a");

    await app.close();
  });

  it("idempotency replay: second call with same key returns cached result; record called only once", async () => {
    const revenueStore = makeRevenueStore();
    const outboxWriter = { write: vi.fn(async () => {}) };
    const { app } = await buildTestServer({ revenueStore, outboxWriter });

    const idempotencyKey = "rev-idempotency-1";
    // The idempotency middleware fingerprint uses organizationIdFromAuth and
    // principalIdFromAuth, which are set by the route's preHandler AFTER the
    // global idempotency preHandler fires. Supplying x-organization-id and
    // x-principal-id ensures the fingerprint is stable across both calls (the
    // middleware falls back to these headers when the auth fields are not yet
    // set). x-org-id is also sent so buildDevAuthFallback populates
    // organizationIdFromAuth for the route itself.
    const commonHeaders = {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-org-id": "org_a",
      "x-organization-id": "org_a",
      "x-principal-id": "u1",
    };

    const first = await app.inject({
      method: "POST",
      url: "/api/org_a/revenue",
      headers: commonHeaders,
      payload: { contactId: "c1", amount: 100 },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { event: LifecycleRevenueEvent };

    const second = await app.inject({
      method: "POST",
      url: "/api/org_a/revenue",
      headers: commonHeaders,
      payload: { contactId: "c1", amount: 100 },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as { event: LifecycleRevenueEvent };

    // Cached replay returns the exact same payload
    expect(secondBody.event.id).toBe(firstBody.event.id);
    // revenueStore.record was called ONLY ONCE — dedup is enforced
    expect(revenueStore.record).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("missing Idempotency-Key → 400 missing_idempotency_key; record not called", async () => {
    const revenueStore = makeRevenueStore();
    const outboxWriter = { write: vi.fn(async () => {}) };
    const { app } = await buildTestServer({ revenueStore, outboxWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/revenue",
      headers: {
        "x-org-id": "org_a",
        "x-principal-id": "u1",
        // intentionally NO Idempotency-Key header
      },
      payload: { contactId: "c1", amount: 100 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "missing_idempotency_key" });
    expect(revenueStore.record).not.toHaveBeenCalled();

    await app.close();
  });

  it("cross-tenant isolation: auth org wins over path param; record uses auth org", async () => {
    const revenueStore = makeRevenueStore();
    const outboxWriter = { write: vi.fn(async () => {}) };
    const { app } = await buildTestServer({ revenueStore, outboxWriter });
    const prevCount = app.ingressTraceCount ?? 0;

    // Path param says org_b but auth header says org_a — auth must win
    const res = await app.inject({
      method: "POST",
      url: "/api/org_b/revenue",
      headers: {
        "Idempotency-Key": "rev-xtenant-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { contactId: "c1", amount: 100 },
    });

    expect(res.statusCode).toBe(201);

    // revenueStore.record was called with organizationId from auth (org_a), not path param (org_b)
    expect(revenueStore.record).toHaveBeenCalledTimes(1);
    expect(revenueStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_a" }),
    );

    // WorkTrace also attributed to auth org
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace?.organizationId).toBe("org_a");

    await app.close();
  });
});
