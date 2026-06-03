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
    inlineLinkClicks: 0,
    spend,
    conversions: 0,
    revenue: 0,
    frequency: 0,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
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
    inlineLinkClickCtr: 0,
    destinationType,
    hasFrequencyCap: false,
  };
}

const ctwaFunnel = { received: 100, qualified: 30, booked: 12, showed: 0, paid: 8, revenue: 800 };
const ifFunnel = { received: 200, qualified: 16, booked: 4, showed: 0, paid: 1, revenue: 80 };

describe("computeSpendBySource", () => {
  it("destination-type-only path: all ad sets matched, no fallback (coverage 1.0)", () => {
    const insights = [insight("c1", 300), insight("c2", 400)];
    const adSetData = [adSet("c1", "as1", "WHATSAPP", 300), adSet("c2", "as2", "ON_AD", 400)];
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      adSetData,
    );
    expect(result.spendBySource.ctwa).toBeCloseTo(300, 6);
    expect(result.spendBySource.instant_form).toBeCloseTo(400, 6);
    // Both campaigns fully attributed via ad-set destinations → all spend is real.
    expect(result.attributedFraction).toBeCloseTo(1, 6);
  });

  it("lead-share fallback: no ad-set data, proportional distribution (coverage 0)", () => {
    const insights = [insight("c1", 300)];
    // 100 ctwa + 200 if = 300 leads → ctwa share = 1/3, if share = 2/3
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      null,
    );
    expect(result.spendBySource.ctwa).toBeCloseTo(100, 6);
    expect(result.spendBySource.instant_form).toBeCloseTo(200, 6);
    // No ad-set data → entirely synthetic lead-share → zero coverage.
    expect(result.attributedFraction).toBe(0);
  });

  it("partial coverage: one of two equal-spend campaigns attributed (coverage 0.5)", () => {
    // c1 ($100) fully attributed via a WHATSAPP ad set; c2 ($100) has no ad set → lead-share.
    const insights = [insight("c1", 100), insight("c2", 100)];
    const adSetData = [adSet("c1", "as1", "WHATSAPP", 100)];
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      adSetData,
    );
    expect(result.attributedFraction).toBeCloseTo(0.5, 6);
  });

  it("mixed campaign: matched + unmatched ad sets — no spend dropped, counts as 0 attributed", () => {
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
    const totalAttributed =
      (result.spendBySource.ctwa ?? 0) + (result.spendBySource.instant_form ?? 0);
    expect(totalAttributed).toBeCloseTo(500, 6);
    // Lead-share split: ctwa 100/300 = 1/3, if 200/300 = 2/3.
    expect(result.spendBySource.ctwa).toBeCloseTo(500 / 3, 6);
    expect(result.spendBySource.instant_form).toBeCloseTo((500 * 2) / 3, 6);
    // A mixed (tracked + untracked) campaign contributes 0 to the numerator
    // (whole-campaign fallback) — coverage is conservative by construction.
    expect(result.attributedFraction).toBe(0);
  });

  it("orphan ad set: campaignId absent from insights does not inflate coverage", () => {
    // Ad set references c99, which has no campaign insight. It must not count toward
    // coverage (the numerator is strictly insights-side).
    const insights = [insight("c1", 100)];
    const adSetData = [adSet("c99", "as1", "WHATSAPP", 100)];
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      adSetData,
    );
    expect(result.attributedFraction).toBe(0);
  });

  it("zero total spend: no divide-by-zero, coverage 0", () => {
    const insights = [insight("c1", 0)];
    const adSetData = [adSet("c1", "as1", "WHATSAPP", 0)];
    const result = computeSpendBySource(
      insights,
      { ctwa: ctwaFunnel, instant_form: ifFunnel },
      adSetData,
    );
    expect(result.attributedFraction).toBe(0);
  });

  it("total-leads-zero short-circuit: leaves spend unattributed", () => {
    const insights = [insight("c1", 500)];
    const zeroFunnel = { received: 0, qualified: 0, booked: 0, showed: 0, paid: 0, revenue: 0 };
    const result = computeSpendBySource(
      insights,
      { ctwa: zeroFunnel, instant_form: zeroFunnel },
      null,
    );
    expect(result.spendBySource.ctwa).toBe(0);
    expect(result.spendBySource.instant_form).toBe(0);
    expect(result.attributedFraction).toBe(0);
  });

  it("source not in bySource: handles gracefully (skipped, no crash)", () => {
    // Ad set destinationType is unknown to destinationTypeToSource (returns null)
    // and bySource has only ctwa. Verify no crash and spend left for fallback.
    const insights = [insight("c1", 500)];
    const adSetData = [adSet("c1", "as1", "UNKNOWN_TYPE", 500)];
    const result = computeSpendBySource(insights, { ctwa: ctwaFunnel }, adSetData);
    // Campaign not fully attributed via destination_type → lead-share fallback.
    // Only ctwa in bySource, so all spend goes to ctwa.
    expect(result.spendBySource.ctwa).toBeCloseTo(500, 6);
    // No extra keys appear in result.
    expect(Object.keys(result.spendBySource)).toEqual(["ctwa"]);
    expect(result.attributedFraction).toBe(0);
  });
});
