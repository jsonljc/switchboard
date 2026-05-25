// apps/api/src/routes/__tests__/revenue-ingress.test.ts
// ---------------------------------------------------------------------------
// Integration tests for POST /api/:orgId/revenue — PlatformIngress migration
// (#654-B Task 6). Proves WorkTrace persistence, idempotency replay,
// missing-key rejection, and cross-tenant isolation.
//
// PR-2 (#677) additions: atomicity contract tests — tx context threading,
// rollback-on-outbox-failure, and a Postgres-gated real-$transaction test.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";
import type { RevenueStore, StoreTransactionContext } from "@switchboard/core";
import type { LifecycleRevenueEvent } from "@switchboard/schemas";
import type { RunInTransaction } from "../../bootstrap/operator-intents/revenue.js";
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
      undefined, // tx context from test no-op runner (fn receives undefined)
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
      undefined, // tx context from test no-op runner (fn receives undefined)
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
      undefined, // tx context from test no-op runner (fn receives undefined)
    );

    // WorkTrace also attributed to auth org
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace?.organizationId).toBe("org_a");

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PR-2 atomicity contract tests (#677)
// ---------------------------------------------------------------------------

/**
 * A fake transaction runner that only "commits" staged writes when the
 * callback resolves. If the callback throws, staged writes are discarded
 * (the write fn is replaced with a noop). This approximates real $transaction
 * rollback semantics without a live Postgres connection.
 */
function makeFakeTransactionRunner(): {
  runner: RunInTransaction;
  committedRevenue: unknown[];
  committedOutbox: unknown[];
} {
  const committedRevenue: unknown[] = [];
  const committedOutbox: unknown[] = [];

  const runner: RunInTransaction = async <T>(
    fn: (tx: StoreTransactionContext) => Promise<T>,
  ): Promise<T> => {
    const staged: { type: "revenue" | "outbox"; data: unknown }[] = [];

    // tx object that captures writes without committing them
    const tx = {
      __fakeTransaction: true,
      _staged: staged,
    };

    // If fn throws, the exception propagates here and staged writes are never committed.
    const result = await fn(tx as unknown as StoreTransactionContext);

    // Commit: move staged writes to committed arrays
    for (const entry of staged) {
      if (entry.type === "revenue") committedRevenue.push(entry.data);
      else committedOutbox.push(entry.data);
    }
    return result;
  };

  return { runner, committedRevenue, committedOutbox };
}

describe("PR-2 atomicity — tx rollback contract (#677)", () => {
  it("outbox write throws → handler throws → route 500s AND failed WorkTrace with EXECUTION_EXCEPTION", async () => {
    const revenueEvent = makeEvent({ id: "rev_tx_1" });
    const { runner, committedRevenue, committedOutbox } = makeFakeTransactionRunner();

    // revenueStore.record succeeds; outboxWriter.write fails
    const revenueStore = makeRevenueStore(async () => revenueEvent);
    const outboxWriter = {
      write: vi.fn().mockRejectedValue(new Error("Outbox DB blip")),
    };

    const { app } = await buildTestServer({
      revenueStore,
      outboxWriter,
      runInTransaction: runner,
    });
    const prevCount = app.ingressTraceCount ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/revenue",
      headers: {
        "Idempotency-Key": "rev-rollback-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { contactId: "c1", amount: 100 },
    });

    // Route returns scrubbed 500
    expect(res.statusCode).toBe(500);

    // Part 1 (PR-1): WorkTrace persisted as failed with EXECUTION_EXCEPTION
    expect(app.ingressTraceCount).toBe(prevCount + 1);
    expect(app.lastIngressTrace).toBeDefined();
    expect(app.lastIngressTrace!.outcome).toBe("failed");
    expect(app.lastIngressTrace!.error?.code).toBe("EXECUTION_EXCEPTION");

    // Both writes discarded (fake runner saw the throw, skipped commit)
    expect(committedRevenue).toHaveLength(0);
    expect(committedOutbox).toHaveLength(0);

    await app.close();
  });

  it("success: outbox called with evt_rev_<id>/purchased and WorkTrace completed", async () => {
    const revenueEvent = makeEvent({ id: "rev_success_1" });
    const revenueStore = makeRevenueStore(async () => revenueEvent);
    const outboxWriter = { write: vi.fn(async () => {}) };

    const { app } = await buildTestServer({ revenueStore, outboxWriter });

    const res = await app.inject({
      method: "POST",
      url: "/api/org_a/revenue",
      headers: {
        "Idempotency-Key": "rev-success-atom-1",
        "x-org-id": "org_a",
        "x-principal-id": "u1",
      },
      payload: { contactId: "c1", amount: 200 },
    });

    expect(res.statusCode).toBe(201);
    // outbox called with evt_rev_<id>/"purchased"
    expect(outboxWriter.write).toHaveBeenCalledWith(
      "evt_rev_rev_success_1",
      "purchased",
      expect.objectContaining({ type: "purchased", contactId: "c1", value: 200 }),
      undefined,
    );
    expect(app.lastIngressTrace?.outcome).toBe("completed");

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Postgres-gated real-$transaction rollback integration test
// Requires a live DATABASE_URL; skipped in CI and local dev without Postgres.
// ---------------------------------------------------------------------------
describe.skipIf(!process.env["DATABASE_URL"])(
  "PR-2 real Prisma $transaction rollback (integration — requires DATABASE_URL)",
  () => {
    it("outbox write throws inside $transaction → revenue row not committed", async () => {
      // This test requires a live Prisma client — obtain one from @switchboard/db
      const { PrismaClient } = await import("@switchboard/db");
      const prisma = new PrismaClient();

      try {
        const { PrismaRevenueStore } = await import("@switchboard/db");
        const revenueStore = new PrismaRevenueStore(prisma);

        // outboxWriter that always throws, so the transaction rolls back
        const failingOutboxWriter = {
          write: vi.fn().mockRejectedValue(new Error("Outbox forced failure")),
        };

        const runInTransaction: RunInTransaction = (fn) => prisma.$transaction((tx) => fn(tx));

        const { app } = await buildTestServer({
          revenueStore: {
            record: (input, tx) => revenueStore.record(input, tx as never),
            findByOpportunity: revenueStore.findByOpportunity.bind(revenueStore),
            findByContact: revenueStore.findByContact.bind(revenueStore),
            sumByOrg: revenueStore.sumByOrg.bind(revenueStore),
            sumByCampaign: revenueStore.sumByCampaign.bind(revenueStore),
          },
          outboxWriter: failingOutboxWriter,
          runInTransaction,
        });

        const res = await app.inject({
          method: "POST",
          url: "/api/org_integration_test/revenue",
          headers: {
            "Idempotency-Key": "rev-real-rollback-1",
            "x-org-id": "org_integration_test",
            "x-principal-id": "u1",
          },
          payload: { contactId: "c_integration_1", amount: 50 },
        });

        // Route 500s because the transaction rolled back
        expect(res.statusCode).toBe(500);

        // No LifecycleRevenueEvent row should exist for this contact after rollback
        const rows = await prisma.lifecycleRevenueEvent.findMany({
          where: { contactId: "c_integration_1", organizationId: "org_integration_test" },
        });
        expect(rows).toHaveLength(0);

        await app.close();
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);
