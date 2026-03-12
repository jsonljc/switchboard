// ---------------------------------------------------------------------------
// Budget Guardrails — Spend limits and increase validation
// ---------------------------------------------------------------------------
// Enforces budget caps on proposed spend changes. The strictest limit
// always wins (Math.min across all defined limits).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetLimits {
  /** Max daily spend cap (absolute) */
  maxDailySpend?: number;
  /** Max total campaign budget */
  maxCampaignBudget?: number;
  /** Max per-intervention spend */
  maxInterventionSpend?: number;
}

export interface BudgetCapResult {
  /** The final capped spend amount */
  cappedSpend: number;
  /** Which limit was applied (null if no cap hit) */
  limitApplied: keyof BudgetLimits | null;
  /** Explanation of the capping decision */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// applyBudgetCap — Enforce the strictest limit
// ---------------------------------------------------------------------------

export function applyBudgetCap(proposedSpend: number, limits: BudgetLimits): BudgetCapResult {
  if (proposedSpend <= 0) {
    return {
      cappedSpend: 0,
      limitApplied: null,
      reasoning: "Proposed spend is zero or negative",
    };
  }

  const definedLimits: Array<{ key: keyof BudgetLimits; value: number }> = [];

  if (limits.maxDailySpend !== undefined) {
    definedLimits.push({ key: "maxDailySpend", value: limits.maxDailySpend });
  }
  if (limits.maxCampaignBudget !== undefined) {
    definedLimits.push({ key: "maxCampaignBudget", value: limits.maxCampaignBudget });
  }
  if (limits.maxInterventionSpend !== undefined) {
    definedLimits.push({ key: "maxInterventionSpend", value: limits.maxInterventionSpend });
  }

  if (definedLimits.length === 0) {
    return {
      cappedSpend: proposedSpend,
      limitApplied: null,
      reasoning: "No budget limits defined — proposed spend approved as-is",
    };
  }

  // Find the strictest (lowest) limit
  let strictest = definedLimits[0]!;
  for (let i = 1; i < definedLimits.length; i++) {
    if (definedLimits[i]!.value < strictest.value) {
      strictest = definedLimits[i]!;
    }
  }

  if (proposedSpend <= strictest.value) {
    return {
      cappedSpend: proposedSpend,
      limitApplied: null,
      reasoning: `Proposed spend $${proposedSpend.toFixed(2)} is within all limits`,
    };
  }

  const cappedSpend = Math.min(proposedSpend, ...definedLimits.map((l) => l.value));

  return {
    cappedSpend,
    limitApplied: strictest.key,
    reasoning: `Proposed spend $${proposedSpend.toFixed(2)} capped to $${cappedSpend.toFixed(2)} by ${strictest.key} limit`,
  };
}

// ---------------------------------------------------------------------------
// validateSpendIncrease — Check if a daily spend increase is within bounds
// ---------------------------------------------------------------------------

export function validateSpendIncrease(
  currentDailySpend: number,
  proposedDailySpend: number,
  maxIncreasePct: number,
): boolean {
  if (currentDailySpend <= 0) {
    // If current spend is zero, any positive spend is valid
    return proposedDailySpend >= 0;
  }

  const increaseRatio = (proposedDailySpend - currentDailySpend) / currentDailySpend;
  return increaseRatio <= maxIncreasePct / 100;
}
