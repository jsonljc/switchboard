import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { wireMetricsProvider } from "../wire-metrics.js";

vi.mock("@switchboard/ad-optimizer", () => ({
  MetaAdsClient: vi.fn().mockImplementation((creds: unknown) => ({
    __creds: creds,
    getCampaignInsights: vi.fn(async () => []),
  })),
}));

describe("wireMetricsProvider", () => {
  it("decorates the Fastify instance with a callable metaSpendProvider", async () => {
    const app = Fastify({ logger: false });
    const prisma = {
      connection: {
        findFirst: vi.fn(async () => null),
      },
    };
    wireMetricsProvider(app, prisma as never);

    expect(app.metaSpendProvider).toBeDefined();
    expect(typeof app.metaSpendProvider).toBe("function");

    // The decorated provider should return null when no connected Connection
    // exists (graceful no-op end-to-end through the seam).
    const cents = await app.metaSpendProvider!({
      orgId: "org_1",
      from: new Date("2026-05-12"),
      to: new Date("2026-05-18"),
    });
    expect(cents).toBeNull();
  });

  it("returns summed cents when a connected meta-ads Connection + insights exist", async () => {
    const { MetaAdsClient } = await import("@switchboard/ad-optimizer");
    (MetaAdsClient as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      getCampaignInsights: vi.fn(async () => [{ spend: 120.5 }, { spend: 93.49 }]),
    }));
    const app = Fastify({ logger: false });
    const prisma = {
      connection: {
        findFirst: vi
          .fn()
          // First call (from meta-spend-provider) — finds the connected row
          .mockResolvedValueOnce({ id: "conn_1", organizationId: "org_1" })
          // Second call (from ads-client-factory) — re-verifies (id,org) match
          .mockResolvedValueOnce({ credentials: { encrypted: "stub" } }),
      },
    };
    wireMetricsProvider(app, prisma as never, {
      decryptCredentials: () => ({ accessToken: "tok", accountId: "act" }),
    });
    const cents = await app.metaSpendProvider!({
      orgId: "org_1",
      from: new Date("2026-05-12"),
      to: new Date("2026-05-18"),
    });
    // 120.50 + 93.49 = 213.99 → 21399 cents
    expect(cents).toBe(21399);
  });
});
