import { describe, expect, it, vi } from "vitest";
import { buildMetaSpendProvider } from "../lib/meta-spend-provider.js";

type PrismaStub = {
  connection: { findFirst: ReturnType<typeof vi.fn> };
};

function stubPrisma(connection: unknown): PrismaStub {
  return { connection: { findFirst: vi.fn(async () => connection) } };
}

const ANY_RANGE = { orgId: "org_1", from: new Date("2026-05-12"), to: new Date("2026-05-18") };

describe("buildMetaSpendProvider", () => {
  it("returns null when no Meta Ads Connection exists", async () => {
    const prisma = stubPrisma(null);
    const adsClientFactory = vi.fn();
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory);
    expect(await getMetaSpendCents(ANY_RANGE)).toBeNull();
    expect(adsClientFactory).not.toHaveBeenCalled();
  });

  it("returns null when Connection is not connected", async () => {
    const prisma = stubPrisma({ id: "c1", status: "degraded", serviceId: "meta-ads" });
    const adsClientFactory = vi.fn();
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory);
    expect(await getMetaSpendCents(ANY_RANGE)).toBeNull();
  });

  it("sums spend across campaign rows and converts dollars to cents", async () => {
    const prisma = stubPrisma({ id: "c1", status: "connected", serviceId: "meta-ads" });
    const adsClient = {
      getCampaignInsights: vi.fn(async () => [{ spend: 120.5 }, { spend: 93.49 }, { spend: 0 }]),
    };
    const adsClientFactory = vi.fn(async () => adsClient);
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory as never);
    // 120.50 + 93.49 + 0 = 213.99 → 21399 cents
    expect(await getMetaSpendCents(ANY_RANGE)).toBe(21399);
    expect(adsClient.getCampaignInsights).toHaveBeenCalledWith({
      dateRange: { since: "2026-05-12", until: "2026-05-18" },
      fields: ["spend"],
    });
  });

  it("returns null and logs when provider throws", async () => {
    const prisma = stubPrisma({ id: "c1", status: "connected", serviceId: "meta-ads" });
    const adsClient = {
      getCampaignInsights: vi.fn(async () => {
        throw new Error("rate limited");
      }),
    };
    const warn = vi.fn();
    const adsClientFactory = vi.fn(async () => adsClient);
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory as never, {
      log: { warn },
    });
    expect(await getMetaSpendCents(ANY_RANGE)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
