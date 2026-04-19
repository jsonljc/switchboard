import { describe, it, expect, vi, beforeEach } from "vitest";
import { adOptimizerBuilder, AD_OPTIMIZER_CONTRACT } from "./ad-optimizer.js";

const mockStores = {
  adsClient: {
    getCampaignInsights: vi.fn().mockResolvedValue([{ campaignId: "c1", spend: 500 }]),
    getAccountSummary: vi.fn().mockResolvedValue({ accountId: "a1", totalSpend: 5000 }),
  },
  crmDataProvider: {
    getFunnelData: vi.fn().mockResolvedValue({ leads: 10, qualified: 5, closed: 2, revenue: 1000 }),
    getBenchmarks: vi.fn().mockResolvedValue({
      ctr: 2,
      landingPageViewRate: 0.8,
      leadRate: 0.05,
      qualificationRate: 0.3,
      closeRate: 0.2,
    }),
  },
  deploymentStore: {
    findById: vi.fn().mockResolvedValue({
      id: "d1",
      inputConfig: { targetCPA: 100, targetROAS: 3.0, monthlyBudget: 10000 },
      organizationId: "org1",
    }),
  },
};

const config = { deploymentId: "d1", orgId: "org1", trigger: "weekly_audit" };

describe("adOptimizerBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("loads all context contract fields", async () => {
    const result = await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(result.CAMPAIGN_INSIGHTS).toBeDefined();
    expect(result.ACCOUNT_SUMMARY).toBeDefined();
    expect(result.CRM_FUNNEL).toBeDefined();
    expect(result.BENCHMARKS).toBeDefined();
    expect(result.DEPLOYMENT_CONFIG).toBeDefined();
  });

  it("calls adsClient for current and previous insights", async () => {
    await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(mockStores.adsClient.getCampaignInsights).toHaveBeenCalledTimes(2);
  });

  it("calls deploymentStore for config", async () => {
    await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(mockStores.deploymentStore.findById).toHaveBeenCalledWith("d1");
  });

  it("extracts campaignIds for CRM funnel query", async () => {
    await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(mockStores.crmDataProvider.getFunnelData).toHaveBeenCalledWith(["c1"]);
  });

  it("returns PREVIOUS_INSIGHTS", async () => {
    const result = await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(result.PREVIOUS_INSIGHTS).toBeDefined();
  });
});

describe("AD_OPTIMIZER_CONTRACT", () => {
  it("has 6 required context keys", () => {
    expect(AD_OPTIMIZER_CONTRACT.required).toHaveLength(6);
  });

  it("has scope on campaign insight entries", () => {
    const current = AD_OPTIMIZER_CONTRACT.required.find(
      (r) => r.key === "campaign_insights" && r.scope === "current_period",
    );
    const previous = AD_OPTIMIZER_CONTRACT.required.find(
      (r) => r.key === "campaign_insights_previous" && r.scope === "previous_period",
    );
    expect(current).toBeDefined();
    expect(previous).toBeDefined();
  });
});
