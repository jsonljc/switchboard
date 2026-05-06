import { describe, it, expect, beforeEach } from "vitest";
import { captureAdsBaseline } from "./baseline-capture.js";
import { createInMemoryBaselineStore } from "./in-memory-store.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";
import type { BaselineStore } from "./interfaces.js";

function stubProvider(
  metricsByCall: Array<{ impressions: number; inlineLinkClicks: number; spend: number }>,
): ReportInsightsProvider {
  let callIndex = 0;
  return {
    getAggregateMetrics: async () => {
      const m = metricsByCall[callIndex] ?? { impressions: 0, inlineLinkClicks: 0, spend: 0 };
      callIndex++;
      return { ...m, landingPageViews: 0 };
    },
    getCampaignMetrics: async () => [],
  };
}

describe("captureAdsBaseline", () => {
  let store: BaselineStore;

  beforeEach(() => {
    store = createInMemoryBaselineStore();
  });

  it("captures 3 monthly buckets of ads metrics", async () => {
    const provider = stubProvider([
      { impressions: 1000, inlineLinkClicks: 100, spend: 500 },
      { impressions: 2000, inlineLinkClicks: 200, spend: 800 },
      { impressions: 1500, inlineLinkClicks: 150, spend: 600 },
    ]);

    await captureAdsBaseline("org-1", provider, store);

    const rows = await store.listByDimension("org-1", "ads");
    expect(rows.length).toBe(9); // 3 metrics × 3 months
    const spendRows = rows.filter((r) => r.metric === "spend");
    expect(spendRows).toHaveLength(3);
    expect(spendRows.map((r) => r.value).sort((a, b) => a - b)).toEqual([500, 600, 800]);
  });

  it("is idempotent on re-run", async () => {
    const provider = stubProvider([
      { impressions: 1000, inlineLinkClicks: 100, spend: 500 },
      { impressions: 2000, inlineLinkClicks: 200, spend: 800 },
      { impressions: 1500, inlineLinkClicks: 150, spend: 600 },
    ]);

    await captureAdsBaseline("org-1", provider, store);
    const firstRun = await store.listByDimension("org-1", "ads");

    const provider2 = stubProvider([
      { impressions: 1000, inlineLinkClicks: 100, spend: 500 },
      { impressions: 2000, inlineLinkClicks: 200, spend: 800 },
      { impressions: 1500, inlineLinkClicks: 150, spend: 600 },
    ]);
    await captureAdsBaseline("org-1", provider2, store);
    const secondRun = await store.listByDimension("org-1", "ads");

    expect(secondRun.length).toBe(firstRun.length);
  });

  it("handles provider error gracefully", async () => {
    const provider: ReportInsightsProvider = {
      getAggregateMetrics: async () => {
        throw new Error("Meta API down");
      },
      getCampaignMetrics: async () => [],
    };

    await expect(captureAdsBaseline("org-1", provider, store)).rejects.toThrow("Meta API down");
    const rows = await store.listByDimension("org-1", "ads");
    expect(rows).toHaveLength(0);
  });
});
