// EV-11 - Pre-real-money-flip gate. The cohesive, model-free money-safety group that MUST be
// green before any RILEY_*_SELF_EXECUTION_ENABLED flip lets Riley move real budget. Each leg pins
// a genuinely-uncovered residual with real teeth (a real cap-breach / sub-floor reallocation /
// non-finite-budget / shared-limiter regression FAILS - never a tautology):
//
//   MONEY-1  no-compound-runaway: the reallocate dollar-move path is NOT arbitration-primary-gated
//            (every scale rec surfaces its own move; only pause is primary-only), so the runaway
//            envelope is PER-MOVE - each move is bounded by the blast-radius cap (dollar + account-
//            share) + mandatory human approval, not by an aggregate/arbitration bound. Pins the
//            previously-untested candidate->cap seam + the not-primary-gated fact. (single-move caps
//            stay covered by blast-radius-contract.test.ts; arbitration by opportunity-arbitrator.)
//   MONEY-3  source-reallocation is blocked below the 0.7 spend-attribution coverage floor - the
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
// (flag-default-OFF: env AND per-org) lives with its wiring - the per-org∧dep gate in
// inngest-functions-handoff.test.ts and the env half in apps/api self-execution-flags.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRileyBudgetCandidate } from "../riley-budget-dispatch.js";
import { buildRileyPauseCandidate } from "../riley-pause-dispatch.js";
import {
  assertWithinBlastRadius,
  DEFAULT_BLAST_RADIUS_CONTRACT,
} from "../blast-radius-contract.js";
import { decideSourceReallocation } from "../analyzers/source-reallocation.js";
import { SPEND_ATTRIBUTION_COVERAGE_FLOOR } from "../analyzers/spend-attributor.js";
import { assembleRevenueState, withSpendAttributionCoverage } from "../revenue-state.js";
import { MetaAdsClient } from "../meta-ads-client.js";
import type { SourceComparisonRow } from "../analyzers/source-comparator.js";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";

// ------------------------------------------------------------------------------
// MONEY-1 - no compound runaway: the reallocate money path's true safety envelope
// ------------------------------------------------------------------------------
// HONEST MODEL (verified against source). The reallocate dollar-move path is NOT
// arbitration-primary-gated. buildRileyPauseCandidate is primary-only by construction
// (riley-pause-dispatch.ts:57; covered by riley-pause-dispatch.test.ts), but the reallocate producer
// buildRileyBudgetCandidate has no primary gate (riley-budget-dispatch.ts:47-56), so
// recommendation-sink.ts:543 dispatches a reallocation for EVERY scale rec. Multiple budget moves can
// therefore surface in ONE cycle. The runaway envelope is consequently PER-MOVE, not aggregate: each
// move parks for MANDATORY human approval AND is bounded at execution by assertWithinBlastRadius (a
// dollar cap PLUS an account-spend-SHARE cap) + the kill-switch + the post-exec guardrail monitor.
// There is no automatic aggregate per-cycle or cross-cycle cap; "no compound runaway" rests on the
// per-move cap + the mandatory human gate. The single-move cap legs themselves live in
// blast-radius-contract.test.ts; this leg pins the previously-untested candidate->cap seam and the
// not-primary-gated cross-campaign behaviour the audit's "arbitration submits only the primary"
// premise does NOT cover for the reallocate path.

const budgetCtx = {
  evidence: { clicks: 100, conversions: 10, days: 7 },
  learningPhaseActive: false,
};
function scaleCandidate(campaignId: string, currentCents: number, proposedCents: number) {
  return buildRileyBudgetCandidate({
    emitted: {
      recommendationId: `rec_${campaignId}`,
      actionType: "scale",
      campaignId,
      rationale: "scale the daily budget up",
      surface: "queue",
    },
    currentDailyBudgetCents: currentCents,
    proposedDailyBudgetCents: proposedCents,
    context: budgetCtx,
    organizationId: "org-1",
    deploymentId: "dep-riley",
    adAccountId: "act_1",
  });
}

