import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { metricsRoute } from "../routes/agent-home/metrics.js";
import type { MetricsViewModel } from "@switchboard/core";
import { createInMemoryOrgAgentEnablementStore } from "@switchboard/db";

/**
 * Lightweight test harness for the metrics route (mirrors the local metrics.test.ts
 * pattern from routes/agent-home/__tests__/metrics.test.ts but tests the A.3 wiring).
 * Uses mocked prisma — no real Postgres per feedback_api_test_mocked_prisma.
 */
async function buildApp(opts: {
  withStores?: boolean;
  bookingCount?: number;
  conversionCount?: number;
  rosterConfig?: Record<string, unknown> | null;
  connectionRow?: { id: string; status: string; serviceId: string } | null;
  adsClientInsights?: Array<{ spend: number }> | null;
}) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.decorate("organizationIdFromAuth", undefined as string | undefined);
  app.decorate("principalIdFromAuth", undefined as string | undefined);

  // Build a mock prisma that stubs agentRoster.findUnique and connection.findFirst
  const mockPrisma = {
    agentRoster: {
      findUnique: vi.fn(async () => {
        if (opts.rosterConfig === null) return null;
        const config = opts.rosterConfig ?? {};
        return { config };
      }),
    },
    connection: {
      findFirst: vi.fn(async () => {
        if (opts.connectionRow === null || opts.connectionRow === undefined) return null;
        if (opts.connectionRow.status !== "connected") return null;
        return opts.connectionRow;
      }),
    },
    organizationConfig: {
      findFirst: vi.fn(async () => null),
    },
    // Alex's Showed stat queries the opportunity store (count + findFirst).
    opportunity: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
    },
  };

  app.decorate("prisma", mockPrisma as never);
  app.decorate("orgAgentEnablementStore", createInMemoryOrgAgentEnablementStore());

  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = undefined;
  });

  // Wire metaSpendProvider if a connectionRow + insights are provided
  if (opts.connectionRow && opts.connectionRow.status === "connected" && opts.adsClientInsights) {
    const insights = opts.adsClientInsights;
    app.decorate("metaSpendProvider", async (_range: unknown) => {
      const dollars = insights.reduce((sum, r) => sum + r.spend, 0);
      return Math.round(dollars * 100);
    });
  } else {
    // Default: no metaSpendProvider → route falls back to async () => null
    app.decorate("metaSpendProvider", undefined as never);
  }

  if (opts.withStores !== false) {
    const bookingStore = {
      countExcludingStatuses: vi.fn(async () => opts.bookingCount ?? 0),
    };
    const conversionRecordStore = {
      countByType: vi.fn(async () => opts.conversionCount ?? 0),
    };
    app.decorate("reportStores", {
      bookings: bookingStore,
      conversions: conversionRecordStore,
    } as unknown as never);
  }

  await app.register(metricsRoute, { prefix: "/api/dashboard" });
  return app;
}

describe("A.3 metrics route — targets + spend", () => {
  it("echoes targets from AgentRoster.config when both keys present", async () => {
    const app = await buildApp({
      rosterConfig: { avgValueCents: 17900, targetCpbCents: 3000 },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    expect(body.vm.targets).toEqual({ avgValueCents: 17900, targetCpbCents: 3000 });
  });

  it("returns null targets when AgentRoster.config has no matching keys", async () => {
    const app = await buildApp({
      rosterConfig: {},
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    expect(body.vm.targets).toEqual({ avgValueCents: null, targetCpbCents: null });
  });

  it("returns null spendCents when no Meta Ads Connection exists", async () => {
    const app = await buildApp({
      connectionRow: null,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    expect(body.vm.spendCents).toBeNull();
  });

  it("returns numeric spendCents when adsClient succeeds with spend rows", async () => {
    const app = await buildApp({
      connectionRow: { id: "c1", status: "connected", serviceId: "meta-ads" },
      adsClientInsights: [{ spend: 120 }, { spend: 94 }],
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    // 120 + 94 = 214 dollars → 21400 cents
    expect(body.vm.spendCents).toBe(21400);
  });

  it("handles missing AgentRoster row gracefully (zero-config tenant), still 200", async () => {
    const app = await buildApp({
      rosterConfig: null, // findUnique returns null
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    // targets should fall back to null when roster is absent
    expect(body.vm.targets).toEqual({ avgValueCents: null, targetCpbCents: null });
  });
});
