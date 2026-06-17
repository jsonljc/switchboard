// packages/core/src/ad-optimizer/__tests__/metric-diagnostician.test.ts
import { describe, it, expect } from "vitest";
import { diagnose } from "../metric-diagnostician.js";
import { insightToMetrics } from "../campaign-decision.js";
import { comparePeriods } from "../period-comparator.js";
import type {
  MetricDeltaSchema as MetricDelta,
  CampaignInsightSchema as CampaignInsight,
} from "@switchboard/schemas";

function makeDelta(
  metric: string,
  current: number,
  previous: number,
  direction: "up" | "down" | "stable",
  significant: boolean,
): MetricDelta {
  const deltaPercent = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  return { metric, current, previous, deltaPercent, direction, significant };
}

describe("diagnose", () => {
  it("detects creative_fatigue: CPM stable + CTR down significant + frequency=4.0", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 10, 10, "stable", false),
      makeDelta("inlineLinkClickCtr", 1.0, 2.0, "down", true),
      makeDelta("frequency", 4.0, 2.0, "up", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("creative_fatigue");
    const fatigue = result.find((d) => d.pattern === "creative_fatigue")!;
    expect(fatigue.confidence).toBe("high");
  });

  it("detects landing_page_drop: CTR stable + CPL up significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("inlineLinkClickCtr", 2.5, 2.5, "stable", false),
      makeDelta("cpl", 15, 10, "up", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("landing_page_drop");
    const landing = result.find((d) => d.pattern === "landing_page_drop")!;
    expect(landing.confidence).toBe("high");
  });

  it("detects audience_saturation: frequency=4.0 + CTR down significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("frequency", 4.0, 2.0, "up", true),
      makeDelta("inlineLinkClickCtr", 1.0, 2.5, "down", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("audience_saturation");
    const saturation = result.find((d) => d.pattern === "audience_saturation")!;
    expect(saturation.confidence).toBe("high");
  });

  it("returns empty array when no patterns match (all stable)", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 10, 10, "stable", false),
      makeDelta("inlineLinkClickCtr", 2.5, 2.5, "stable", false),
      makeDelta("cpl", 5, 5, "stable", false),
      makeDelta("cpa", 20, 20, "stable", false),
      makeDelta("frequency", 1.5, 1.5, "stable", false),
    ];

    const result = diagnose(deltas);

    expect(result).toEqual([]);
  });

  it("detects competition_increase: CPM up significant + CTR stable", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 12, 10, "up", true),
      makeDelta("inlineLinkClickCtr", 2.5, 2.5, "stable", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("competition_increase");
    const competition = result.find((d) => d.pattern === "competition_increase")!;
    expect(competition.confidence).toBe("medium");
  });

  it("detects lead_quality_issue: CPA up significant + CPL not significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpa", 30, 20, "up", true),
      makeDelta("cpl", 5.5, 5, "up", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("lead_quality_issue");
    const quality = result.find((d) => d.pattern === "lead_quality_issue")!;
    expect(quality.confidence).toBe("medium");
  });

  it("detects audience_offer_mismatch: CTR up + CPA up significant", () => {
    const deltas: MetricDelta[] = [
      makeDelta("inlineLinkClickCtr", 3.0, 2.5, "up", true),
      makeDelta("cpa", 30, 20, "up", true),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("audience_offer_mismatch");
    const mismatch = result.find((d) => d.pattern === "audience_offer_mismatch")!;
    expect(mismatch.confidence).toBe("high");
  });

  it("detects account_level_issue when 3+ metrics are significantly degrading", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 12, 10, "up", true), // cost up = degrading
      makeDelta("costPerInlineLinkClick", 1.5, 1.0, "up", true), // cost up = degrading
      makeDelta("cpl", 15, 10, "up", true), // cost up = degrading
      makeDelta("inlineLinkClickCtr", 2.5, 2.5, "stable", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).toContain("account_level_issue");
    const account = result.find((d) => d.pattern === "account_level_issue")!;
    expect(account.confidence).toBe("low");
  });

  it("does not detect account_level_issue when only 2 metrics degrade", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 12, 10, "up", true), // cost up = degrading
      makeDelta("costPerInlineLinkClick", 1.5, 1.0, "up", true), // cost up = degrading
      makeDelta("inlineLinkClickCtr", 2.5, 2.5, "stable", false),
    ];

    const result = diagnose(deltas);

    const patterns = result.map((d) => d.pattern);
    expect(patterns).not.toContain("account_level_issue");
  });

  it("detects creative_fatigue without fixed frequency threshold — uses trend direction", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 10, 10, "stable", false),
      makeDelta("inlineLinkClickCtr", 1.0, 2.0, "down", true),
      makeDelta("cpa", 30, 20, "up", true),
      makeDelta("frequency", 2.8, 2.0, "up", true),
    ];
    const result = diagnose(deltas);
    expect(result.map((d) => d.pattern)).toContain("creative_fatigue");
  });

  it("flags lead_quality_degradation when CPL drops but cost-per-booked rises", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpl", 3, 4, "down", true),
      makeDelta("costPerBooked", 50, 30, "up", true),
    ];
    const result = diagnose(deltas);
    expect(result.find((d) => d.pattern === "lead_quality_degradation")).toBeDefined();
  });

  it("flags ctwa_drive_by_clickers when chats up but reply rate down", () => {
    const deltas: MetricDelta[] = [
      makeDelta("chatsStarted", 130, 100, "up", true),
      makeDelta("replyRate", 0.3, 0.6, "down", true),
    ];
    const result = diagnose(deltas);
    expect(result.find((d) => d.pattern === "ctwa_drive_by_clickers")).toBeDefined();
  });

  it("does NOT flag lead_quality_degradation when costPerBooked is exactly 1.2x", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpl", 3, 4, "down", true),
      makeDelta("costPerBooked", 36, 30, "up", true), // exactly 1.2x — strict > threshold
    ];
    const result = diagnose(deltas);
    expect(result.find((d) => d.pattern === "lead_quality_degradation")).toBeUndefined();
  });

  it("does not require frequency > 3.5 for creative_fatigue", () => {
    const deltas: MetricDelta[] = [
      makeDelta("cpm", 10, 10, "stable", false),
      makeDelta("inlineLinkClickCtr", 1.0, 2.0, "down", true),
      makeDelta("cpa", 30, 20, "up", true),
      makeDelta("frequency", 2.5, 1.8, "up", true),
    ];
    const result = diagnose(deltas);
    expect(result.find((d) => d.pattern === "creative_fatigue")).toBeDefined();
  });
});

