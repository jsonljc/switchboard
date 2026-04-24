import { describe, it, expect } from "vitest";
import { analyzeFunnel } from "../funnel-analyzer.js";
import type { FunnelInput } from "../funnel-analyzer.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

function makeInsight(impressions: number, clicks: number): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions,
    clicks,
    spend: 100,
    conversions: 5,
    revenue: 500,
    frequency: 1.5,
    cpm: 10,
    ctr: clicks / impressions,
    cpc: 100 / clicks,
    dateStart: "2024-01-01",
    dateStop: "2024-01-31",
  };
}

describe("analyzeFunnel", () => {
  it("computes funnel stages with correct rates from normal data", () => {
    const input: FunnelInput = {
      insights: [makeInsight(10_000, 300), makeInsight(5_000, 100)],
      crmData: {
        campaignIds: ["c1"],
        leads: 50,
        qualified: 20,
        opportunities: 25,
        bookings: 12,
        closed: 5,
        revenue: 10_000,
        rates: {
          leadToQualified: 0.4,
          qualifiedToBooking: 0.6,
          bookingToClosed: 0.417,
          leadToClosed: 0.1,
        },
        coverage: {
          attributedContacts: 50,
          contactsWithEmailOrPhone: 45,
          contactsWithOpportunity: 25,
          contactsWithBooking: 12,
          contactsWithRevenueEvent: 5,
        },
      },
      crmBenchmarks: {
        leadToQualifiedRate: 0.5,
        qualifiedToBookingRate: 0.4,
        bookingToClosedRate: 0.3,
        leadToClosedRate: 0.06,
      },
      mediaBenchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
        clickToLeadRate: 0.04,
      },
    };

    const result = analyzeFunnel(input);

    expect(result.stages).toHaveLength(6);

    const [impressions, clicks, lpv, leads, qualified, closed] = result.stages as [
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
      (typeof result.stages)[number],
    ];

    expect(impressions.name).toBe("Impressions");
    expect(impressions.count).toBe(15_000);

    expect(clicks.name).toBe("Clicks");
    expect(clicks.count).toBe(400);

    expect(lpv.name).toBe("Landing Page Views");
    expect(lpv.count).toBe(320);

    expect(leads.name).toBe("Leads");
    expect(leads.count).toBe(50);

    expect(qualified.name).toBe("Qualified");
    expect(qualified.count).toBe(20);

    expect(closed.name).toBe("Closed");
    expect(closed.count).toBe(5);
  });

  it("handles zero impressions gracefully with leakageMagnitude=0", () => {
    const input: FunnelInput = {
      insights: [],
      crmData: {
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
      },
      crmBenchmarks: {
        leadToQualifiedRate: 0.3,
        qualifiedToBookingRate: 0.4,
        bookingToClosedRate: 0.5,
        leadToClosedRate: 0.06,
      },
      mediaBenchmarks: {
        ctr: 2.5,
        landingPageViewRate: 0.8,
      },
    };

    const result = analyzeFunnel(input);

    expect(result.leakageMagnitude).toBe(0);
    expect(result.stages).toHaveLength(6);
    for (const stage of result.stages) {
      expect(stage.count).toBe(0);
    }
  });
});
