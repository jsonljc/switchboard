import { describe, it, expect, vi } from "vitest";
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  RecommendationSurface,
} from "@switchboard/schemas";
import {
  buildShadowReallocationReport,
  type ShadowReallocationInput,
  type ShadowJudge,
} from "./shadow-reallocation.js";

function makeInput(
  o: {
    actionType?: AdRecommendationAction;
    surface?: RecommendationSurface;
    currentCents?: number | null;
    proposedCents?: number | null;
    accountSpendCents?: number;
    noContext?: boolean;
    campaignId?: string;
  } = {},
): ShadowReallocationInput {
  return {
    planner: {
      emitted: {
        recommendationId: `rec_${o.campaignId ?? "1"}`,
        actionType: o.actionType ?? "scale",
        campaignId: o.campaignId ?? "camp_1",
        rationale: "scale the daily budget ~20%",
        surface: o.surface ?? "queue",
      },
      currentDailyBudgetCents: o.currentCents === undefined ? 1000 : o.currentCents,
      proposedDailyBudgetCents: o.proposedCents === undefined ? 1200 : o.proposedCents,
      context: o.noContext
        ? undefined
        : { evidence: { clicks: 100, conversions: 10, days: 7 }, learningPhaseActive: false },
      organizationId: "org_1",
      deploymentId: "dep_1",
      adAccountId: "act_1",
    },
    accountDailySpendCents: o.accountSpendCents ?? 10_000,
  };
}

describe("buildShadowReallocationReport", () => {
  it("predicts a within-radius scale candidate deterministically (no judge)", async () => {
    const report = await buildShadowReallocationReport([makeInput()]);
    expect(report.entries).toHaveLength(1);
    const entry = report.entries[0]!;
    expect(entry.abstained).toBe(false);
    expect(entry.predicted).not.toBeNull();
    expect(entry.predicted!.proposedDailyBudgetCents).toBe(1200);
    expect(entry.deltaCentsSigned).toBe(200);
    expect(entry.blastRadius).toEqual({ ok: true });
    expect(entry.judge).toBeNull();
    expect(report.summary).toEqual({
      total: 1,
      predicted: 1,
      abstained: 0,
      blastRadiusRejected: 0,
    });
  });

  it("abstains (no money, no judge) on a non-scale recommendation", async () => {
    const judge = vi.fn(async (_args: Parameters<ShadowJudge>[0]) => ({
      sound: true,
      rationale: "unused",
    }));
    const report = await buildShadowReallocationReport([makeInput({ actionType: "pause" })], {
      judge,
    });
    const entry = report.entries[0]!;
    expect(entry.abstained).toBe(true);
    expect(entry.predicted).toBeNull();
    expect(entry.blastRadius).toBeNull();
    expect(entry.judge).toBeNull();
    expect(judge).not.toHaveBeenCalled();
    expect(report.summary.abstained).toBe(1);
  });

  it("abstains on a dropped surface and on a zero-magnitude move", async () => {
    const report = await buildShadowReallocationReport([
      makeInput({ surface: "dropped" }),
      makeInput({ currentCents: 1000, proposedCents: 1000 }),
      makeInput({ noContext: true }),
    ]);
    expect(report.summary).toEqual({
      total: 3,
      predicted: 0,
      abstained: 3,
      blastRadiusRejected: 0,
    });
  });

  it("flags a delta-cap breach (predicted, but the executor would refuse it)", async () => {
    // delta 10000c > DEFAULT maxDeltaCents 5000c
    const report = await buildShadowReallocationReport([
      makeInput({ currentCents: 10_000, proposedCents: 20_000 }),
    ]);
    const entry = report.entries[0]!;
    expect(entry.predicted).not.toBeNull();
    expect(entry.abstained).toBe(false);
    expect(entry.blastRadius).toEqual({ ok: false, reason: "DELTA_CAP" });
    expect(report.summary.blastRadiusRejected).toBe(1);
  });

  it("flags a share-cap breach for a small account (relative move too large)", async () => {
    // delta 100c within the dollar cap, but 100/100 = 100% > 0.25 share cap
    const report = await buildShadowReallocationReport([
      makeInput({ currentCents: 100, proposedCents: 200, accountSpendCents: 100 }),
    ]);
    expect(report.entries[0]!.blastRadius).toEqual({ ok: false, reason: "SHARE_CAP" });
  });

  it("attaches an injected judge verdict per predicted candidate", async () => {
    const verdict = { sound: true, rationale: "20% scale is proportionate to the evidence" };
    const judge = vi.fn(async (_args: Parameters<ShadowJudge>[0]) => verdict);
    const report = await buildShadowReallocationReport([makeInput()], { judge });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0]![0].candidate.campaignId).toBe("camp_1");
    expect(report.entries[0]!.judge).toEqual(verdict);
  });

  it("tallies a mixed batch", async () => {
    const report = await buildShadowReallocationReport([
      makeInput(), // predicted, within radius
      makeInput({ actionType: "hold" }), // abstained
      makeInput({ currentCents: 10_000, proposedCents: 20_000 }), // predicted, delta-cap rejected
    ]);
    expect(report.summary).toEqual({
      total: 3,
      predicted: 2,
      abstained: 1,
      blastRadiusRejected: 1,
    });
  });
});
