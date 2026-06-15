import { describe, it, expect, vi } from "vitest";
import { PrismaRecommendationStore } from "@switchboard/db";
import {
  confidenceModifierForKind,
  generateRecommendations,
  type RecommendationInput,
} from "@switchboard/ad-optimizer";
import type {
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
} from "@switchboard/schemas";

// Producer-with-consumer seam (overview §6): operator verdicts shaped EXACTLY as
// RecommendationStore.applyAct persists them (status acted/dismissed +
// parameters.__recommendation.action) -> the REAL aggregateApprovalRateByKind reader ->
// the REAL confidenceModifierForKind -> the REAL engine. This pins that the learning
// signal flows end-to-end with no shape mismatch (db Layer 4 -> ad-optimizer Layer 2,
// joinable only here at Layer 5), and that it stays bounded + abstaining when driven from
// the real producer's output rather than a hand-built modifier.

// The store ctor's PrismaClient param, without a direct @prisma/client import (not an
// apps/api dependency); the mock only needs pendingActionRecord.findMany.
type StoreCtorArg = ConstructorParameters<typeof PrismaRecommendationStore>[0];

function verdictRows(action: string, acted: number, dismissed: number) {
  const row = (status: string) => ({ status, parameters: { __recommendation: { action } } });
  return [
    ...Array.from({ length: acted }, () => row("acted")),
    ...Array.from({ length: dismissed }, () => row("dismissed")),
  ];
}

/** A durable daily breach at 3.5x target → the engine emits add_creative (0.8) AND
 * pause (0.9), so one historied kind and one unhistoried kind are observable at once. */
function durableBreachInput(
  confidenceModifierByKind?: RecommendationInput["confidenceModifierByKind"],
): RecommendationInput {
  return {
    campaignId: "c1",
    campaignName: "C1",
    diagnoses: [],
    deltas: [
      {
        metric: "cpa",
        current: 350,
        previous: 100,
        deltaPercent: 0,
        direction: "up",
        significant: true,
      },
    ],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 5000,
    targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
    evidence: { clicks: 1000, conversions: 100, days: 7 },
    ...(confidenceModifierByKind ? { confidenceModifierByKind } : {}),
  };
}

function confidenceOf(result: (RecommendationOutput | WatchOutput)[], action: string): number {
  const rec = result.find(
    (r): r is RecommendationOutput => r.type === "recommendation" && r.action === action,
  );
  if (!rec) throw new Error(`expected a ${action} rec`);
  return rec.confidence;
}

async function modifierFromStore(rows: ReturnType<typeof verdictRows>) {
  const findMany = vi.fn().mockResolvedValueOnce(rows);
  const prisma = { pendingActionRecord: { findMany } } as unknown as StoreCtorArg;
  const store = new PrismaRecommendationStore(prisma);
  const agg = await store.aggregateApprovalRateByKind("org-1");
  return (action: string): number =>
    confidenceModifierForKind(agg.get(action) ?? { approved: 0, rejected: 0 });
}

describe("Riley confidence-modifier seam (D7-2): real store reader -> real engine", () => {
  it("nudges a kind UP from real approval history, bounded, leaving an unhistoried kind untouched", async () => {
    const modifier = await modifierFromStore(verdictRows("add_creative", 14, 6)); // 70% over 20 -> 1.12
    const out = generateRecommendations(durableBreachInput(modifier));
    expect(confidenceOf(out, "add_creative")).toBeCloseTo(0.896, 5); // 0.8 * 1.12
    expect(confidenceOf(out, "pause")).toBe(0.9); // no history -> abstain
  });

  it("nudges a kind DOWN from a low-approval history, bounded by the floor", async () => {
    const modifier = await modifierFromStore(verdictRows("pause", 4, 16)); // 20% over 20 -> floor 0.85
    const out = generateRecommendations(durableBreachInput(modifier));
    expect(confidenceOf(out, "pause")).toBeCloseTo(0.765, 5); // 0.9 * 0.85
    expect(confidenceOf(out, "add_creative")).toBe(0.8); // no history -> abstain
  });

  it("ABSTAINS on sparse real history (below the floor) — confidence is unmoved", async () => {
    const modifier = await modifierFromStore(verdictRows("pause", 3, 0)); // 3 verdicts < 8 floor
    const out = generateRecommendations(durableBreachInput(modifier));
    expect(confidenceOf(out, "pause")).toBe(0.9);
    expect(confidenceOf(out, "add_creative")).toBe(0.8);
  });
});
