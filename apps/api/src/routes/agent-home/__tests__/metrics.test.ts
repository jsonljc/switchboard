import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { metricsRoute } from "../metrics.js";
import type { MetricsViewModel } from "@switchboard/core";

async function buildApp(opts: {
  withStores?: boolean;
  bookingCount?: number;
  conversionCount?: number;
  bookingThrows?: boolean;
}) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.decorate("organizationIdFromAuth", undefined as string | undefined);
  app.decorate("principalIdFromAuth", undefined as string | undefined);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = undefined;
  });

  if (opts.withStores) {
    const bookingStore = {
      countExcludingStatuses: vi.fn(async () => {
        if (opts.bookingThrows) throw new Error("boom");
        return opts.bookingCount ?? 0;
      }),
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

describe("metrics route", () => {
  it("400 on window=today", async () => {
    const app = await buildApp({ withStores: true });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=today",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 on agentId=mira", async () => {
    const app = await buildApp({ withStores: true });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("503 when reportStores is missing", async () => {
    const app = await buildApp({ withStores: false });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("500 when a store call rejects (no partial response)", async () => {
    const app = await buildApp({ withStores: true, bookingThrows: true });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(500);
  });

  it("200 OK returns { vm } with hero and folioRange", async () => {
    const app = await buildApp({ withStores: true, bookingCount: 14, conversionCount: 47 });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    expect(body.vm.hero.kind).toBe("tours-booked");
    expect(typeof body.vm.folioRange).toBe("string");
    expect(body.vm.freshness.dataSource).toBe("live");
  });

  it("default window is 'week' when query absent", async () => {
    const app = await buildApp({ withStores: true });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("Riley dispatches to ad-leads hero", async () => {
    const app = await buildApp({ withStores: true, conversionCount: 86 });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/metrics?window=week",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vm: MetricsViewModel };
    expect(body.vm.hero.kind).toBe("ad-leads");
  });
});
