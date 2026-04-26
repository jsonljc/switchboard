import { describe, it, expect } from "vitest";
import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
} from "@switchboard/schemas";
import { computeSpendBySource } from "./spend-attributor.js";

function insight(campaignId: string, spend: number): CampaignInsight {
  return {
    campaignId,
    campaignName: campaignId,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 0,
    clicks: 0,
    spend,
    conversions: 0,
    revenue: 0,
    frequency: 0,
    cpm: 0,
    ctr: 0,
    cpc: 0,
    dateStart: "2026-01-01",
    dateStop: "2026-01-07",
  };
}

function adSet(
  campaignId: string,
  adSetId: string,
  destinationType: string | undefined,
  spend: number,
): AdSetLearningInput {
  return {
    adSetId,
    adSetName: adSetId,
    campaignId,
    learningStageStatus: "SUCCESS",
    frequency: 0,
    spend,
    conversions: 0,
    cpa: 0,
    roas: 0,
    ctr: 0,
    destinationType,
    hasFrequencyCap: false,
  };
}

const ctwaFunnel = { received: 100, qualified: 30, booked: 12, showed: 0, paid: 8, revenue: 800 };
const ifFunnel = { received: 200, qualified: 16, booked: 4, showed: 0, paid: 1, revenue: 80 };

describe("computeSpendBySource", () => {
  it("destination-type-only path: all ad sets matched, no fallback", () => {
    const insights = [insight("c1", 300), insight("c2", 400)];
    const adSetData = [adSet("c1", "as1", "WHATSAPP", 300), adSet("c2", "as2", "ON_AD", 400)];
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      adSetData,
    );
    expect(result.ctwa).toBeCloseTo(300, 6);
    expect(result.instant_form).toBeCloseTo(400, 6);
  });

  it("lead-share fallback: no ad-set data, proportional distribution", () => {
    const insights = [insight("c1", 300)];
    // 100 ctwa + 200 if = 300 leads → ctwa share = 1/3, if share = 2/3
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      null,
    );
    expect(result.ctwa).toBeCloseTo(100, 6);
    expect(result.instant_form).toBeCloseTo(200, 6);
  });

  it("mixed campaign: matched + unmatched ad sets — no spend silently dropped", () => {
    // Campaign c1 spend = 500. Ad sets: WHATSAPP (200) matched, WEBSITE (300) unmatched.
    // Pre-fix bug: 200 attributed to ctwa, 300 silently lost.
    // Post-fix: campaign is NOT fully attributed → fall back to lead-share for full 500.
    const insights = [insight("c1", 500)];
    const adSetData = [adSet("c1", "as1", "WHATSAPP", 200), adSet("c1", "as2", "WEBSITE", 300)];
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      adSetData,
    );
    const totalAttributed = (result.ctwa ?? 0) + (result.instant_form ?? 0);
    expect(totalAttributed).toBeCloseTo(500, 6);
    // Lead-share split: ctwa 100/300 = 1/3, if 200/300 = 2/3.
    expect(result.ctwa).toBeCloseTo(500 / 3, 6);
    expect(result.instant_form).toBeCloseTo((500 * 2) / 3, 6);
  });

  it("total-leads-zero short-circuit: leaves spend unattributed", () => {
    const insights = [insight("c1", 500)];
    const zeroFunnel = { received: 0, qualified: 0, booked: 0, showed: 0, paid: 0, revenue: 0 };
    const result = computeSpendBySource(
      insights,
      { ctwa: zeroFunnel, instant_form: zeroFunnel },
      null,
    );
    expect(result.ctwa).toBe(0);
    expect(result.instant_form).toBe(0);
  });

  it("source not in bySource: handles gracefully (skipped, no crash)", () => {
    // Ad set destinationType is unknown to destinationTypeToSource (returns null)
    // and bySource has only ctwa. Verify no crash and spend left for fallback.
    const insights = [insight("c1", 500)];
    const adSetData = [adSet("c1", "as1", "UNKNOWN_TYPE", 500)];
    const result = computeSpendBySource(insights, { ctwa: ctwaFunnel }, adSetData);
    // Campaign not fully attributed via destination_type → lead-share fallback.
    // Only ctwa in bySource, so all spend goes to ctwa.
    expect(result.ctwa).toBeCloseTo(500, 6);
    // No extra keys appear in result.
    expect(Object.keys(result)).toEqual(["ctwa"]);
  });
});
