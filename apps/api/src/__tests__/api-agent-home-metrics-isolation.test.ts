import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { MetricsViewModel } from "@switchboard/core";

const ORG_A = "org-a";
const ORG_B = "org-b";

describe("GET /api/dashboard/agents/:agentId/metrics — cross-tenant isolation", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("forwards orgId to the booking + conversion stores; cross-org data never bleeds", async () => {
    if (!ctx.app.reportStores) throw new Error("test-server should have wired reportStores");

    const bookingsSpy = vi.fn(async ({ orgId }: { orgId: string }) =>
      orgId === ORG_A ? 7 : orgId === ORG_B ? 99 : -1,
    );
    const conversionsSpy = vi.fn(async (orgId: string) =>
      orgId === ORG_A ? 13 : orgId === ORG_B ? 200 : -1,
    );

    ctx.app.reportStores.bookings.countExcludingStatuses = bookingsSpy;
    ctx.app.reportStores.conversions.countByType = conversionsSpy;

    const resA = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": ORG_A },
    });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json() as { vm: MetricsViewModel };
    expect((bodyA.vm.hero as { value: number }).value).toBe(7);
    expect(bodyA.vm.stats[0]!.rawValue).toBe(13);

    const resB = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/metrics?window=week",
      headers: { "x-org-id": ORG_B },
    });
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json() as { vm: MetricsViewModel };
    expect((bodyB.vm.hero as { value: number }).value).toBe(99);
    expect(bodyB.vm.stats[0]!.rawValue).toBe(200);

    const bookingOrgIds = bookingsSpy.mock.calls.map((c) => c[0].orgId);
    const conversionOrgIds = conversionsSpy.mock.calls.map((c) => c[0]);
    for (const orgId of [...bookingOrgIds, ...conversionOrgIds]) {
      expect([ORG_A, ORG_B]).toContain(orgId);
    }
    expect(bookingOrgIds).toContain(ORG_A);
    expect(bookingOrgIds).toContain(ORG_B);
  });
});
