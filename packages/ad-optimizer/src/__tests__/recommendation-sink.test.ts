import { describe, expect, it, vi } from "vitest";
import {
  runRecommendationSink,
  economicBasisLine,
  economicsCells,
  sourceReallocationCells,
} from "../recommendation-sink.js";
import type { EmitOutcome, RecommendationEmitter } from "../recommendation-sink.js";
import type { RecommendationOutput } from "../recommendation-engine.js";
import type { CampaignEconomicsRow } from "../analyzers/source-comparator.js";
import { resetsLearningFor } from "../action-reset-classification.js";
import { emittedRiskContractFor } from "../recommendation-risk-contract.js";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import type { RecommendationInput } from "@switchboard/schemas";

const baseRec = (overrides: Partial<RecommendationOutput> = {}): RecommendationOutput => {
  const action = overrides.action ?? "pause";
  return {
    type: "recommendation",
    campaignId: "c-1",
    campaignName: "Whitening Set B",
    action,
    confidence: 0.9,
    urgency: "immediate",
    estimatedImpact: "saves $40/day",
    steps: ["Pause"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
};

/**
 * Mirror the v1 router's surface decision (router.ts in @switchboard/core).
 * Hardcoded here because the sink test should not pull a layer-violating import
 * on core; the router contract is small and stable.
 */
function mockRoute(input: RecommendationInput): EmitOutcome {
  const reversible = input.action === "pause" || input.action === "reduce_budget";
  if (reversible && input.confidence >= 0.85 && input.dollarsAtRisk < 50) {
    return { surface: "shadow_action" };
  }
  if (input.confidence >= 0.5) return { surface: "queue" };
  return { surface: "dropped" };
}

describe("runRecommendationSink", () => {
  it("emits one Recommendation per output via the emitter", async () => {
    const emit: RecommendationEmitter = vi.fn(async (input) => mockRoute(input));
    const recs = [baseRec(), baseRec({ campaignId: "c-2", action: "add_creative" })];
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: recs,
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(result.routedQueue + result.routedShadow + result.dropped).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
    const firstCallArg = (emit as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(firstCallArg.agentKey).toBe("riley");
  });

  it("returns dropped count when low-confidence inputs route to dropped", async () => {
    const emit: RecommendationEmitter = vi.fn(async (input) => mockRoute(input));
    const recs = [
      baseRec({ confidence: 0.3 }), // dropped (below queueMinConfidence 0.5)
      baseRec({ confidence: 0.9 }), // queue or shadow
    ];
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-2",
      recommendations: recs,
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(result.dropped).toBeGreaterThan(0);
    // The sink emits unconditionally — the router decides surface. Both recs
    // go through emit; only the second contributes to a non-dropped surface.
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("returns dropped: 0 when all inputs route to a real surface", async () => {
    const emit: RecommendationEmitter = vi.fn(async (input) => mockRoute(input));
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-3",
      recommendations: [baseRec({ confidence: 0.9 })],
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(result.dropped).toBe(0);
  });

  it("humanizeRecommendation covers all action kinds with no fallback", async () => {
    const summaries: string[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      summaries.push(input.humanSummary);
      return mockRoute(input);
    });
    // Cover all 13 actions from AdRecommendationActionSchema. No fallback
    // path should be exercised — every action gets a custom human summary.
    const actions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "refresh_creative",
      "restructure",
      "hold",
      "test",
      "review_budget",
      "add_creative",
      "expand_targeting",
      "consolidate",
      "shift_budget_to_source",
      "switch_optimization_event",
      "harden_capi_attribution",
    ];
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-4",
      recommendations: actions.map((a, i) =>
        baseRec({ action: a, campaignId: `c-${i}`, confidence: 0.6 }),
      ),
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(summaries).toHaveLength(actions.length);
    summaries.forEach((s) => {
      expect(s.length).toBeGreaterThan(5);
      // Sanity: must mention the campaign name (proves we humanized, not just
      // dumped the raw action label).
      expect(s).toContain("Whitening Set B");
    });
  });

  it("budget/structure actions emit financialEffect:true and externalEffect:true", async () => {
    // Safety invariant (spec §8.4 / §6): every action that writes to the ad
    // platform or changes live spend state must have financialEffect:true AND
    // externalEffect:true so that canSwipeApprove() returns false. An accidental
    // swipe must be impossible for money-moving actions.
    const financialActions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "restructure",
      "review_budget",
      "shift_budget_to_source",
      "consolidate",
      "expand_targeting",
      "switch_optimization_event",
    ];
    for (const action of financialActions) {
      const capturedInputs: RecommendationInput[] = [];
      const emit: RecommendationEmitter = vi.fn(async (input) => {
        capturedInputs.push(input);
        return { surface: "queue" as const };
      });
      await runRecommendationSink({
        orgId: "org-risk",
        auditRunId: "audit-risk",
        recommendations: [baseRec({ action })],
        emit,
        emissionContext: { cronId: "cron-risk", deploymentId: "dep-risk" },
      });
      const emitted = capturedInputs[0]!;
      expect(emitted.financialEffect, `${action}: financialEffect must be true`).toBe(true);
      expect(emitted.externalEffect, `${action}: externalEffect must be true`).toBe(true);
    }
  });

  it("informational actions emit financialEffect:false and externalEffect:false", async () => {
    // These actions queue internal work or open external links without mutating
    // live campaign state AND do not reset Meta's learning phase — they are
    // legitimately swipe-approvable. (refresh_creative / add_creative are NOT in
    // this set: they reset learning, so the sink invariant forces externalEffect:true
    // even though no dollars move — see the "resetsLearning:'yes'" describe block.)
    const informationalActions: RecommendationOutput["action"][] = [
      "hold",
      "test",
      "harden_capi_attribution",
      "fix_signal_health",
    ];
    for (const action of informationalActions) {
      const capturedInputs: RecommendationInput[] = [];
      const emit: RecommendationEmitter = vi.fn(async (input) => {
        capturedInputs.push(input);
        return { surface: "queue" as const };
      });
      await runRecommendationSink({
        orgId: "org-risk",
        auditRunId: "audit-risk",
        recommendations: [baseRec({ action })],
        emit,
        emissionContext: { cronId: "cron-risk", deploymentId: "dep-risk" },
      });
      const emitted = capturedInputs[0]!;
      expect(emitted.financialEffect, `${action}: financialEffect must be false`).toBe(false);
      expect(emitted.externalEffect, `${action}: externalEffect must be false`).toBe(false);
    }
  });

  it("buildPresentation emits action-specific acceptToast and declineToast for every action", async () => {
    const presentations: Array<{
      action: RecommendationOutput["action"];
      acceptToast: string | undefined;
      declineToast: string | undefined;
    }> = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      presentations.push({
        action: input.action as RecommendationOutput["action"],
        acceptToast: input.presentation.acceptToast,
        declineToast: input.presentation.declineToast,
      });
      return mockRoute(input);
    });
    const actions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "refresh_creative",
      "restructure",
      "hold",
      "test",
      "review_budget",
      "add_creative",
      "expand_targeting",
      "consolidate",
      "shift_budget_to_source",
      "switch_optimization_event",
      "harden_capi_attribution",
      "fix_signal_health",
    ];
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-toasts",
      recommendations: actions.map((a, i) =>
        baseRec({ action: a, campaignId: `c-${i}`, confidence: 0.9 }),
      ),
      emit,
      emissionContext: { cronId: "test-cron", deploymentId: "test-deployment" },
    });
    expect(presentations).toHaveLength(actions.length);

    // All actions must have non-empty toasts.
    for (const p of presentations) {
      expect(p.acceptToast, `${p.action} acceptToast must be non-empty`).toBeTruthy();
      expect(p.declineToast, `${p.action} declineToast must be non-empty`).toBeTruthy();
    }

    // Actions that interpolate the campaign name must contain it.
    // harden_capi_attribution and fix_signal_health reference "the pixel" /
    // "CAPI attribution" and do NOT interpolate campaign name — exclude them.
    const campaignNameActions: RecommendationOutput["action"][] = [
      "scale",
      "pause",
      "refresh_creative",
      "restructure",
      "hold",
      "test",
      "review_budget",
      "add_creative",
      "expand_targeting",
      "consolidate",
      "shift_budget_to_source",
      "switch_optimization_event",
    ];
    for (const p of presentations.filter((p) => campaignNameActions.includes(p.action))) {
      expect(p.acceptToast ?? "", `${p.action} acceptToast must contain campaign name`).toContain(
        "Whitening Set B",
      );
    }

    // Spot-check specific toast copy.
    const pause = presentations.find((p) => p.action === "pause")!;
    expect(pause.acceptToast).toBe("Paused Whitening Set B. Standing by.");
    expect(pause.declineToast).toBe("Leaving Whitening Set B running.");

    const scale = presentations.find((p) => p.action === "scale")!;
    expect(scale.acceptToast).toBe("Scaling Whitening Set B 20%.");
    expect(scale.declineToast).toBe("Holding Whitening Set B where it is.");

    const fix = presentations.find((p) => p.action === "fix_signal_health")!;
    expect(fix.acceptToast).toBe("Opening Events Manager for the pixel.");
    expect(fix.declineToast).toBe("Acknowledged — back to scanning the pixel.");
  });
});

