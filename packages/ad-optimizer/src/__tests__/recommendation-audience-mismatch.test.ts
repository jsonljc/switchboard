// packages/ad-optimizer/src/__tests__/recommendation-audience-mismatch.test.ts
//
// D1-3: surfacing the audience_offer_mismatch diagnosis as an informational watch. Lives in its own
// file (recommendation-engine.test.ts is at the eslint max-lines limit). Helpers are defined locally,
// matching the existing convention (recommendation-engine.test.ts + metric-diagnostician.test.ts each
// define their own) — there is no shared helper module to import.
import { describe, it, expect } from "vitest";
import { generateRecommendations } from "../recommendation-engine.js";
import type { RecommendationInput } from "../recommendation-engine.js";
import type { Diagnosis } from "../metric-diagnostician.js";
import type {
  MetricDeltaSchema as MetricDelta,
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
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

function makeDiagnosis(pattern: string): Diagnosis {
  return { pattern, description: `${pattern} description`, confidence: "high" };
}

function recs(result: (RecommendationOutput | WatchOutput)[]): RecommendationOutput[] {
  return result.filter((r): r is RecommendationOutput => r.type === "recommendation");
}

const watchPatternsOf = (out: (RecommendationOutput | WatchOutput)[]): string[] =>
  out.filter((o): o is WatchOutput => o.type === "watch").map((w) => w.pattern);

describe("audience_offer_mismatch visibility (D1-3)", () => {
  // "Strong clicks but low conversions": ctr holding/rising while cpa rises significantly, but the
  // cost stays sub-2x and the breach is not durable, so NO rec / burn / breach_building fires. The
  // diagnostician emits this (high confidence) yet no rec branch consumes it, so today the campaign
  // gets pure silence. The watch makes that gap visible. (Inputs feed diagnoses/deltas directly so
  // the engine gate is tested in isolation from the diagnostician's matching.)
  const mismatchInput = (over: Partial<RecommendationInput> = {}): RecommendationInput => ({
    campaignId: "camp-mismatch",
    campaignName: "Audience Offer Mismatch",
    diagnoses: [makeDiagnosis("audience_offer_mismatch")],
    deltas: [makeDelta("cpa", 160, 80, "up", true)], // 1.6x target, up-significant, < 2x
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 4000,
    targetBreach: { periodsAboveTarget: 3, granularity: "daily", isApproximate: false },
    evidence: { clicks: 600, conversions: 25, days: 7 },
    ...over,
  });

  it("surfaces an audience_offer_mismatch watch when the diagnosis fires and nothing else does", () => {
    const out = generateRecommendations(mismatchInput());
    expect(watchPatternsOf(out)).toContain("audience_offer_mismatch");
    const watch = out.find(
      (o): o is WatchOutput => o.type === "watch" && o.pattern === "audience_offer_mismatch",
    )!;
    expect(watch.type).toBe("watch");
    // The engine leaves checkBackDate blank; campaign-decision.ts fills it from nextCycleDate.
    expect(watch.checkBackDate).toBe("");
    // Purely additive: no recommendation is invented for this advisory signal.
    expect(recs(out)).toHaveLength(0);
  });

  it("is SUPPRESSED when a destructive rec already fired (add_creative/pause own a durable 2x+ breach)", () => {
    const out = generateRecommendations(
      mismatchInput({
        deltas: [makeDelta("cpa", 350, 80, "up", true)], // 3.5x target
        targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
      }),
    );
    // The operator already has a strong action; an advisory on top would be noise.
    expect(watchPatternsOf(out)).not.toContain("audience_offer_mismatch");
    expect(recs(out).some((r) => r.action === "add_creative")).toBe(true);
  });

  it("is SUPPRESSED when breach_building already surfaced (sub-durable 2x+ breach)", () => {
    const out = generateRecommendations(
      mismatchInput({
        deltas: [makeDelta("cpa", 250, 80, "up", true)], // 2.5x target
        targetBreach: { periodsAboveTarget: 3, granularity: "daily", isApproximate: false },
      }),
    );
    expect(watchPatternsOf(out)).toContain("breach_building");
    expect(watchPatternsOf(out)).not.toContain("audience_offer_mismatch");
  });

  it("is SUPPRESSED when a landing_page_drop hold already fired for the same campaign", () => {
    const out = generateRecommendations(
      mismatchInput({
        diagnoses: [makeDiagnosis("landing_page_drop"), makeDiagnosis("audience_offer_mismatch")],
        deltas: [makeDelta("cpa", 150, 80, "up", true)], // 1.5x, sub-2x so no breach/add_creative
      }),
    );
    expect(recs(out).some((r) => r.action === "hold")).toBe(true);
    expect(watchPatternsOf(out)).not.toContain("audience_offer_mismatch");
  });

  it("is SUPPRESSED when a zero-conversion burn already fired (gate sees the prepended burn)", () => {
    // Artificial co-presence (a real burn reads cpa=0, which can't satisfy the diagnosis's cpa-up
    // arm) — pins that the gate is robust to a prepended burn output, not just an appended one.
    const out = generateRecommendations(
      mismatchInput({
        deltas: [makeDelta("cpa", 0, 80, "down", true)], // burn collapses cpa to 0
        currentSpend: 4000,
        evidence: { clicks: 600, conversions: 0, days: 7 },
        targetBreach: { periodsAboveTarget: 3, granularity: "daily", isApproximate: false },
      }),
    );
    expect(watchPatternsOf(out)).toContain("burn");
    expect(watchPatternsOf(out)).not.toContain("audience_offer_mismatch");
  });

  it("does NOT fire when the diagnosis is absent, even in pure silence", () => {
    const out = generateRecommendations(
      mismatchInput({
        diagnoses: [],
        deltas: [makeDelta("cpa", 100, 100, "stable", false)],
        targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      }),
    );
    expect(watchPatternsOf(out)).not.toContain("audience_offer_mismatch");
  });

  // Deliberate-exclusion guards. competition_increase (informational; the operator can't control the
  // auction) and account_level_issue (low confidence; on the deterministic seam cpl===cpa so a single
  // cost rise double-counts toward its ">=3 metrics degrading" gate, making "all metrics degrading"
  // misleading copy) FIRE on this seam but are intentionally NOT surfaced as watches. These pin that
  // decision so it is not silently reversed. See the marker comments in metric-diagnostician.ts.
  it("does NOT surface a competition_increase watch (informational, deliberately advisory-only)", () => {
    const out = generateRecommendations(
      mismatchInput({
        diagnoses: [makeDiagnosis("competition_increase")],
        deltas: [makeDelta("cpa", 100, 100, "stable", false)],
        targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      }),
    );
    expect(watchPatternsOf(out)).toHaveLength(0);
  });

  it("does NOT surface an account_level_issue watch (low confidence + cpl===cpa double-count)", () => {
    const out = generateRecommendations(
      mismatchInput({
        diagnoses: [makeDiagnosis("account_level_issue")],
        deltas: [makeDelta("cpa", 100, 100, "stable", false)],
        targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      }),
    );
    expect(watchPatternsOf(out)).toHaveLength(0);
  });
});
