// ---------------------------------------------------------------------------
// Data Normalizer — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { collectNormalizedData, assignDataConfidenceTier, MockConnector } from "../normalizer.js";
import type { NormalizedData } from "@switchboard/schemas";

describe("assignDataConfidenceTier", () => {
  const base: NormalizedData = {
    accountId: "acc_1",
    organizationId: "org_1",
    collectedAt: new Date().toISOString(),
    dataTier: "SPARSE",
    adMetrics: null,
    funnelEvents: [],
    creativeAssets: null,
    crmSummary: null,
    signalHealth: null,
  };

  it("returns SPARSE when no data sources are available", () => {
    expect(assignDataConfidenceTier(base)).toBe("SPARSE");
  });

  it("returns SPARSE with only 1 data source", () => {
    const data = {
      ...base,
      adMetrics: {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        conversions: 5,
        revenue: 500,
        ctr: 0.05,
        cpc: 2,
        cpa: 20,
        roas: 5,
        frequency: 2,
      },
    };
    expect(assignDataConfidenceTier(data)).toBe("SPARSE");
  });

  it("returns PARTIAL with 2-3 data sources", () => {
    const data = {
      ...base,
      adMetrics: {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        conversions: 5,
        revenue: 500,
        ctr: 0.05,
        cpc: 2,
        cpa: 20,
        roas: 5,
        frequency: 2,
      },
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 8,
        eventCompleteness: 0.9,
        deduplicationRate: 0.1,
        conversionLagHours: 4,
      },
    };
    expect(assignDataConfidenceTier(data)).toBe("PARTIAL");
  });

  it("returns FULL with 4+ data sources", () => {
    const data: NormalizedData = {
      ...base,
      adMetrics: {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        conversions: 5,
        revenue: 500,
        ctr: 0.05,
        cpc: 2,
        cpa: 20,
        roas: 5,
        frequency: 2,
      },
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 8,
        eventCompleteness: 0.9,
        deduplicationRate: 0.1,
        conversionLagHours: 4,
      },
      creativeAssets: {
        totalAssets: 10,
        activeAssets: 8,
        averageScore: 70,
        fatigueRate: 0.1,
        topPerformerCount: 3,
        bottomPerformerCount: 1,
        diversityScore: 65,
      },
      crmSummary: {
        totalLeads: 100,
        matchedLeads: 60,
        matchRate: 0.6,
        openDeals: 15,
        averageDealValue: 500,
        averageTimeToFirstContact: 2,
        leadToCloseRate: 0.15,
      },
    };
    expect(assignDataConfidenceTier(data)).toBe("FULL");
  });
});

describe("collectNormalizedData", () => {
  it("returns SPARSE data when no deps are provided", async () => {
    const result = await collectNormalizedData("acc_1", "org_1", null);
    expect(result.dataTier).toBe("SPARSE");
    expect(result.adMetrics).toBeNull();
    expect(result.funnelEvents).toEqual([]);
  });

  it("returns SPARSE data when no connectors exist", async () => {
    const result = await collectNormalizedData("acc_1", "org_1", { connectors: [] });
    expect(result.dataTier).toBe("SPARSE");
  });

  it("collects data from a mock connector", async () => {
    const connector = new MockConnector({
      adMetrics: {
        impressions: 1000,
        clicks: 50,
        spend: 100,
        conversions: 5,
        revenue: 500,
        ctr: 0.05,
        cpc: 2,
        cpa: 20,
        roas: 5,
        frequency: 2,
      },
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 8,
        eventCompleteness: 0.9,
        deduplicationRate: 0.1,
        conversionLagHours: 4,
      },
      creativeAssets: {
        totalAssets: 10,
        activeAssets: 8,
        averageScore: 70,
        fatigueRate: 0.1,
        topPerformerCount: 3,
        bottomPerformerCount: 1,
        diversityScore: 65,
      },
      crmSummary: {
        totalLeads: 100,
        matchedLeads: 60,
        matchRate: 0.6,
        openDeals: 15,
        averageDealValue: 500,
        averageTimeToFirstContact: 2,
        leadToCloseRate: 0.15,
      },
    });

    const result = await collectNormalizedData("acc_1", "org_1", {
      connectors: [connector],
    });

    expect(result.dataTier).toBe("FULL");
    expect(result.adMetrics).not.toBeNull();
    expect(result.signalHealth).not.toBeNull();
    expect(result.creativeAssets).not.toBeNull();
    expect(result.crmSummary).not.toBeNull();
    expect(result.accountId).toBe("acc_1");
    expect(result.organizationId).toBe("org_1");
  });

  it("handles connector errors gracefully", async () => {
    const failingConnector: import("../normalizer.js").CartridgeConnector = {
      id: "failing",
      name: "Failing Connector",
      fetchAdMetrics: () => {
        throw new Error("Connection failed");
      },
      fetchFunnelEvents: () => {
        throw new Error("Connection failed");
      },
      fetchSignalHealth: () => {
        throw new Error("Connection failed");
      },
      fetchCreativeAssets: () => {
        throw new Error("Connection failed");
      },
      fetchCrmSummary: () => {
        throw new Error("Connection failed");
      },
    };

    const result = await collectNormalizedData("acc_1", "org_1", {
      connectors: [failingConnector],
    });

    expect(result.dataTier).toBe("SPARSE");
    expect(result.adMetrics).toBeNull();
  });
});

describe("MockConnector", () => {
  it("returns provided data", async () => {
    const connector = new MockConnector({
      adMetrics: {
        impressions: 500,
        clicks: 25,
        spend: 50,
        conversions: 2,
        revenue: 200,
        ctr: 0.05,
        cpc: 2,
        cpa: 25,
        roas: 4,
        frequency: 1.5,
      },
    });

    const metrics = await connector.fetchAdMetrics("acc_1");
    expect(metrics?.impressions).toBe(500);
  });

  it("returns null/empty when no data provided", async () => {
    const connector = new MockConnector();
    expect(await connector.fetchAdMetrics("acc_1")).toBeNull();
    expect(await connector.fetchFunnelEvents("acc_1")).toEqual([]);
    expect(await connector.fetchSignalHealth("acc_1")).toBeNull();
    expect(await connector.fetchCreativeAssets("acc_1")).toBeNull();
    expect(await connector.fetchCrmSummary("acc_1")).toBeNull();
  });
});