describe("runRecommendationSink — spend amount is NOT scraped into the gate", () => {
  const run = async (rec: RecommendationOutput) => {
    const emit: RecommendationEmitter = vi.fn(async () => ({ surface: "queue" }) as EmitOutcome);
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "run-1",
      recommendations: [rec],
      emit,
      emissionContext: { cronId: "c1" },
    });
    const input = (emit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RecommendationInput;
    return input.parameters as Record<string, unknown>;
  };

  it("does NOT inject spendAmount from the scraped impact string (it is an impact projection, not a spend delta)", async () => {
    // "saves $40/day" is a projected SAVING, not the budget delta the governance
    // spend threshold compares against — so it must not flow to the gate as spendAmount.
    const params = await run(baseRec({ action: "pause", estimatedImpact: "saves $40/day" }));
    expect(params["spendAmount"]).toBeUndefined();
  });
});

describe("sink invariant: resetsLearning:'yes' is never swipe-approvable", () => {
  it.each(AdRecommendationActionSchema.options.filter((a) => resetsLearningFor(a) === "yes"))(
    "%s emits with financial/external effect set (blocks swipe)",
    async (action) => {
      const emit = vi.fn().mockResolvedValue({ surface: "queue" });
      await runRecommendationSink({
        orgId: "o1",
        auditRunId: "a1",
        recommendations: [baseRec({ action })],
        emit,
        emissionContext: { cronId: "test" },
      });
      const payload = emit.mock.calls[0]![0] as {
        financialEffect: boolean;
        externalEffect: boolean;
      };
      expect(payload.externalEffect || payload.financialEffect).toBe(true);
    },
  );
});

