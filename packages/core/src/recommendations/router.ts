import type { RecommendationSurface } from "@switchboard/schemas";

// v1 Balanced mode — hardcoded.
// v1.5 will replace these constants with a mode lookup keyed off org config
// (Conservative / Balanced / Aggressive). v2+ may expose per-module modes.
// Per-agent tuning is NOT a goal. See spec section "Operator UX Principles".
const BALANCED = {
  shadowConfidence: 0.85,
  shadowMaxRisk: 50, // dollars
  queueMinConfidence: 0.5,
} as const;

const REVERSIBLE_ACTIONS = new Set(["pause", "reduce_budget"]);

export interface RouteInput {
  confidence: number;
  dollarsAtRisk: number;
  action: string;
}

export function routeRecommendation(input: RouteInput): RecommendationSurface {
  const reversible = REVERSIBLE_ACTIONS.has(input.action);

  if (
    reversible &&
    input.confidence >= BALANCED.shadowConfidence &&
    input.dollarsAtRisk < BALANCED.shadowMaxRisk
  ) {
    return "shadow_action";
  }
  if (input.confidence >= BALANCED.queueMinConfidence) {
    return "queue";
  }
  return "dropped";
}
