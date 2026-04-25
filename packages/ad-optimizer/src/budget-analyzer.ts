import type {
  CampaignBudgetEntrySchema as CampaignBudgetEntry,
  BudgetImbalanceSchema as BudgetImbalance,
  BudgetAnalysisSchema as BudgetAnalysis,
} from "@switchboard/schemas";

/**
 * Detects whether Campaign Budget Optimization (CBO) is active.
 * Returns true if either daily or lifetime budget is non-null and positive.
 */
export function detectCBO(dailyBudget: number | null, lifetimeBudget: number | null): boolean {
  return (dailyBudget != null && dailyBudget > 0) || (lifetimeBudget != null && lifetimeBudget > 0);
}

/**
 * Analyzes budget distribution across campaigns to detect imbalances.
 * Flags overspending underperformers and underspending winners.
 */
export function analyzeBudgetDistribution(
  entries: CampaignBudgetEntry[],
  targetCPA: number,
  accountSpendCap: number | null,
  currency = "USD",
): BudgetAnalysis {
  if (entries.length < 2) {
    return {
      entries,
      imbalances: [],
      accountSpendCap,
      currency,
    };
  }

  const avgRoas = entries.reduce((sum, e) => sum + e.roas, 0) / entries.length;

  const imbalances: BudgetImbalance[] = [];

  for (const entry of entries) {
    if (entry.spendShare > 0.4 && entry.cpa > targetCPA && entry.roas < avgRoas) {
      imbalances.push({
        type: "overspending_underperformer",
        campaignId: entry.campaignId,
        campaignName: entry.campaignName,
        spendShare: entry.spendShare,
        metric: "cpa",
        value: entry.cpa,
        message:
          `${entry.campaignName} consumes ${(entry.spendShare * 100).toFixed(0)}% of spend ` +
          `with CPA $${entry.cpa.toFixed(2)} (target: $${targetCPA.toFixed(2)}, avg ROAS: ${avgRoas.toFixed(2)})`,
      });
    }

    if (entry.spendShare < 0.1 && entry.cpa < targetCPA * 0.8 && entry.roas > avgRoas) {
      imbalances.push({
        type: "underspending_winner",
        campaignId: entry.campaignId,
        campaignName: entry.campaignName,
        spendShare: entry.spendShare,
        metric: "roas",
        value: entry.roas,
        message:
          `${entry.campaignName} gets only ${(entry.spendShare * 100).toFixed(0)}% of spend ` +
          `but achieves ROAS ${entry.roas.toFixed(2)} (avg: ${avgRoas.toFixed(2)}) ` +
          `and CPA $${entry.cpa.toFixed(2)} (target: $${targetCPA.toFixed(2)})`,
      });
    }
  }

  return {
    entries,
    imbalances,
    accountSpendCap,
    currency,
  };
}