describe("economicBasisLine", () => {
  it("names this campaign's own target for targetSource=campaign (Tier-1)", () => {
    expect(economicBasisLine({ economicTier: "booked_cac", targetSource: "campaign" })).toBe(
      "Target: this campaign's own booked-CAC.",
    );
  });
  it("names the account-level fallback for targetSource=account (Tier-2)", () => {
    expect(economicBasisLine({ economicTier: "booked_cac", targetSource: "account" })).toBe(
      "Target: account-level fallback (booked-CAC).",
    );
  });
  it("adapts the tier phrase on the account fallback (which can carry cpl/cpc)", () => {
    expect(economicBasisLine({ economicTier: "cpl", targetSource: "account" })).toBe(
      "Target: account-level fallback (cost-per-lead).",
    );
    expect(economicBasisLine({ economicTier: "cpc", targetSource: "account" })).toBe(
      "Target: account-level fallback (cost-per-click).",
    );
  });
  it("returns null (honest-null/back-compat) when targetSource is absent", () => {
    expect(economicBasisLine({ economicTier: "booked_cac" })).toBeNull();
    expect(economicBasisLine({})).toBeNull();
  });
});

describe("economicsCells", () => {
  const row = (o: Partial<CampaignEconomicsRow> = {}): CampaignEconomicsRow => ({
    campaignId: "c-1",
    cpl: 12,
    costPerBooked: 48.5,
    bookedValueCents: 30000,
    trueRoas: 2.3,
    ...o,
  });
  it("formats CPL (dollars), cost-per-booked (dollars), true ROAS (major) without re-division", () => {
    expect(economicsCells(row())).toEqual(["CPL $12", "$48.50/booked", "2.3x true ROAS"]);
  });
  it("renders null trueRoas as 'not yet attributed' (never a fabricated $0)", () => {
    expect(economicsCells(row({ trueRoas: null, bookedValueCents: null }))).toEqual([
      "CPL $12",
      "$48.50/booked",
      "true ROAS not yet attributed",
    ]);
  });
  it("omits null cpl / costPerBooked cells", () => {
    expect(economicsCells(row({ cpl: null, costPerBooked: null }))).toEqual(["2.3x true ROAS"]);
  });
  it("returns [] when there is no row and when every metric is null", () => {
    expect(economicsCells(undefined)).toEqual([]);
    expect(
      economicsCells(
        row({ cpl: null, costPerBooked: null, bookedValueCents: null, trueRoas: null }),
      ),
    ).toEqual([]);
  });
});

