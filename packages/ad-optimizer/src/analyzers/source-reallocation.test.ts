import { describe, it, expect } from "vitest";
import {
  decideSourceReallocation,
  computeAuditEconomicsSections,
  MIN_SOURCE_BOOKINGS,
} from "./source-reallocation.js";
import { assembleRevenueState, withSpendAttributionCoverage } from "../revenue-state.js";
import type { SourceComparisonRow } from "./source-comparator.js";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AdSetLearningInput,
} from "@switchboard/schemas";

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
const goodEvidence = { clicks: 200, conversions: 20, days: 7 };
// RevenueState carries the account-level measurementTrusted + the per-source spend-attribution
// coverage (completed late). Default: trusted + both candidate sources fully ad-set-attributed
// (coverage 1.0); individual tests override via the args.
const makeState = (
  over: { measurementTrusted?: boolean; coverage?: Record<string, number> } = {},
) =>
  withSpendAttributionCoverage(
    assembleRevenueState({ measurementTrusted: over.measurementTrusted ?? true }),
    over.coverage ?? { ctwa: 1, instant_form: 1 },
  );
const base = {
  bySource: { ctwa: funnel({}), instant_form: funnel({}) } as Record<string, SourceFunnel>,
  accountEvidence: goodEvidence,
  revenueState: makeState(),
  nextCycleDate: "2026-05-14",
};

