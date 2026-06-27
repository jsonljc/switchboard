// EV-11 — Pre-real-money-flip gate. The cohesive, model-free money-safety group that MUST be
// green before any RILEY_*_SELF_EXECUTION_ENABLED flip lets Riley move real budget. Each leg pins
// a genuinely-uncovered residual with real teeth (a real cap-breach / sub-floor reallocation /
// non-finite-budget / shared-limiter regression FAILS — never a tautology):
//
//   MONEY-1  no-compound-runaway: the arbitrator's one-primary-per-cycle rule composed with the
//            per-move blast-radius cap bounds both a single cycle (multiple campaigns) and the
//            multi-cycle compounding sum. (single-pass arbitration + primary-only is already
//            covered by opportunity-arbitrator.test.ts; this composes them with the dollar cap.)
//   MONEY-3  source-reallocation is blocked below the 0.7 spend-attribution coverage floor — the
//            exact boundary (inclusive at the floor, refused just below). (both-below / one-below
//            far from the boundary are covered by source-reallocation.test.ts.)
//   MONEY-9  fresh-instance-per-call: two FRESH MetaAdsClient instances do not serialize on the
//            60s per-instance limiter (the rationale for the dispatch call-site contract). (the
//            same-instance interval is covered by meta-ads-client.test.ts.)
//   MONEY-10 updateCampaignBudget sane-ceiling is inclusive at $1,000,000.00, and a ±Infinity
//            budget is refused before any Meta write. (NaN / 0 / non-integer / one-cent-over are
//            covered by meta-ads-client-reallocation.test.ts.)
//
// MONEY-2 is dropped (campaign-decision.test.ts asserts the measurement_untrusted hold). MONEY-8
// (flag-default-OFF: env AND per-org) lives with its wiring — the per-org∧dep gate in
// inngest-functions-handoff.test.ts and the env half in apps/api self-execution-flags.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { arbitrate, type ArbitrateInput } from "../analyzers/opportunity-arbitrator.js";
import {
  assertWithinBlastRadius,
  DEFAULT_BLAST_RADIUS_CONTRACT,
} from "../blast-radius-contract.js";
import { decideSourceReallocation } from "../analyzers/source-reallocation.js";
import { SPEND_ATTRIBUTION_COVERAGE_FLOOR } from "../analyzers/spend-attributor.js";
import { assembleRevenueState, withSpendAttributionCoverage } from "../revenue-state.js";
import { resetsLearningFor } from "../action-reset-classification.js";
import { MetaAdsClient } from "../meta-ads-client.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import type { SourceComparisonRow } from "../analyzers/source-comparator.js";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";

// ──────────────────────────────────────────────────────────────────────────────
// MONEY-1 — no-compound-runaway (arbitrator one-move-per-cycle ∘ per-move cap)
// ──────────────────────────────────────────────────────────────────────────────

