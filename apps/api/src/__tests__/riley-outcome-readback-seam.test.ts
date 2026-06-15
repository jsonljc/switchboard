import { describe, it, expect, vi } from "vitest";
import type { RileyOutcomeRow } from "@switchboard/core";
import { PrismaRecommendationOutcomeStore } from "@switchboard/db";
import {
  outcomeAdjustmentForKind,
  decideForCampaign,
  assembleRevenueState,
  LearningPhaseGuard,
} from "@switchboard/ad-optimizer";
import type { CampaignInsightSchema as CampaignInsight } from "@switchboard/schemas";

// Producer-with-consumer seam (overview §7): a REAL RileyOutcomeRow (the attribution engine's
// output shape, fully typed so any drift in the fields the aggregate reads breaks this test) ->
// the REAL PrismaRecommendationOutcomeStore.aggregateOutcomeSignalByKind -> the REAL
// outcomeAdjustmentForKind -> the REAL decideForCampaign. Pins that last cycle's outcome ledger
// reaches this cycle's confidence with no shape mismatch (db Layer 4 -> core types -> ad-optimizer
// Layer 2, joinable only at Layer 5), bounded and abstaining.

type StoreCtorArg = ConstructorParameters<typeof PrismaRecommendationOutcomeStore>[0];

/** A real RileyOutcomeRow as the attribution engine emits it. Only actionKind/trustDelta/
 * causalStrength matter to the readback; the rest mirrors a realistic row so the typed shape
 * is the seam pin. */
function outcomeRow(over: Partial<RileyOutcomeRow>): RileyOutcomeRow {
  return {
    recommendationId: "rec_x",
    executableWorkUnitId: null,
    organizationId: "org-1",
    agentRole: "riley",
    actionKind: "pause",
    anchorAt: new Date("2026-05-01"),
    windowStartedAt: new Date("2026-05-01"),
    windowEndedAt: new Date("2026-05-08"),
    attributionMethod: "directional",
    confidence: "low",
    cockpitRenderable: true,
    metricSummary: {
      preWindowDays: 7,
      postWindowDays: 7,
      preWindow: null,
      postWindow: null,
      deltas: { deltaPct: null, deltaAmountCents: null },
    },
    copyTemplate: null,
    copyValues: null,
    visibilityFlags: [],
    causalStrength: "corroborated",
    businessContextStable: "unknown",
    trustDelta: "up",
    ...over,
  };
}

function storeForRows(rows: RileyOutcomeRow[]): PrismaRecommendationOutcomeStore {
  // The aggregate's WHERE filters to causalStrength:"corroborated", so simulate the DB here: the
  // mock returns only the corroborated rows (selected columns are actionKind + trustDelta). A
  // directional-only history therefore arrives as zero rows -> the readback abstains.
  const findMany = vi
    .fn()
    .mockResolvedValueOnce(
      rows
        .filter((r) => r.causalStrength === "corroborated")
        .map((r) => ({ actionKind: r.actionKind, trustDelta: r.trustDelta })),
    );
  const prisma = { recommendationOutcome: { findMany } } as unknown as StoreCtorArg;
  return new PrismaRecommendationOutcomeStore(prisma);
}

const guard = new LearningPhaseGuard();
const successStatus = guard.check("c1", {
  effectiveStatus: "ACTIVE",
  learningPhase: false,
  lastModifiedDays: 30,
  optimizationEvents: 100,
});

function insight(over: Partial<CampaignInsight>): CampaignInsight {
  return {
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 10000,
    inlineLinkClicks: 200,
    spend: 100,
    conversions: 10,
    revenue: 500,
    frequency: 1.5,
    cpm: 10,
    inlineLinkClickCtr: 2,
    costPerInlineLinkClick: 0.5,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...over,
  };
}

async function pauseConfidenceFromOutcomes(rows: RileyOutcomeRow[]): Promise<number> {
  const agg = await storeForRows(rows).aggregateOutcomeSignalByKind("org-1");
  const outcomeMultiplierByKind = (action: string): number =>
    outcomeAdjustmentForKind(agg.get(action) ?? { corroboratedUp: 0, corroboratedDown: 0 })
      .confidenceMultiplier;
  const r = decideForCampaign({
    campaignId: "c1",
    campaignName: "C1",
    currentInsight: insight({ spend: 2800, conversions: 8 }), // cpa 350 = 3.5x -> pause @ 0.9
    previousInsight: insight({ spend: 2800, conversions: 8 }),
    targetBreach: { periodsAboveTarget: 8, granularity: "daily", isApproximate: false },
    learningStatus: successStatus,
    economicTier: "booked_cac",
    effectiveTarget: 100,
    revenueState: assembleRevenueState({ measurementTrusted: true, marginBasis: "unavailable" }),
    targetROAS: 3,
    nextCycleDate: "2026-05-14",
    outcomeMultiplierByKind,
  });
  const pause = r.recommendations.find((x) => x.action === "pause");
  if (!pause) throw new Error("expected a pause rec");
  return pause.confidence;
}

describe("Riley outcome-readback seam (D7-1/D9-5): real outcome row -> store -> readback -> decision", () => {
  it("nudges pause confidence UP from a corroborated, favorable outcome history", async () => {
    const rows = [
      outcomeRow({ trustDelta: "up", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "up", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "up", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "up", causalStrength: "corroborated" }),
    ];
    expect(await pauseConfidenceFromOutcomes(rows)).toBeCloseTo(0.99, 5); // 0.9 * 1.1 (rate 1.0)
  });

  it("nudges pause confidence DOWN from a corroborated, unfavorable history, bounded", async () => {
    const rows = [
      outcomeRow({ trustDelta: "down", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "down", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "down", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "down", causalStrength: "corroborated" }),
    ];
    expect(await pauseConfidenceFromOutcomes(rows)).toBeCloseTo(0.81, 5); // 0.9 * 0.9 (rate 0)
  });

  it("ABSTAINS (base 0.9) on a directional-only history (no corroborated rows)", async () => {
    const rows = [
      outcomeRow({ trustDelta: "up", causalStrength: "directional" }),
      outcomeRow({ trustDelta: "up", causalStrength: "directional" }),
      outcomeRow({ trustDelta: "up", causalStrength: "directional" }),
      outcomeRow({ trustDelta: "up", causalStrength: "directional" }),
    ];
    expect(await pauseConfidenceFromOutcomes(rows)).toBe(0.9);
  });

  it("ABSTAINS (base 0.9) below the corroboration floor (only 2 corroborated)", async () => {
    const rows = [
      outcomeRow({ trustDelta: "up", causalStrength: "corroborated" }),
      outcomeRow({ trustDelta: "up", causalStrength: "corroborated" }),
    ];
    expect(await pauseConfidenceFromOutcomes(rows)).toBe(0.9);
  });
});
