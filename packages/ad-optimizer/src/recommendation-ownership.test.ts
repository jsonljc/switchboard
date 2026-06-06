import { describe, expect, it } from "vitest";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import {
  deriveOwnership,
  deriveOwnershipAnnotations,
  type DeriveOwnershipInput,
} from "./recommendation-ownership.js";
import { emittedRiskContractFor } from "./recommendation-risk-contract.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import { resetsLearningFor } from "./action-reset-classification.js";

const ALL_ACTIONS = AdRecommendationActionSchema.options;
const ALL_URGENCIES = UrgencySchema.options;

/** Clears BOTH creative floors (destructive is the higher bar: 50/5/7). */
const PASSING_CONTEXT: HandoffCampaignContext = {
  evidence: { clicks: 50, conversions: 5, days: 7 },
  learningPhaseActive: false,
};
/** Below the diagnostic floor (clicks 10), so it fails refresh_creative too. */
const THIN_CONTEXT: HandoffCampaignContext = {
  evidence: { clicks: 9, conversions: 0, days: 3 },
  learningPhaseActive: false,
};
const LOCKED_CONTEXT: HandoffCampaignContext = {
  evidence: { clicks: 50, conversions: 5, days: 7 },
  learningPhaseActive: true,
};
const CONTEXT_VARIANTS: ReadonlyArray<HandoffCampaignContext | undefined> = [
  undefined,
  PASSING_CONTEXT,
  THIN_CONTEXT,
  LOCKED_CONTEXT,
];

function rec(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  const action = overrides.action ?? "pause";
  return {
    type: "recommendation",
    action,
    campaignId: "c-1",
    campaignName: "C1",
    confidence: 0.9,
    urgency: "this_week",
    estimatedImpact: "x",
    steps: ["x"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
}

describe("deriveOwnership: per-class pins", () => {
  it("mira_handoff: a creative rec whose LIVE abstention gate clears", () => {
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: PASSING_CONTEXT,
      }),
    ).toBe("mira_handoff");
    expect(
      deriveOwnership({
        action: "add_creative",
        urgency: "this_week",
        handoffContext: PASSING_CONTEXT,
      }),
    ).toBe("mira_handoff");
    // The diagnostic floor (10/0/3) passes refresh_creative but the destructive
    // floor (50/5/7) fails add_creative: per-action floors via the live gate.
    const diagnosticOnly: HandoffCampaignContext = {
      evidence: { clicks: 10, conversions: 0, days: 3 },
      learningPhaseActive: false,
    };
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: diagnosticOnly,
      }),
    ).toBe("mira_handoff");
    expect(
      deriveOwnership({
        action: "add_creative",
        urgency: "this_week",
        handoffContext: diagnosticOnly,
      }),
    ).toBe("operator_approval");
  });

  it("a creative rec falls to the operator classes when evidence fails, learning is locked, or context is absent", () => {
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: THIN_CONTEXT,
      }),
    ).toBe("operator_approval");
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: LOCKED_CONTEXT,
      }),
    ).toBe("operator_approval");
    expect(deriveOwnership({ action: "refresh_creative", urgency: "this_week" })).toBe(
      "operator_approval",
    );
    expect(deriveOwnership({ action: "refresh_creative", urgency: "immediate" })).toBe(
      "human_escalation",
    );
  });

  it("operator_swipe: low-risk informational actions only (non-mutating + next_cycle)", () => {
    for (const action of [
      "hold",
      "test",
      "harden_capi_attribution",
      "fix_signal_health",
    ] as const) {
      expect(deriveOwnership({ action, urgency: "next_cycle" })).toBe("operator_swipe");
      expect(deriveOwnership({ action, urgency: "this_week" })).toBe("operator_approval");
      expect(deriveOwnership({ action, urgency: "immediate" })).toBe("human_escalation");
    }
  });

  it("mutating actions are never swipe-owned at any urgency", () => {
    for (const action of ALL_ACTIONS) {
      const c = emittedRiskContractFor(action, "next_cycle");
      if (!c.financialEffect && !c.externalEffect) continue; // informational quartet
      expect(deriveOwnership({ action, urgency: "next_cycle" })).toBe("operator_approval");
      expect(deriveOwnership({ action, urgency: "immediate" })).toBe("human_escalation");
    }
  });

  it("human_escalation: precedence pin against the handoff (live-behavior fidelity)", () => {
    // An immediate-urgency creative rec that clears the gates is Mira-owned: the
    // live dispatch hands off regardless of urgency (the abstention reads no
    // urgency) and the parked draft IS the governed approval ceremony.
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "immediate",
        handoffContext: PASSING_CONTEXT,
      }),
    ).toBe("mira_handoff");
  });
});

describe("deriveOwnership: domain sweeps (riley_self reservation + structural exclusivity)", () => {
  it("never emits riley_self and always emits a known class over the full input domain", () => {
    const EMITTABLE = ["operator_swipe", "operator_approval", "mira_handoff", "human_escalation"];
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        for (const handoffContext of CONTEXT_VARIANTS) {
          const input: DeriveOwnershipInput = { action, urgency, handoffContext };
          expect(EMITTABLE, `${action}/${urgency}`).toContain(deriveOwnership(input));
        }
      }
    }
  });

  it("handoff-and-swipe is structurally impossible (mira_handoff never masks a swipe-eligible rec)", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const ownership = deriveOwnership({ action, urgency, handoffContext: PASSING_CONTEXT });
        if (ownership === "mira_handoff") {
          const c = emittedRiskContractFor(action, urgency);
          const swipeEligible =
            c.riskLevel === "low" && !c.externalEffect && !c.financialEffect && !c.clientFacing;
          expect(swipeEligible, `${action}/${urgency}`).toBe(false);
        }
      }
    }
  });

  it("swipe-and-escalation is structurally impossible (low vs high risk)", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const ownership = deriveOwnership({ action, urgency });
        if (ownership === "operator_swipe") {
          expect(emittedRiskContractFor(action, urgency).riskLevel).toBe("low");
        }
        if (ownership === "human_escalation") {
          expect(emittedRiskContractFor(action, urgency).riskLevel).toBe("high");
        }
      }
    }
  });
});