function rec(
  action: RecommendationOutput["action"],
  campaignId: string,
  overrides: Partial<RecommendationOutput> = {},
): RecommendationOutput {
  return {
    type: "recommendation",
    action,
    campaignId,
    campaignName: campaignId.toUpperCase(),
    confidence: 0.8,
    urgency: "this_week",
    estimatedImpact: "impact",
    steps: ["step"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
}

const trustedState: ArbitrateInput["revenueState"] = assembleRevenueState({
  measurementTrusted: true,
  economicTier: "booked_cac",
  effectiveTarget: 100,
  marginBasis: "unavailable",
});

describe("EV-11 pre-flip money gate — MONEY-1 (no compound runaway)", () => {
  it("acts on ONE arbitrated primary per cycle; the per-move cap refuses the summed multi-campaign delta", () => {
    // Three campaigns each carry a mutating candidate this cycle. The arbitrator names ONE
    // primary; the reallocate executor acts on the primary only (secondary are not submitted).
    const candidates = [rec("scale", "c1"), rec("scale", "c2"), rec("scale", "c3")];
    const r = arbitrate({
      candidates,
      revenueState: trustedState,
      currentInsights: [
        { campaignId: "c1", spend: 2_000 },
        { campaignId: "c2", spend: 3_000 },
        { campaignId: "c3", spend: 5_000 },
      ],
    });
    expect(r.primary).toBeDefined();
    expect(r.secondary).toHaveLength(2); // the other two campaigns are NOT acted on this cycle

    // Each campaign would move +$40 if all acted. The single arbitrated move is within the $50
    // per-move cap; acting on every in-cycle candidate (3 × $40 = $120) would breach it — so the
    // arbitrator's one-primary rule is what keeps a single cycle to ONE capped move.
    const perCampaignDeltaCents = 40_00;
    const accountSpendCents = 10_000_00; // $10,000/day account
    expect(
      assertWithinBlastRadius(
        DEFAULT_BLAST_RADIUS_CONTRACT,
        perCampaignDeltaCents,
        accountSpendCents,
      ),
    ).toEqual({ ok: true });
    expect(
      assertWithinBlastRadius(
        DEFAULT_BLAST_RADIUS_CONTRACT,
        perCampaignDeltaCents * candidates.length,
        accountSpendCents,
      ),
    ).toEqual({ ok: false, reason: "DELTA_CAP" });
  });

  it("bounds multi-cycle compounding: N at-cap moves stay capped, and no single catch-up move can compound past the cap", () => {
    const cap = DEFAULT_BLAST_RADIUS_CONTRACT.maxDeltaCents; // $50.00
    const cycles = 5;
    // The read-modify-re-read executor re-reads a (growing) account spend each cycle.
    let accountSpendCents = 1_000_00; // $1,000/day to start
    let cumulativeCents = 0;
    for (let cycle = 0; cycle < cycles; cycle++) {
      // Worst case: each cycle proposes a move EXACTLY at the cap (inclusive boundary).
      expect(
        assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, cap, accountSpendCents),
      ).toEqual({ ok: true });
      cumulativeCents += cap;
      accountSpendCents += cap;
    }
    expect(cumulativeCents).toBe(cycles * cap);

    // The only way to move the cumulative amount is `cycles` separate capped moves, each
    // individually gated. A single move applying the whole compounded sum at once is refused, so
    // compounding can never bypass the per-move cap.
    expect(
      assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, cumulativeCents, accountSpendCents),
    ).toEqual({ ok: false, reason: "DELTA_CAP" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// MONEY-3 — source-reallocation 0.7 spend-attribution coverage floor (exact boundary)
// ──────────────────────────────────────────────────────────────────────────────

const funnel = (over: Partial<SourceFunnel>): SourceFunnel => ({
  received: 40,
  qualified: 20,
  booked: 10,
  showed: 0,
  paid: 8,
  revenue: 0,
  ...over,
});
const row = (
  source: string,
  trueRoas: number | null,
  closeRate: number | null,
): SourceComparisonRow => ({
  source,
  cpl: 10,
  costPerQualified: 20,
  costPerBooked: 30,
  closeRate,
  trueRoas,
});
const makeState = (coverage: Record<string, number>) =>
  withSpendAttributionCoverage(assembleRevenueState({ measurementTrusted: true }), coverage);
// A clear, profitable winner (ctwa 3.8 vs instant_form 1.5: ratio 2.53× ≥ 2×, winner ≥ 1) with
// evidence on both sides — so the COVERAGE floor is the only deciding gate. findShiftCandidates
// picks from=instant_form (worst), to=ctwa (best).
const reallocBase = {
  bySource: { ctwa: funnel({}), instant_form: funnel({}) } as Record<string, SourceFunnel>,
  accountEvidence: { clicks: 200, conversions: 20, days: 7 },
  sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
  nextCycleDate: "2026-05-14",
};

describe("EV-11 pre-flip money gate — MONEY-3 (0.7 spend-attribution coverage floor)", () => {
  it("pins the spend-attribution coverage floor at 0.7 (eval-tunable, never silently)", () => {
    expect(SPEND_ATTRIBUTION_COVERAGE_FLOOR).toBe(0.7);
  });

  it("ALLOWS a reallocation when both sources sit EXACTLY at the floor (inclusive boundary)", () => {
    const r = decideSourceReallocation({
      ...reallocBase,
      revenueState: makeState({
        ctwa: SPEND_ATTRIBUTION_COVERAGE_FLOOR,
        instant_form: SPEND_ATTRIBUTION_COVERAGE_FLOOR,
      }),
    });
    expect(r?.type).toBe("recommendation");
    expect(r && "action" in r && r.action).toBe("shift_budget_to_source");
  });

  it("BLOCKS when the from-source coverage is a hair below the floor (per-source gate)", () => {
    const r = decideSourceReallocation({
      ...reallocBase,
      revenueState: makeState({
        ctwa: SPEND_ATTRIBUTION_COVERAGE_FLOOR,
        instant_form: SPEND_ATTRIBUTION_COVERAGE_FLOOR - 0.01,
      }),
    });
    expect(r).toBeNull();
  });

  it("BLOCKS when the to-source coverage is a hair below the floor (per-source gate)", () => {
    const r = decideSourceReallocation({
      ...reallocBase,
      revenueState: makeState({
        ctwa: SPEND_ATTRIBUTION_COVERAGE_FLOOR - 0.01,
        instant_form: SPEND_ATTRIBUTION_COVERAGE_FLOOR,
      }),
    });
    expect(r).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// MONEY-9 + MONEY-10 — MetaAdsClient money-write contracts
// ──────────────────────────────────────────────────────────────────────────────

describe("EV-11 pre-flip money gate — MetaAdsClient money-write contracts", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const BASE_URL = "https://graph.facebook.com/v21.0";

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("MONEY-9 (fresh-instance-per-call: the 60s limiter is per-instance)", () => {
    it("does NOT serialize two FRESH client instances (each first call runs immediately, no 60s wait)", async () => {
      // The per-instance limiter exists to pace the audit crons, NOT interactive/dispatch paths;
      // each dispatch builds a fresh client so independent operator-approved money moves never
      // queue behind one another's 60s window. With NO timer advance, both fresh clients fetch:
      // a regression to a shared/static limiter would stall the second call and hang this test.
      fetchSpy.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ id: "camp_1", name: "X", status: "ACTIVE", daily_budget: "5000" }),
      });
      const c1 = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
      const c2 = new MetaAdsClient({ accessToken: "t", accountId: "act_2" });
      await c1.getCampaign("camp_1");
      await c2.getCampaign("camp_1");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("MONEY-10 (updateCampaignBudget sane-ceiling boundary + non-finite guard)", () => {
    it("ALLOWS a budget EXACTLY at the $1,000,000.00 sane ceiling (inclusive)", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
      const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
      // 100_000_000 cents == $1,000,000.00/day: at the ceiling is allowed, only over refuses.
      await expect(client.updateCampaignBudget("camp_1", 100_000_000)).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`${BASE_URL}/camp_1`);
      expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
        daily_budget: 100_000_000,
      });
    });

    it("REFUSES a +Infinity budget WITHOUT calling Meta (finite guard)", async () => {
      const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
      await expect(
        client.updateCampaignBudget("camp_1", Number.POSITIVE_INFINITY),
      ).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("REFUSES a -Infinity budget WITHOUT calling Meta (finite guard)", async () => {
      const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
      await expect(
        client.updateCampaignBudget("camp_1", Number.NEGATIVE_INFINITY),
      ).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