describe("lead_quality_* reachability through the live audit seam", () => {
  // TRIPWIRE. These pin WHY the two booking-cost-aware diagnoses (lead_quality_issue,
  // lead_quality_degradation) do not fire on the DETERMINISTIC per-campaign audit path
  // (campaign-decision.ts), which feeds diagnose() the deltas built by insightToMetrics +
  // comparePeriods below. The rules are correct in isolation (the direct-delta cases above prove
  // they fire on divergent inputs); the gap is purely upstream in this metric pipeline. diagnose()
  // has a second caller, the ads-analytics.diagnose agent tool, which runs on the agent's own
  // deltas and is NOT bound by this collapse; this tripwire covers the deterministic path only.
  //
  // If any test here FAILS, the deterministic pipeline has gained booking-cost resolution (cpl and
  // cpa sourced separately, or a costPerBooked metric). That is when a deterministic operator
  // surface (a WatchOutput, mirroring breach_building) plus an eval fixture become worthwhile.
  // See the reachability notes in metric-diagnostician.ts.
  function insightFor(o: { spend: number; conversions: number }): CampaignInsight {
    return {
      campaignId: "c1",
      campaignName: "C1",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      impressions: 10000,
      inlineLinkClicks: 500,
      spend: o.spend,
      conversions: o.conversions,
      revenue: 0,
      frequency: 1.5,
      cpm: 0,
      inlineLinkClickCtr: 0,
      costPerInlineLinkClick: 0,
      dateStart: "2026-05-01",
      dateStop: "2026-05-07",
    };
  }

  it("insightToMetrics collapses cpl and cpa to the same value", () => {
    // lead_quality_issue needs cpa up-significant while cpl is NOT significant; identical
    // numbers make that condition unsatisfiable on the live path.
    const m = insightToMetrics(insightFor({ spend: 5000, conversions: 25 }));
    expect(m.cpa).toBe(m.cpl);
  });

  it("comparePeriods emits no costPerBooked metric", () => {
    // lead_quality_degradation reads map.get("costPerBooked"); the live MetricSet never carries it.
    const deltas = comparePeriods(
      insightToMetrics(insightFor({ spend: 5000, conversions: 25 })),
      insightToMetrics(insightFor({ spend: 4000, conversions: 40 })),
    );
    expect(deltas.map((d) => d.metric)).not.toContain("costPerBooked");
  });

  it("yields no lead_quality_* diagnosis end-to-end even when acquisition cost spikes", () => {
    // spend up + conversions down => cpa (= cpl) spikes. In a booking-cost-aware world this would
    // read as lead_quality_issue (booking cost up, lead cost flat); here cpl moves in lockstep with
    // cpa, so that rule correctly abstains rather than fabricating a split that is not measured.
    // (The spike is not invisible deterministically: with the stable CTR in this fixture it surfaces
    // as audience_offer_mismatch; this assertion only pins that the lead_quality_* rules abstain.)
    const deltas = comparePeriods(
      insightToMetrics(insightFor({ spend: 6000, conversions: 20 })),
      insightToMetrics(insightFor({ spend: 4000, conversions: 50 })),
    );
    const patterns = diagnose(deltas).map((d) => d.pattern);
    expect(patterns).not.toContain("lead_quality_issue");
    expect(patterns).not.toContain("lead_quality_degradation");
  });
});