describe("EV-11 pre-flip money gate - MONEY-1 (reallocate runaway envelope: per-move, not arbitration-gated)", () => {
  it("is NOT primary-gated: every scale rec in a cycle surfaces its own reallocation candidate (pause alone is primary-only)", () => {
    // Three scale recs across three campaigns each produce a money-move candidate in ONE cycle, so
    // the per-cycle runaway bound is per-move + human approval, never a single arbitrated move.
    // Teeth: adding a primary gate to the reallocate producer would drop this below three.
    const candidates = [
      scaleCandidate("c1", 4_000, 4_800),
      scaleCandidate("c2", 5_000, 6_000),
      scaleCandidate("c3", 6_000, 7_200),
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map((c) => c.campaignId))).toEqual(new Set(["c1", "c2", "c3"]));

    // Contrast (corrects the audit premise): the PAUSE path IS structurally primary-only, so a
    // non-primary pause never self-submits - one pause per cycle. The reallocate path has no such
    // gate, which is exactly why its runaway envelope must be per-move.
    const nonPrimaryPause = buildRileyPauseCandidate({
      emitted: {
        recommendationId: "rec_pause",
        actionType: "pause",
        campaignId: "c1",
        rationale: "pause the bleeder",
        surface: "queue",
      },
      index: 2,
      primaryPauseIndex: 1, // this pause is NOT the arbitration primary
      context: budgetCtx,
      organizationId: "org-1",
      deploymentId: "dep-riley",
    });
    expect(nonPrimaryPause).toBeNull();
  });

  it("bounds EACH surfaced reallocation by the per-move blast-radius cap (the candidate->executor seam)", () => {
    // Feed the REAL candidate's proposed delta into the REAL pre-write cap the executor applies
    // (riley-budget-execution-workflow.ts:342). The executor sizes its delta from an execution-time
    // re-read (toCents - live), which equals this proposed - current absent drift (drift is gated
    // separately by assessBudgetDrift). A healthy +$40 move is within the envelope on a large
    // account; the SAME move is refused on a small account because it is too large a SHARE of account
    // spend - the relative-size bound a flat dollar cap misses, and the protection that keeps several
    // simultaneous moves from each taking a big bite of a small budget.
    const candidate = scaleCandidate("c1", 20_000, 24_000);
    expect(candidate).not.toBeNull();
    const deltaCents = candidate!.proposedDailyBudgetCents - candidate!.currentDailyBudgetCents;
    expect(deltaCents).toBe(40_00);
    expect(assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, deltaCents, 10_000_00)).toEqual({
      ok: true,
    });
    // $40 move on a $120/day account = 0.33 share > the 0.25 cap -> refused before any Meta write.
    expect(assertWithinBlastRadius(DEFAULT_BLAST_RADIUS_CONTRACT, deltaCents, 120_00)).toEqual({
      ok: false,
      reason: "SHARE_CAP",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// MONEY-3 - source-reallocation 0.7 spend-attribution coverage floor (exact boundary)
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
// evidence on both sides - so the COVERAGE floor is the only deciding gate. findShiftCandidates
// picks from=instant_form (worst), to=ctwa (best).
const reallocBase = {
  bySource: { ctwa: funnel({}), instant_form: funnel({}) } as Record<string, SourceFunnel>,
  accountEvidence: { clicks: 200, conversions: 20, days: 7 },
  sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
  nextCycleDate: "2026-05-14",
};

describe("EV-11 pre-flip money gate - MONEY-3 (0.7 spend-attribution coverage floor)", () => {
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
// MONEY-9 + MONEY-10 - MetaAdsClient money-write contracts
// ──────────────────────────────────────────────────────────────────────────────

describe("EV-11 pre-flip money gate - MetaAdsClient money-write contracts", () => {
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
      // (The same-instance interval itself is covered by meta-ads-client.test.ts "rate limiting".)
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

    it("REFUSES a +Infinity budget via the safe-integer guard, WITHOUT calling Meta", async () => {
      const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
      await expect(client.updateCampaignBudget("camp_1", Number.POSITIVE_INFINITY)).rejects.toThrow(
        /integer cents/i,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("REFUSES a -Infinity budget via the safe-integer guard, WITHOUT calling Meta", async () => {
      const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
      await expect(client.updateCampaignBudget("camp_1", Number.NEGATIVE_INFINITY)).rejects.toThrow(
        /integer cents/i,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
