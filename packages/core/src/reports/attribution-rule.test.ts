import { describe, it, expect } from "vitest";
import { computeAttribution } from "./attribution-rule.js";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function makeCtx(): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

type RevenueRow = Awaited<ReturnType<ReportStores["revenue"]["revenueWithFirstTouch"]>>[number];
type LeadRow = Awaited<ReturnType<ReportStores["conversions"]["leadsBySource"]>>[number];

function makeStores(
  currentRevenue: RevenueRow[],
  priorRevenue: RevenueRow[],
  leads: LeadRow[],
): Pick<ReportStores, "revenue" | "conversions"> {
  return {
    revenue: {
      sumByOrg: async () => ({ totalAmount: 0, count: 0 }),
      revenueWithFirstTouch: async ({ from }) => {
        const isCurrentPeriod = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrentPeriod ? currentRevenue : priorRevenue;
      },
      revenueByCampaign: async () => [],
    },
    conversions: {
      countByType: async () => 0,
      leadsBySource: async () => leads,
    },
  };
}

describe("computeAttribution", () => {
  it("buckets ad-sourced revenue to Riley", async () => {
    const stores = makeStores(
      [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [],
      [{ sourceAdId: "ad-1", sourceCampaignId: "camp-1", sourceChannel: null }],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.riley.value).toBe(5000);
    expect(result.alex.value).toBe(0);
    expect(result.total).toBe(5000);
  });

  it("buckets chat-sourced revenue to Alex", async () => {
    const stores = makeStores(
      [
        {
          amount: 2000,
          firstTouchSourceAdId: null,
          firstTouchSourceCampaignId: null,
          firstTouchSourceChannel: "whatsapp",
        },
      ],
      [],
      [{ sourceAdId: null, sourceCampaignId: null, sourceChannel: "whatsapp" }],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.riley.value).toBe(0);
    expect(result.alex.value).toBe(2000);
  });

  it("buckets manual-entry revenue (no ConversionRecord) to Alex", async () => {
    const stores = makeStores(
      [
        {
          amount: 1000,
          firstTouchSourceAdId: null,
          firstTouchSourceCampaignId: null,
          firstTouchSourceChannel: null,
        },
      ],
      [],
      [],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.alex.value).toBe(1000);
    expect(result.riley.value).toBe(0);
  });

  it("returns zeroed values with flat delta when no revenue exists", async () => {
    const stores = makeStores([], [], []);
    const result = await computeAttribution(makeCtx(), stores);

    expect(result.total).toBe(0);
    expect(result.riley.value).toBe(0);
    expect(result.alex.value).toBe(0);
    expect(result.delta.kind).toBe("flat");
  });

  it("computes positive delta when current > prior", async () => {
    const stores = makeStores(
      [
        {
          amount: 10000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [{ sourceAdId: "ad-1", sourceCampaignId: "camp-1", sourceChannel: null }],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.delta.kind).toBe("pos");
    expect(result.delta.text).toContain("100");
  });

  it("builds Riley caption with campaign count and lead count", async () => {
    const stores = makeStores(
      [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [],
      [
        { sourceAdId: "ad-1", sourceCampaignId: "camp-1", sourceChannel: null },
        { sourceAdId: "ad-2", sourceCampaignId: "camp-1", sourceChannel: null },
        { sourceAdId: "ad-3", sourceCampaignId: "camp-2", sourceChannel: null },
      ],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.riley.caption).toBe("2 campaigns · 3 leads");
  });

  it("builds Alex caption with lead count", async () => {
    const stores = makeStores(
      [
        {
          amount: 2000,
          firstTouchSourceAdId: null,
          firstTouchSourceCampaignId: null,
          firstTouchSourceChannel: "whatsapp",
        },
      ],
      [],
      [
        { sourceAdId: null, sourceCampaignId: null, sourceChannel: "whatsapp" },
        { sourceAdId: null, sourceCampaignId: null, sourceChannel: "telegram" },
      ],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.alex.caption).toBe("chat · 2 leads");
  });
});
