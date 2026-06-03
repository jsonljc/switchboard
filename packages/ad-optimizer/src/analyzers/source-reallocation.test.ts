import { describe, it, expect } from "vitest";
import {
  decideSourceReallocation,
  computeAuditEconomicsSections,
  MIN_SOURCE_BOOKINGS,
} from "./source-reallocation.js";
import type { SourceComparisonRow } from "./source-comparator.js";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

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
const base = {
  bySource: { ctwa: funnel({}), instant_form: funnel({}) } as Record<string, SourceFunnel>,
  accountEvidence: goodEvidence,
  measurementTrusted: true,
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
      measurementTrusted: false,
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
    measurementTrusted: true,
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

  it("computes sourceComparison and a shift rec from a clear-winner per-source funnel", async () => {
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
    expect(out.reallocation?.type).toBe("recommendation");
    expect(out.reallocation && "action" in out.reallocation && out.reallocation.action).toBe(
      "shift_budget_to_source",
    );
  });
});
