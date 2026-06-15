export const SETTLEMENT_LAG_HOURS = 24;

export const V1_ATTRIBUTABLE_KINDS = ["pause", "refresh_creative"] as const;

export type AttributableKind = (typeof V1_ATTRIBUTABLE_KINDS)[number];

export const KIND_CONFIG = {
  pause: {
    windowDays: 7,
    confidence: "medium" as const,
    primaryMetric: "spend" as const,
    favorableDirection: "down" as const,
    noiseFloorPct: 5,
    minimumAbsoluteMovementCents: 500,
  },
  refresh_creative: {
    windowDays: 14,
    confidence: "low" as const,
    primaryMetric: "ctr" as const,
    favorableDirection: "up" as const,
    noiseFloorPct: 10,
  },
} as const;

export function isAttributableKind(kind: string | undefined | null): kind is AttributableKind {
  return typeof kind === "string" && (V1_ATTRIBUTABLE_KINDS as readonly string[]).includes(kind);
}

// D7-5 (prep, NOT activation): shift_budget_to_source attribution, staged behind a HARD Spec-1B gate.
//
// shift_budget_to_source is Riley's north-star money move (analyzers/source-reallocation.ts), today
// emitted ADVISORY-ONLY (a recommendation with steps for a human, never an executed Meta write), so
// there is no executed-action anchor to attribute an outcome window on. It is therefore deliberately
// EXCLUDED from V1_ATTRIBUTABLE_KINDS / isAttributableKind above and stays excluded until Spec-1B
// ships an executor. The config below is a validated BLUEPRINT (read by NO live path) so that the day
// Spec-1B makes the action executable, enabling attribution is a list move, not a redesign.
//
// ACTIVATION CHECKLIST (do NOT do any of this until Tier 5 is green AND a Spec-1B executor exists):
//   1. Spec-1B ships a shift_budget_to_source executor that calls markActedByExecution with the
//      executed work unit (mirror riley-pause-executor.ts).
//   2. Move "shift_budget_to_source" from SPEC_1B_PENDING_KINDS into V1_ATTRIBUTABLE_KINDS.
//   3. Merge KIND_CONFIG_PENDING.shift_budget_to_source into KIND_CONFIG.
//   4. Extend the corroboration predicate if the booked-value second-estimate is wanted at source
//      granularity (see the note in outcome-corroboration.ts).
// Cross-ref overview decision #4 (Spec-1B gate) + the Tier-5 D4-6 blast-radius contract.

/** Kinds whose attribution is DESIGNED but inert until Spec-1B makes the action executable. Staged so
 * activation is a list move, not a redesign. NOT in V1_ATTRIBUTABLE_KINDS, so isAttributableKind still
 * returns false for these. HARD DEPENDENCY: no activation until Tier 5 is green and an executor exists. */
export const SPEC_1B_PENDING_KINDS = ["shift_budget_to_source"] as const;

/** The attribution shape shift_budget_to_source WILL use once executable. Read by NO live path: a
 * blueprint, validated by tests so it cannot rot before Spec-1B consumes it. */
export const KIND_CONFIG_PENDING = {
  shift_budget_to_source: {
    windowDays: 14,
    confidence: "low" as const,
    primaryMetric: "spend" as const, // attribute on the budget actually moved
    favorableDirection: "up" as const, // trueROAS of the destination source should rise
    noiseFloorPct: 10,
  },
} as const;
