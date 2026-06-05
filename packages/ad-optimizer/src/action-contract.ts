import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  ResetsLearningSchema as ResetsLearning,
} from "@switchboard/schemas";

/** Evidence families (moved here from evidence-floor.ts so the one-way import
 * graph stays acyclic: action-contract <- evidence-floor / reset-classification /
 * sink / arbitrator). evidence-floor re-exports it for back-compat. */
export type EvidenceFamily =
  | "destructive" // pause / cut: highest floor
  | "scale" // moderate-high
  | "structural" // restructure/consolidate/expand: destructive-grade floor (Phase D)
  | "diagnostic" // hold / diagnose-only: low floor
  | "measurement"; // signal/CAPI fixes: account-level, bypass campaign-volume floor

/**
 * Riley v3 slice 2 (spec 2.3): ONE keyed per-action contract consolidating the three
 * formerly-parallel maps: the sink's ACTION_RISK_CONTRACT booleans, the
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
  // ── Money- or ad-platform-state-changing: NOT swipe-approvable ──
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
  // ── Informational / internal-queue only: swipe-approvable ──
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
 * "Would this action mutate live money / platform state?" is the question the
 * OpportunityArbitrator (and, in Phase C, any execution path) must answer the SAME
 * way the sink does. Bakes in the sink's elevation (recommendation-sink: any
 * resetsLearning === "yes" action is externally-effecting even when its static
 * booleans are false): financialEffect || externalEffect || resetsLearning === "yes".
 */
export function isMutating(action: AdRecommendationAction): boolean {
  const c = ACTION_CONTRACT[action];
  return c.financialEffect || c.externalEffect || c.resetsLearning === "yes";
}

/**
 * PHASE-C (designed-but-unwired; Riley v3 slice 5): execution-time contract for a
 * self-executed action class. Declarations only, strings not machinery; consumed by
 * nothing live. The submit-request mapper lives in
 * apps/api/src/services/workflows/riley-pause-submit-request.ts (CanonicalSubmitRequest
 * is a core type and this package is Layer 2: schemas only).
 */
export interface PhaseCExecutionContract {
  /**
   * PLATFORM-STATE reversibility: can the ad-platform state be cleanly restored?
   * Deliberately NOT outcome reversibility: lost delivery, auction re-entry effects,
   * and missed bookings during the action window are not reversed by the rollback.
   */
  reversibility: "full" | "partial" | "none";
  /** Human-readable inverse action the executor (or operator) applies to undo. */
  rollbackPlan: string;
  /** What improving looks like after the action lands. */
  successMetric: string;
  /** Abort signals the Phase-C executor must watch post-action. */
  guardrailMetrics: string[];
}

/**
 * Sparse on purpose: an action gets an entry only when it earns execution
 * (parent spec slice 5: pause is the first self-owned reversible class).
 * Do NOT backfill entries for actions nobody has reviewed for execution.
 */
export const PHASE_C_EXECUTION_SEAM: Partial<
  Record<AdRecommendationAction, PhaseCExecutionContract>
> = {
  pause: {
    reversibility: "full",
    rollbackPlan:
      "Resume the campaign (status back to ACTIVE). This reverses the platform state only, not any lost delivery during the paused window; delivery restarts without a learning reset.",
    successMetric: "Account-level cost per booked falls once the leaking campaign stops spending.",
    guardrailMetrics: [
      "account-level booked conversions drop beyond the paused campaign's share",
      "remaining campaigns' spend does not absorb the freed budget within the window",
    ],
  },
};

/**
 * CLASS eligibility ONLY (the "first self-owned reversible action class" gate,
 * parent spec slice 5): is this ACTION CLASS structurally safe to ever self-execute?
 * Phase-C wiring consumes THIS predicate verbatim; class eligibility is never
 * re-derived from scattered conditions.
 *
 * It deliberately does NOT decide request- or execution-eligibility. Approval policy,
 * org entitlement, evidence sufficiency, attribution confidence, learning/stability
 * windows, shared-budget/CBO membership, and budget-absorption risk are all
 * wiring-session concerns (GovernanceGate + the executor), NOT encoded here.
 * All four legs must hold: seam entry exists, platform-state reversible, never
 * resets learning, and actually mutating.
 */
export function isPhaseCActionClassEligible(action: AdRecommendationAction): boolean {
  const seam = PHASE_C_EXECUTION_SEAM[action];
  return (
    seam !== undefined &&
    seam.reversibility === "full" &&
    ACTION_CONTRACT[action].resetsLearning === "no" &&
    isMutating(action)
  );
}
