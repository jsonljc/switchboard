import { describe, it, expect } from "vitest";
import { creativeWinLossAdvisor } from "../creative-win-loss.js";
import type {
  MetricSnapshot,
  DiagnosticContext,
  AdBreakdown,
} from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
    ...overrides,
  };
}

function makeAd(overrides: Partial<AdBreakdown> = {}): AdBreakdown {
  return {
    adId: "ad_1",
    adSetId: "as_1",
    spend: 100,
    impressions: 10000,
    clicks: 100,
    conversions: 10,
    cpa: 10,
    ctr: 1,
    format: "image",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("creativeWinLossAdvisor", () => {
  it("returns no findings when no ad breakdowns available", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = creativeWinLossAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings with only 1 ad per ad set", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      adBreakdowns: [makeAd()],
    };
    const findings = creativeWinLossAdvisor([], [], current, previous, context);
    expect(findings).toHaveLength(0);
  });

  it("identifies losers with CPA > 2x average", () => {
    const ads: AdBreakdown[] = [
      makeAd({ adId: "ad_1", adSetId: "as_1", spend: 200, conversions: 20 }), // CPA = 10
      makeAd({ adId: "ad_2", adSetId: "as_1", spend: 200, conversions: 4 }),  // CPA = 50 (5x avg)
      makeAd({ adId: "ad_3", adSetId: "as_1", spend: 100, conversions: 10 }), // CPA = 10
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeWinLossAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const loserFindings = findings.filter((f) =>
      f.message.includes("underperforming")
    );
    expect(loserFindings.length).toBeGreaterThanOrEqual(1);
    expect(loserFindings[0].message).toContain("ad_2");
  });

  it("identifies winners with CPA < 60% of average", () => {
    const ads: AdBreakdown[] = [
      makeAd({ adId: "ad_1", adSetId: "as_1", spend: 100, conversions: 50 }), // CPA = 2 (winner)
      makeAd({ adId: "ad_2", adSetId: "as_1", spend: 300, conversions: 10 }), // CPA = 30
      makeAd({ adId: "ad_3", adSetId: "as_1", spend: 100, conversions: 5 }),  // CPA = 20
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeWinLossAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const winnerFindings = findings.filter((f) =>
      f.message.includes("top-performing")
    );
    expect(winnerFindings.length).toBeGreaterThanOrEqual(1);
    expect(winnerFindings[0].message).toContain("ad_1");
  });

  it("flags zero-conversion ads with significant spend", () => {
    const ads: AdBreakdown[] = [
      makeAd({ adId: "ad_1", adSetId: "as_1", spend: 200, conversions: 20 }),
      makeAd({ adId: "ad_2", adSetId: "as_1", spend: 150, conversions: 0 }), // 43% share, 0 conv
      makeAd({ adId: "ad_3", adSetId: "as_1", spend: 100, conversions: 10 }),
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeWinLossAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const loserFindings = findings.filter((f) =>
      f.message.includes("underperforming") || f.message.includes("0 conversions")
    );
    expect(loserFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("escalates to critical when >20% of spend is wasted", () => {
    const ads: AdBreakdown[] = [
      makeAd({ adId: "ad_1", adSetId: "as_1", spend: 100, conversions: 20 }), // CPA = 5
      makeAd({ adId: "ad_2", adSetId: "as_1", spend: 400, conversions: 3 }),  // CPA = 133 (loser)
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeWinLossAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    const loserFindings = findings.filter(
      (f) => f.message.includes("underperforming")
    );
    expect(loserFindings.length).toBeGreaterThanOrEqual(1);
    expect(loserFindings[0].severity).toBe("critical");
  });

  it("does not flag ads with too few conversions as winners/losers", () => {
    const ads: AdBreakdown[] = [
      makeAd({ adId: "ad_1", adSetId: "as_1", spend: 200, conversions: 10 }),
      makeAd({ adId: "ad_2", adSetId: "as_1", spend: 50, conversions: 2 }), // Only 2 conv — skip
      makeAd({ adId: "ad_3", adSetId: "as_1", spend: 150, conversions: 10 }),
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeWinLossAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );

    // ad_2 has <3 conversions, should not be classified as winner/loser
    const ad2Mentions = findings.filter((f) => f.message.includes("ad_2"));
    expect(ad2Mentions).toHaveLength(0);
  });
});