describe("sourceReallocationCells", () => {
  it("renders the winner-first source economics from a shift rec's params", () => {
    expect(
      sourceReallocationCells({
        from: "instant_form",
        to: "ctwa",
        fromTrueRoas: "1.5",
        toTrueRoas: "3.8",
      }),
    ).toEqual(["ctwa 3.8x true ROAS", "instant_form 1.5x true ROAS"]);
  });

  it("honest-null: returns [] when params are absent or carry no source economics", () => {
    expect(sourceReallocationCells(undefined)).toEqual([]);
    expect(sourceReallocationCells({ from: "a", to: "b" })).toEqual([]);
    expect(
      sourceReallocationCells({ from: "a", to: "b", fromTrueRoas: "x", toTrueRoas: "y" }),
    ).toEqual([]);
  });
});

describe("runRecommendationSink — economic basis + per-campaign economics in dataLines", () => {
  it("attaches the matching campaign's basis + economics lines to the emitted presentation", async () => {
    const captured: RecommendationInput[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      captured.push(input);
      return { surface: "queue" as const };
    });
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-econ",
      recommendations: [
        baseRec({ campaignId: "c-1", economicTier: "booked_cac", targetSource: "campaign" }),
      ],
      emit,
      emissionContext: { cronId: "cron" },
      campaignEconomics: {
        rows: [
          {
            campaignId: "c-1",
            cpl: 12,
            costPerBooked: 48.5,
            bookedValueCents: 30000,
            trueRoas: 2.3,
          },
          { campaignId: "c-other", cpl: 1, costPerBooked: 2, bookedValueCents: 3, trueRoas: 4 },
        ],
      },
    });
    const lines = captured[0]!.presentation.dataLines as unknown as string[][];
    const flat = lines.map((l) => l.join(" · "));
    expect(flat).toContain("Target: this campaign's own booked-CAC.");
    expect(flat).toContain("CPL $12 · $48.50/booked · 2.3x true ROAS");
    // does not leak another campaign's economics
    expect(flat.some((l) => l.includes("$2/booked"))).toBe(false);
  });

  it("omits both lines when targetSource/economics are absent (back-compat unchanged)", async () => {
    const captured: RecommendationInput[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      captured.push(input);
      return { surface: "queue" as const };
    });
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-plain",
      recommendations: [baseRec({ campaignId: "c-1", estimatedImpact: "saves $40/day" })],
      emit,
      emissionContext: { cronId: "cron" },
    });
    const lines = captured[0]!.presentation.dataLines as unknown as string[][];
    expect(lines).toEqual([["saves $40/day"], ["Learning phase: no impact"]]);
  });

  it("renders the source economics on a shift_budget_to_source rec's dataLines", async () => {
    const captured: RecommendationInput[] = [];
    const emit: RecommendationEmitter = vi.fn(async (input) => {
      captured.push(input);
      return { surface: "queue" as const };
    });
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-shift",
      recommendations: [
        baseRec({
          campaignId: "account",
          campaignName: "instant_form to ctwa",
          action: "shift_budget_to_source",
          estimatedImpact:
            "ctwa trueRoas is 2.5x instant_form. Consider shifting budget toward ctwa.",
          params: { from: "instant_form", to: "ctwa", fromTrueRoas: "1.5", toTrueRoas: "3.8" },
        }),
      ],
      emit,
      emissionContext: { cronId: "cron" },
    });
    const flat = (captured[0]!.presentation.dataLines as unknown as string[][]).map((l) =>
      l.join(" · "),
    );
    expect(flat).toContain("ctwa 3.8x true ROAS · instant_form 1.5x true ROAS");
  });
});

