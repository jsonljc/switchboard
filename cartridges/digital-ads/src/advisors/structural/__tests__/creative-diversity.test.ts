import { describe, it, expect } from "vitest";
import { creativeDiversityAdvisor } from "../creative-diversity.js";
import type { MetricSnapshot, DiagnosticContext, AdBreakdown } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
  };
}

function makeAd(overrides: Partial<AdBreakdown> = {}): AdBreakdown {
  return {
    adId: "ad_1",
    adSetId: "adset_1",
    spend: 100,
    impressions: 10000,
    clicks: 200,
    conversions: 10,
    cpa: 10,
    ctr: 2.0,
    format: "image",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("creativeDiversityAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no ad breakdown data", () => {
    const findings = creativeDiversityAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when ad sets have adequate creative diversity", () => {
    const ads = [
      makeAd({ adId: "ad_1", adSetId: "adset_1", spend: 100, format: "image" }),
      makeAd({ adId: "ad_2", adSetId: "adset_1", spend: 100, format: "video" }),
      makeAd({ adId: "ad_3", adSetId: "adset_1", spend: 100, format: "carousel" }),
      makeAd({ adId: "ad_4", adSetId: "adset_2", spend: 100, format: "image" }),
      makeAd({ adId: "ad_5", adSetId: "adset_2", spend: 100, format: "video" }),
      makeAd({ adId: "ad_6", adSetId: "adset_2", spend: 100, format: "carousel" }),
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeDiversityAdvisor([], [], snapshot, snapshot, context);

    // No thin portfolio, no dominance, format diversity exists
    expect(
      findings.every((f) => f.severity === "healthy" || f.severity === "info")
    ).toBe(true);
  });

  it("flags ad sets with fewer than 3 active ads", () => {
    const ads = [
      makeAd({ adId: "ad_1", adSetId: "adset_1", spend: 200 }),
      makeAd({ adId: "ad_2", adSetId: "adset_1", spend: 200 }),
      // adset_1 has only 2 active ads
      makeAd({ adId: "ad_3", adSetId: "adset_2", spend: 100 }),
      // adset_2 has only 1 active ad
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeDiversityAdvisor([], [], snapshot, snapshot, context);

    const thinFinding = findings.find((f) =>
      f.message.includes("fewer than 3 active ads")
    );
    expect(thinFinding).toBeDefined();
  });

  it("flags single-ad spend dominance > 80%", () => {
    const ads = [
      makeAd({ adId: "ad_1", adSetId: "adset_1", spend: 900 }),
      makeAd({ adId: "ad_2", adSetId: "adset_1", spend: 50 }),
      makeAd({ adId: "ad_3", adSetId: "adset_1", spend: 50 }),
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeDiversityAdvisor([], [], snapshot, snapshot, context);

    const dominanceFinding = findings.find((f) =>
      f.message.includes(">80% of spend")
    );
    expect(dominanceFinding).toBeDefined();
  });

  it("flags lack of format diversity across all ads", () => {
    const ads = Array.from({ length: 6 }, (_, i) =>
      makeAd({
        adId: `ad_${i}`,
        adSetId: `adset_${i % 2}`,
        spend: 100,
        format: "image",
      })
    );
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeDiversityAdvisor([], [], snapshot, snapshot, context);

    const formatFinding = findings.find((f) =>
      f.message.includes("same format")
    );
    expect(formatFinding).toBeDefined();
  });

  it("does not flag format homogeneity with few ads", () => {
    const ads = [
      makeAd({ adId: "ad_1", adSetId: "adset_1", spend: 200, format: "image" }),
      makeAd({ adId: "ad_2", adSetId: "adset_1", spend: 200, format: "image" }),
      makeAd({ adId: "ad_3", adSetId: "adset_1", spend: 200, format: "image" }),
    ];
    const context: DiagnosticContext = { adBreakdowns: ads };
    const findings = creativeDiversityAdvisor([], [], snapshot, snapshot, context);

    // Only 3 ads, format check requires >= 5
    const formatFinding = findings.find((f) =>
      f.message.includes("same format")
    );
    expect(formatFinding).toBeUndefined();
  });
});