describe("decideSourceReallocation", () => {
  it("recommends a shift toward the materially-better source (>=2x trueRoas, evidence both sides)", () => {
    const r = decideSourceReallocation({
      ...base,
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r?.type).toBe("recommendation");
    expect(r && "action" in r && r.action).toBe("shift_budget_to_source");
    expect(r && "campaignId" in r && r.campaignId).toBe("account");
    expect(r && "params" in r && r.params).toMatchObject({ from: "instant_form", to: "ctwa" });
    // honest economic basis carried for the approval card (read by the sink helper)
    expect(r && "params" in r && r.params).toMatchObject({
      fromTrueRoas: "1.50",
      toTrueRoas: "3.80",
    });
    // advisory-only: not swipe-approvable handling lives downstream; here just the action contract
    expect(r && "resetsLearning" in r && r.resetsLearning).toBe("conditional");
  });

  it("returns null when economics are tied (ratio < 2x) — no signal, no abstention noise", () => {
    const r = decideSourceReallocation({
      ...base,
      sourceComparison: { rows: [row("ctwa", 2.0, 0.2), row("instant_form", 1.8, 0.07)] },
    });
    expect(r).toBeNull();
  });

  it("returns null when fewer than two sources have comparable economics", () => {
    const r = decideSourceReallocation({
      ...base,
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", null, null)] },
    });
    expect(r).toBeNull();
  });

  it("returns null when the relatively-better source is itself unprofitable (trueRoas < 1)", () => {
    const r = decideSourceReallocation({
      ...base,
      sourceComparison: { rows: [row("ctwa", 0.05, 0.2), row("instant_form", 0.01, 0.1)] },
    });
    expect(r).toBeNull();
  });

  it("returns null when both sources' spend is below the attribution-coverage floor", () => {
    const r = decideSourceReallocation({
      ...base,
      revenueState: makeState({ coverage: { ctwa: 0.5, instant_form: 0.5 } }),
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r).toBeNull();
  });

  it("returns null when only ONE candidate source is below the coverage floor (per-source gate)", () => {
    // ctwa (winner) is well-attributed but instant_form (the from side) is entirely lead-share.
    // An account-wide gate would bless this; the per-source gate must abstain.
    const r = decideSourceReallocation({
      ...base,
      revenueState: makeState({ coverage: { ctwa: 1, instant_form: 0 } }),
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r).toBeNull();
  });

  it("abstains to insufficient_evidence when a side is under the per-source booking floor", () => {
    const r = decideSourceReallocation({
      ...base,
      bySource: { ctwa: funnel({}), instant_form: funnel({ booked: MIN_SOURCE_BOOKINGS - 1 }) },
      sourceComparison: { rows: [row("ctwa", 4.0, 0.25), row("instant_form", 1.0, 0.05)] },
    });
    expect(r?.type).toBe("watch");
    expect(r && "pattern" in r && r.pattern).toBe("insufficient_evidence");
    expect(r && "checkBackDate" in r && r.checkBackDate).toBe("2026-05-14");
  });

  it("abstains to measurement_untrusted when the cost signal is suspect this cycle", () => {
    const r = decideSourceReallocation({
      ...base,
      revenueState: makeState({ measurementTrusted: false }),
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r?.type).toBe("watch");
    expect(r && "pattern" in r && r.pattern).toBe("measurement_untrusted");
  });

  it("abstains to insufficient_evidence when account-wide volume is under the scale floor", () => {
    const r = decideSourceReallocation({
      ...base,
      accountEvidence: { clicks: 20, conversions: 20, days: 7 }, // clicks < 30 (scale floor)
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r?.type).toBe("watch");
    expect(r && "pattern" in r && r.pattern).toBe("insufficient_evidence");
  });
});

describe("computeAuditEconomicsSections", () => {
  const insight = (over: Partial<CampaignInsight>): CampaignInsight => ({
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 10000,
    inlineLinkClicks: 200,
    spend: 100,
    conversions: 20,
    revenue: 0,
    frequency: 1.2,
    cpm: 0,
    inlineLinkClickCtr: 0,
    costPerInlineLinkClick: 0,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...over,
  });
  const sectionBase = {
    currentInsights: [insight({})],
    adSetData: null,
    revenueState: assembleRevenueState({ measurementTrusted: true }),
    nextCycleDate: "2026-05-14",
    orgId: "org-1",
    dateRange: { since: "2026-05-01", until: "2026-05-07" },
  };

  it("returns nothing when the provider gave no per-source / per-campaign funnel", async () => {
    const out = await computeAuditEconomicsSections({
      ...sectionBase,
      bySource: undefined,
      byCampaign: undefined,
    });
    expect(out.reallocation).toBeNull();
    expect(out.sourceComparison).toBeUndefined();
    expect(out.campaignEconomics).toBeUndefined();
  });

  it("abstains from the reallocation when spend attribution is lead-share-only (no ad-set data)", async () => {
    // sectionBase has adSetData: null, so computeSpendBySource uses the lead-share
    // fallback. The per-source comparison still reaches the report, but the synthetic
    // per-source spend must NOT drive a budget decision (the production cron path today).
    const out = await computeAuditEconomicsSections({
      ...sectionBase,
      currentInsights: [insight({ spend: 100, inlineLinkClicks: 200, conversions: 20 })],
      bySource: {
        ctwa: funnel({ received: 40, booked: 10, paid: 12, revenue: 38000 }),
        instant_form: funnel({ received: 30, booked: 6, paid: 3, revenue: 10000 }),
      },
      byCampaign: undefined,
    });
    expect(out.sourceComparison?.rows.length).toBe(2);
    expect(out.reallocation).toBeNull();
  });

  const adSet = (
    campaignId: string,
    adSetId: string,
    destinationType: string,
    spend: number,
  ): AdSetLearningInput => ({
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
  });
  const winnerBySource = {
    ctwa: funnel({ received: 40, booked: 10, paid: 12, revenue: 38000 }),
    instant_form: funnel({ received: 30, booked: 6, paid: 3, revenue: 10000 }),
  };

  it("FIRES the reallocation when ad-set attribution coverage clears the floor (real attribution)", async () => {
    // Two single-source campaigns, each fully ad-set-attributed → coverage 1.0 ≥ floor.
    // Per-source spend (ctwa 100 / instant_form 100) yields trueROAS 3.8 vs 1.0 → clear winner.
    const out = await computeAuditEconomicsSections({
      ...sectionBase,
      currentInsights: [
        insight({ campaignId: "c_ctwa", spend: 100, inlineLinkClicks: 200, conversions: 20 }),
        insight({ campaignId: "c_if", spend: 100, inlineLinkClicks: 200, conversions: 20 }),
      ],
      adSetData: [
        adSet("c_ctwa", "as_ctwa", "WHATSAPP", 100),
        adSet("c_if", "as_if", "ON_AD", 100),
      ],
      bySource: winnerBySource,
      byCampaign: undefined,
    });
    expect(out.reallocation?.type).toBe("recommendation");
    expect(out.reallocation && "action" in out.reallocation && out.reallocation.action).toBe(
      "shift_budget_to_source",
    );
  });

  it("ABSTAINS (null) when coverage is below the floor even though a clear winner exists", async () => {
    // Same two attributed campaigns PLUS a large WEBSITE-only campaign (unmapped → lead-share).
    // Coverage = 200/500 = 0.4 < floor. The website spend inflates both sources proportionally,
    // so ctwa still wins clearly (gates 1-2 pass) — the COVERAGE gate is what abstains.
    const out = await computeAuditEconomicsSections({
      ...sectionBase,
      currentInsights: [
        insight({ campaignId: "c_ctwa", spend: 100, inlineLinkClicks: 200, conversions: 20 }),
        insight({ campaignId: "c_if", spend: 100, inlineLinkClicks: 200, conversions: 20 }),
        insight({ campaignId: "c_web", spend: 300, inlineLinkClicks: 200, conversions: 20 }),
      ],
      adSetData: [
        adSet("c_ctwa", "as_ctwa", "WHATSAPP", 100),
        adSet("c_if", "as_if", "ON_AD", 100),
        adSet("c_web", "as_web", "WEBSITE", 300),
      ],
      bySource: winnerBySource,
      byCampaign: undefined,
    });
    expect(out.sourceComparison?.rows.length).toBe(2);
    expect(out.reallocation).toBeNull();
  });

  it("ABSTAINS when account-wide coverage passes but a candidate source is entirely synthetic", async () => {
    // c_ctwa ($80) fully attributed to ctwa; c_web ($20, WEBSITE) is lead-shared across sources.
    // Account-wide coverage is 0.8 (would pass a global gate), but instant_form's spend is 100%
    // lead-share (no ON_AD campaign) → its trueROAS denominator is synthetic. The PER-SOURCE
    // gate must abstain even though ctwa is well-attributed and a clear winner exists.
    const out = await computeAuditEconomicsSections({
      ...sectionBase,
      currentInsights: [
        insight({ campaignId: "c_ctwa", spend: 80, inlineLinkClicks: 200, conversions: 20 }),
        insight({ campaignId: "c_web", spend: 20, inlineLinkClicks: 200, conversions: 20 }),
      ],
      adSetData: [
        adSet("c_ctwa", "as_ctwa", "WHATSAPP", 80),
        adSet("c_web", "as_web", "WEBSITE", 20),
      ],
      bySource: {
        ctwa: funnel({ received: 40, booked: 10, paid: 12, revenue: 40000 }),
        instant_form: funnel({ received: 30, booked: 6, paid: 3, revenue: 1000 }),
      },
      byCampaign: undefined,
    });
    expect(out.reallocation).toBeNull();
  });
});
