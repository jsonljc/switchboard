import type { AdRecommendationActionSchema as AdRecommendationAction } from "@switchboard/schemas";
import { ACTION_CONTRACT, type EvidenceFamily } from "./action-contract.js";

export type { EvidenceFamily } from "./action-contract.js";

export interface Evidence {
  clicks: number;
  conversions: number;
  days: number;
}

/** Floors are small-budget-calibrated; named config, not magic numbers (Phase-A spec §11).
 * Tune via the eval, never silently. */
export const EVIDENCE_FLOORS: Record<EvidenceFamily, Evidence> = {
  destructive: { clicks: 50, conversions: 5, days: 7 },
  structural: { clicks: 50, conversions: 5, days: 7 },
  scale: { clicks: 30, conversions: 3, days: 7 },
  diagnostic: { clicks: 10, conversions: 0, days: 3 },
  measurement: { clicks: 0, conversions: 0, days: 0 },
};

/** Minimum window clicks for a zero-conversion day/window to count as conclusive signal
 * rather than low-traffic noise. SHARED, single source of truth: the breach detector's
 * durability accrual (`meta-campaign-insights-provider.ts`) and the engine's
 * zero-conversion-burn rule (`recommendation-engine.ts`) both read it, so the two floors
 * can never silently diverge on a future tuning pass. Tune via the eval, never silently. */
export const ZERO_CONVERSION_DAY_CLICK_FLOOR = 20;

/** Derived from the consolidated ACTION_CONTRACT (Riley v3 slice 2). API unchanged. */
export function evidenceFamilyFor(action: AdRecommendationAction): EvidenceFamily {
  return ACTION_CONTRACT[action].evidenceFamily;
}

export function meetsEvidenceFloor(action: AdRecommendationAction, e: Evidence): boolean {
  const floor = EVIDENCE_FLOORS[evidenceFamilyFor(action)];
  return e.clicks >= floor.clicks && e.conversions >= floor.conversions && e.days >= floor.days;
}
