import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";

/** Evidence families (moved here from evidence-floor.ts so the one-way import
 * graph stays acyclic: action-contract <- evidence-floor / reset-classification /
 * sink / arbitrator). evidence-floor re-exports it for back-compat. */
export type EvidenceFamily =
  | "destructive" // pause / cut -- highest floor
  | "scale" // moderate-high
  | "structural" // restructure/consolidate/expand -- destructive-grade floor (Phase D)
  | "diagnostic" // hold / diagnose-only -- low floor
  | "measurement"; // signal/CAPI fixes -- account-level, bypass campaign-volume floor

/**
 * Riley v3 slice 2 (spec 2.3): ONE keyed per-action contract consolidating the three
 * formerly-parallel maps -- the sink's ACTION_RISK_CONTRACT booleans, the
 * ACTION_RESETS_LEARNING classification, and the evidence-floor FAMILY map. The legacy
 * modules re-point here (single source of truth); their public APIs are unchanged.
 *
 * financialEffect / externalEffect: static risk booleans. True for every action that
 * writes to the external ad platform or changes live campaign spend state; these must
 * NOT be swipe-approvable (spec section 8.4: accidentally approving a budget move must
 * be impossible via swipe). Purely informational actions that queue internal work or
 * open external links without mutating live campaign state stay false.
 * resetsLearning: Meta learning-phase reset class (Phase-A spec section 5).
 * evidenceFamily: minimum-evidence family (evidence-floor.ts owns the floors).
 */
export interface ActionContract {
  financialEffect: boolean;
  externalEffect: boolean;
  resetsLearning: ResetsLearning;
  evidenceFamily: EvidenceFamily;
}

export const ACTION_CONTRACT: Record<AdRecommendationAction, ActionContract> = {
  // -- Money- or ad-platform-state-changing: NOT swipe-approvable --
  scale: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "no", // capped at 20%, under Meta's significant-edit threshold
    evidenceFamily: "scale",
  },
  pause: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "no", // immediate pause, not a timed >=7d pause
    evidenceFamily: "destructive",
  },
  restructure: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "structural",
  },
  review_budget: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "conditional", // resets only past the ~20% significant-edit threshold
    evidenceFamily: "scale",
  },
  shift_budget_to_source: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "conditional",
    evidenceFamily: "scale",
  },
  consolidate: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "structural",
  },
  expand_targeting: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "structural",
  },
  switch_optimization_event: {
    financialEffect: true,
    externalEffect: true,
    resetsLearning: "yes",
    evidenceFamily: "scale",
  },
  // -- Informational / internal-queue only: swipe-approvable --
  hold: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "diagnostic",
  },
  test: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "diagnostic",
  },
  refresh_creative: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "yes", // elevated to externally-effecting at emission
    evidenceFamily: "diagnostic",
  },
  add_creative: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "yes", // elevated to externally-effecting at emission
    evidenceFamily: "destructive",
  },
  harden_capi_attribution: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "measurement",
  },
  fix_signal_health: {
    financialEffect: false,
    externalEffect: false,
    resetsLearning: "no",
    evidenceFamily: "measurement",
  },
};

/**
 * "Would this action mutate live money / platform state?" -- the question the
 * OpportunityArbitrator (and, in Phase C, any execution path) must answer the SAME
 * way the sink does. Bakes in the sink's elevation (recommendation-sink: any
 * resetsLearning === "yes" action is externally-effecting even when its static
 * booleans are false): financialEffect || externalEffect || resetsLearning === "yes".
 */
export function isMutating(action: AdRecommendationAction): boolean {
  const c = ACTION_CONTRACT[action];
  return c.financialEffect || c.externalEffect || c.resetsLearning === "yes";
}
