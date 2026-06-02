// Integration proof: AuditRunner wired with the real MetaCampaignInsightsProvider.
// These tests exercise the full provider→runner pipeline without any stubs,
// confirming that the real Meta Graph-backed logic fires pause on a durable
// daily CPA breach and correctly downgrades to watch when a material child
// ad set is LEARNING.
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import { MetaCampaignInsightsProvider } from "../meta-campaign-insights-provider.js";
import type { CrmDataProvider } from "@switchboard/schemas";

function fakeCrm(): CrmDataProvider {
  return {
    getFunnelData: async () => ({
      campaignIds: [],
      leads: 0,
      qualified: 0,
      opportunities: 0,
      bookings: 0,
      closed: 0,
      revenue: 0,
      rates: {
        leadToQualified: null,
        qualifiedToBooking: null,
        bookingToClosed: null,
        leadToClosed: null,
      },
      coverage: {
        attributedContacts: 0,
        contactsWithEmailOrPhone: 0,
        contactsWithOpportunity: 0,
        contactsWithBooking: 0,
        contactsWithRevenueEvent: 0,
      },
    }),
    getBenchmarks: async () => ({
      leadToQualifiedRate: null,
      qualifiedToBookingRate: null,
      bookingToClosedRate: null,
      leadToClosedRate: null,
    }),
  };
}

describe("AuditRunner integration — real MetaCampaignInsightsProvider", () => {
  it("fires a pause recommendation on a durable daily breach (real provider, no stub)", async () => {
    const campaign = "c_dur";
    const aggInsight = {
      campaignId: campaign,
      campaignName: "Durable",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 6000,
      conversions: 10,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 600 : 30,
      conversions: i < 8 ? 1 : 3,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const adsClient = {
      getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
        p.timeIncrement === 1 ? dailyRows : [aggInsight],
      ),
      getAdSetInsights: vi.fn(async () => []),
      getAccountSummary: vi.fn(async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 6000,
        totalImpressions: 10000,
        totalClicks: 200,
        activeCampaigns: 1,
      })),
      getAdSetLearningInputs: vi.fn(async () => [
        {
          adSetId: "as",
          adSetName: "as",
          campaignId: campaign,
          learningStageStatus: "SUCCESS",
          frequency: 1,
          spend: 6000,
          conversions: 10,
          cpa: 600,
          roas: 0,
          inlineLinkClickCtr: 1,
        },
      ]),
    };
    const runner = new AuditRunner({
      adsClient: adsClient as never,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });
    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });
    expect(report.recommendations.map((r) => r.action)).toContain("pause");
  });

  it("downgrades to watch when a material child ad set is LEARNING", async () => {
    const campaign = "c_learn";
    const aggInsight = {
      campaignId: campaign,
      campaignName: "Learning",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 200,
      spend: 6000,
      conversions: 10,
      revenue: 0,
      frequency: 1.3,
      cpm: 5,
      inlineLinkClickCtr: 1,
      costPerInlineLinkClick: 1,
      dateStart: "2026-05-25",
      dateStop: "2026-06-01",
    };
    const dailyRows = Array.from({ length: 14 }, (_, i) => ({
      ...aggInsight,
      spend: i < 8 ? 600 : 30,
      conversions: i < 8 ? 1 : 3,
      dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
      dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
    }));
    const adsClient = {
      getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
        p.timeIncrement === 1 ? dailyRows : [aggInsight],
      ),
      getAdSetInsights: vi.fn(async () => []),
      getAccountSummary: vi.fn(async () => ({
        accountId: "a",
        accountName: "n",
        currency: "USD",
        totalSpend: 6000,
        totalImpressions: 10000,
        totalClicks: 200,
        activeCampaigns: 1,
      })),
      getAdSetLearningInputs: vi.fn(async () => [
        {
          adSetId: "as",
          adSetName: "as",
          campaignId: campaign,
          learningStageStatus: "LEARNING",
          frequency: 1,
          spend: 6000,
          conversions: 10,
          cpa: 600,
          roas: 0,
          inlineLinkClickCtr: 1,
        },
      ]),
    };
    const runner = new AuditRunner({
      adsClient: adsClient as never,
      crmDataProvider: fakeCrm(),
      insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
      config: {
        accountId: "a",
        orgId: "o",
        targetCPA: 50,
        targetROAS: 2,
        mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
      },
    });
    const report = await runner.run({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
    });
    expect(report.recommendations.every((r) => r.action !== "pause")).toBe(true);
    expect(report.watches.length).toBeGreaterThan(0);
  });
});