describe("deriveOwnershipAnnotations: total, ordered, index-faithful", () => {
  it("annotates every recommendation in order, resolving context per campaign", () => {
    const recommendations = [
      rec({ action: "pause", campaignId: "c-1", urgency: "immediate" }),
      rec({ action: "refresh_creative", campaignId: "c-2", urgency: "this_week" }),
      rec({ action: "refresh_creative", campaignId: "c-3", urgency: "this_week" }),
      rec({ action: "shift_budget_to_source", campaignId: "account", urgency: "this_week" }),
      rec({ action: "fix_signal_health", campaignId: "signal:px-1", urgency: "this_week" }),
      rec({ action: "fix_signal_health", campaignId: "signal:px-1", urgency: "this_week" }),
    ];
    const contexts = new Map<string, HandoffCampaignContext>([
      ["c-2", PASSING_CONTEXT],
      ["c-3", THIN_CONTEXT],
    ]);
    const out = deriveOwnershipAnnotations({ recommendations, handoffContextByCampaign: contexts });
    expect(out).toHaveLength(6);
    expect(out.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out[0]).toEqual({
      campaignId: "c-1",
      action: "pause",
      index: 0,
      ownership: "human_escalation",
    });
    expect(out[1]?.ownership).toBe("mira_handoff");
    expect(out[2]?.ownership).toBe("operator_approval");
    expect(out[3]?.ownership).toBe("operator_approval");
    // Duplicate (campaignId, action) pairs stay distinguishable by index.
    expect(out[4]?.ownership).toBe("operator_approval");
    expect(out[5]?.ownership).toBe("operator_approval");
    expect(out[4]?.index).not.toBe(out[5]?.index);
  });

  it("returns [] for no candidates and never mutates its input", () => {
    expect(deriveOwnershipAnnotations({ recommendations: [] })).toEqual([]);
    const recommendations = [rec({ action: "hold", urgency: "next_cycle" })];
    const frozen = Object.freeze(recommendations);
    const out = deriveOwnershipAnnotations({ recommendations: frozen });
    expect(out[0]?.ownership).toBe("operator_swipe");
  });

  it("never emits riley_self without a PARK FACT, across a mixed candidate set (strict truth)", () => {
    // Gate eligibility alone is never enough: with pauseParkedIndex absent
    // (flag off, env off, denied, entitlement-skipped, abstained, park failed),
    // no candidate set under any context yields riley_self.
    const recommendations = ALL_ACTIONS.flatMap((action) =>
      ALL_URGENCIES.map((urgency) => rec({ action, urgency, campaignId: "c-all" })),
    );
    for (const context of CONTEXT_VARIANTS) {
      const out = deriveOwnershipAnnotations({
        recommendations,
        handoffContextByCampaign: context ? new Map([["c-all", context]]) : undefined,
      });
      expect(out).toHaveLength(recommendations.length);
      for (const entry of out) {
        expect(entry.ownership).not.toBe("riley_self");
      }
    }
  });
});

describe("deriveOwnershipAnnotations: strict-truth riley_self (the park fact)", () => {
  it("riley_self for exactly the recommendation whose pause submit parked", () => {
    const recommendations = [
      rec({ action: "pause", campaignId: "c-1", urgency: "immediate" }),
      rec({ action: "refresh_creative", campaignId: "c-2", urgency: "this_week" }),
    ];
    const out = deriveOwnershipAnnotations({
      recommendations,
      handoffContextByCampaign: new Map([
        ["c-1", PASSING_CONTEXT],
        ["c-2", PASSING_CONTEXT],
      ]),
      pauseParkedIndex: 0,
    });
    expect(out[0]).toEqual({
      campaignId: "c-1",
      action: "pause",
      index: 0,
      ownership: "riley_self",
    });
    // The other entries are untouched by the park fact.
    expect(out[1]?.ownership).toBe("mira_handoff");
  });

  it("the park fact only relabels its own index, even with duplicate pause candidates", () => {
    const recommendations = [
      rec({ action: "pause", campaignId: "c-1", urgency: "immediate" }),
      rec({ action: "pause", campaignId: "c-2", urgency: "immediate" }),
    ];
    const out = deriveOwnershipAnnotations({ recommendations, pauseParkedIndex: 1 });
    expect(out[0]?.ownership).toBe("human_escalation"); // pause default tier, no park
    expect(out[1]?.ownership).toBe("riley_self");
  });

  it("undefined parked index is byte-identical to the pre-widening output", () => {
    const recommendations = [
      rec({ action: "pause", campaignId: "c-1", urgency: "immediate" }),
      rec({ action: "refresh_creative", campaignId: "c-2", urgency: "this_week" }),
    ];
    const contexts = new Map([["c-2", PASSING_CONTEXT]]);
    expect(
      deriveOwnershipAnnotations({ recommendations, handoffContextByCampaign: contexts }),
    ).toEqual(
      deriveOwnershipAnnotations({
        recommendations,
        handoffContextByCampaign: contexts,
        pauseParkedIndex: undefined,
      }),
    );
  });
});
