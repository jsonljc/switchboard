import type { AdRecommendationActionSchema as AdRecommendationAction } from "@switchboard/schemas";

export interface Evidence {
  clicks: number;
  conversions: number;
  days: number;
}

export type EvidenceFamily =
  | "destructive" // pause / cut — highest floor
  | "scale" // moderate-high
  | "structural" // restructure/consolidate/expand — requires learning-limited + volume (Phase D); destructive-grade floor here
  | "diagnostic" // hold / diagnose-only — low floor
  | "measurement"; // signal/CAPI fixes — account-level, bypass campaign-volume floor

const FAMILY: Record<AdRecommendationAction, EvidenceFamily> = {
  pause: "destructive",
  add_creative: "destructive",
  scale: "scale",
  review_budget: "scale",
  shift_budget_to_source: "scale",
  refresh_creative: "diagnostic",
  restructure: "structural",
  consolidate: "structural",
  expand_targeting: "structural",
  switch_optimization_event: "scale",
  hold: "diagnostic",
  test: "diagnostic",
  harden_capi_attribution: "measurement",
  fix_signal_health: "measurement",
};

/** Floors are small-budget-calibrated; named config, not magic numbers (Phase-A spec §11).
 * Tune via the eval, never silently. */
export const EVIDENCE_FLOORS: Record<EvidenceFamily, Evidence> = {
  destructive: { clicks: 50, conversions: 5, days: 7 },
  structural: { clicks: 50, conversions: 5, days: 7 },
  scale: { clicks: 30, conversions: 3, days: 7 },
  diagnostic: { clicks: 10, conversions: 0, days: 3 },
  measurement: { clicks: 0, conversions: 0, days: 0 },
};

export function evidenceFamilyFor(action: AdRecommendationAction): EvidenceFamily {
  return FAMILY[action];
}

export function meetsEvidenceFloor(action: AdRecommendationAction, e: Evidence): boolean {
  const floor = EVIDENCE_FLOORS[evidenceFamilyFor(action)];
  return e.clicks >= floor.clicks && e.conversions >= floor.conversions && e.days >= floor.days;
}