describe("runRecommendationSink — Riley -> agent handoff dispatch", () => {
  const refreshRec = () =>
    baseRec({ action: "refresh_creative", campaignId: "c-1", campaignName: "Spring Promo" });
  const ctx = () =>
    new Map([
      ["c-1", { evidence: { clicks: 50, conversions: 3, days: 7 }, learningPhaseActive: false }],
    ]);
  const emitOk = (
    id: string | null,
    surface: "queue" | "dropped" = "queue",
  ): RecommendationEmitter => vi.fn(async () => ({ surface, id }) as EmitOutcome);

  it("submits a handoff for an emitted, evidence-met creative recommendation", async () => {
    const recommendationHandoffSubmitter = vi.fn(async (_c: unknown) => {});
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [refreshRec()],
      emit: emitOk("rec_db_1"),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      handoffContextByCampaign: ctx(),
      recommendationHandoffSubmitter,
    });
    expect(recommendationHandoffSubmitter).toHaveBeenCalledTimes(1);
    expect(recommendationHandoffSubmitter.mock.calls[0]![0]).toEqual({
      organizationId: "org-1",
      deploymentId: "dep_riley",
      recommendationId: "rec_db_1",
      actionType: "refresh_creative",
      campaignId: "c-1",
      rationale: "Refresh creative on Spring Promo — saves $40/day",
      evidence: { clicks: 50, conversions: 3, days: 7 },
      learningPhaseActive: false,
    });
  });

  it("does NOT hand off a dropped recommendation (no id)", async () => {
    const recommendationHandoffSubmitter = vi.fn(async (_c: unknown) => {});
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [refreshRec()],
      emit: emitOk(null, "dropped"),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      handoffContextByCampaign: ctx(),
      recommendationHandoffSubmitter,
    });
    expect(recommendationHandoffSubmitter).not.toHaveBeenCalled();
  });

  it("does NOT hand off a non-creative (unroutable) recommendation", async () => {
    const recommendationHandoffSubmitter = vi.fn(async (_c: unknown) => {});
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [baseRec({ action: "pause", campaignId: "c-1" })],
      emit: emitOk("rec_db_2"),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      handoffContextByCampaign: ctx(),
      recommendationHandoffSubmitter,
    });
    expect(recommendationHandoffSubmitter).not.toHaveBeenCalled();
  });

  it("does NOT hand off when the emitter returns no id (back-compat emitters)", async () => {
    const recommendationHandoffSubmitter = vi.fn(async (_c: unknown) => {});
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [refreshRec()],
      emit: vi.fn(async () => ({ surface: "queue" }) as EmitOutcome),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      handoffContextByCampaign: ctx(),
      recommendationHandoffSubmitter,
    });
    expect(recommendationHandoffSubmitter).not.toHaveBeenCalled();
  });

  it("does NOT hand off when no deployment id is in scope (analysis-only caller)", async () => {
    const recommendationHandoffSubmitter = vi.fn(async (_c: unknown) => {});
    await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [refreshRec()],
      emit: emitOk("rec_db_3"),
      emissionContext: { cronId: "test-cron" },
      handoffContextByCampaign: ctx(),
      recommendationHandoffSubmitter,
    });
    expect(recommendationHandoffSubmitter).not.toHaveBeenCalled();
  });

  it("a handoff submitter that throws never breaks emission/routing", async () => {
    const recommendationHandoffSubmitter = vi.fn(async (_c: unknown) => {
      throw new Error("ingress down");
    });
    const result = await runRecommendationSink({
      orgId: "org-1",
      auditRunId: "audit-1",
      recommendations: [refreshRec()],
      emit: emitOk("rec_db_4"),
      emissionContext: { cronId: "test-cron", deploymentId: "dep_riley" },
      handoffContextByCampaign: ctx(),
      recommendationHandoffSubmitter,
    });
    expect(result.routedQueue).toBe(1);
    expect(recommendationHandoffSubmitter).toHaveBeenCalledTimes(1);
  });
});

describe("sink emission parity with emittedRiskContractFor (Riley v3 ownership)", () => {
  it("the sink's emitted risk-contract fields match the pure producer for every action x urgency", async () => {
    for (const action of AdRecommendationActionSchema.options) {
      for (const urgency of UrgencySchema.options) {
        const captured: RecommendationInput[] = [];
        const emit: RecommendationEmitter = async (input) => {
          captured.push(input);
          return { surface: "queue" };
        };
        await runRecommendationSink({
          orgId: "org-1",
          auditRunId: "audit-1",
          recommendations: [baseRec({ action, urgency })],
          emit,
          emissionContext: { cronId: "cron-1" },
        });
        const emitted = captured[0]!;
        expect(
          {
            riskLevel: emitted.riskLevel,
            financialEffect: emitted.financialEffect,
            externalEffect: emitted.externalEffect,
            clientFacing: emitted.clientFacing,
            requiresConfirmation: emitted.requiresConfirmation,
          },
          `${action}/${urgency}`,
        ).toEqual(emittedRiskContractFor(action, urgency));
      }
    }
  });
});
