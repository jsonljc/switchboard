// ---------------------------------------------------------------------------
// Scenario Modeler — Budget scenario projections using diminishing returns
// ---------------------------------------------------------------------------

import type { BudgetScenario } from "./types.js";

export class ScenarioModeler {
  /**
   * Model budget scenarios using a log-based diminishing returns curve.
   * Projects CPA and conversions at each budget level.
   *
   * Uses the model: conversions = a * ln(spend) + b
   */
  model(params: {
    currentSpend: number;
    currentConversions: number;
    currentCPA: number;
    scenarioBudgets: number[];
  }): BudgetScenario[] {
    const { currentSpend, currentConversions, currentCPA, scenarioBudgets } = params;

    if (currentSpend <= 0 || currentConversions <= 0) {
      return scenarioBudgets.map((budget) => ({
        budgetLevel: budget,
        estimatedConversions: 0,
        estimatedCPA: 0,
        estimatedROAS: null,
        marginalCPA: null,
        recommendation: "Insufficient data to model scenarios. Need current spend and conversions.",
      }));
    }

    // Fit a log model: conversions = a * ln(spend) + b
    // Given one data point, we derive: a = currentConversions / ln(currentSpend)
    // and b = 0 (simplified single-point fit)
    const lnCurrentSpend = Math.log(currentSpend);
    const a = lnCurrentSpend > 0 ? currentConversions / lnCurrentSpend : currentConversions;
    const b = 0;

    const scenarios: BudgetScenario[] = [];
    let previousConversions = currentConversions;
    let previousBudget = currentSpend;

    // Sort scenarios by budget level for marginal CPA calculation
    const sortedBudgets = [...scenarioBudgets].sort((x, y) => x - y);

    for (const budget of sortedBudgets) {
      if (budget <= 0) {
        continue;
      }

      const lnBudget = Math.log(budget);
      const estimatedConversions = Math.max(0, a * lnBudget + b);
      const estimatedCPA =
        estimatedConversions > 0 ? budget / estimatedConversions : 0;

      // Marginal CPA: cost of each additional conversion at this budget level
      let marginalCPA: number | null = null;
      const additionalConversions = estimatedConversions - previousConversions;
      const additionalSpend = budget - previousBudget;
      if (additionalConversions > 0 && additionalSpend > 0) {
        marginalCPA = Math.round((additionalSpend / additionalConversions) * 100) / 100;
      }

      // Generate recommendation
      const recommendation = this.generateRecommendation(
        budget,
        currentSpend,
        estimatedCPA,
        currentCPA,
        marginalCPA,
      );

      scenarios.push({
        budgetLevel: budget,
        estimatedConversions: Math.round(estimatedConversions * 100) / 100,
        estimatedCPA: Math.round(estimatedCPA * 100) / 100,
        estimatedROAS: null, // Would need revenue data
        marginalCPA,
        recommendation,
      });

      previousConversions = estimatedConversions;
      previousBudget = budget;
    }

    return scenarios;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private generateRecommendation(
    budget: number,
    currentSpend: number,
    estimatedCPA: number,
    currentCPA: number,
    marginalCPA: number | null,
  ): string {
    const budgetChange = ((budget - currentSpend) / currentSpend) * 100;
    const cpaChange = ((estimatedCPA - currentCPA) / currentCPA) * 100;

    if (Math.abs(budgetChange) < 5) {
      return "Similar to current budget. Maintain current strategy.";
    }

    if (budgetChange > 0) {
      if (marginalCPA !== null && marginalCPA > currentCPA * 2) {
        return `Increasing budget by ${budgetChange.toFixed(0)}% shows diminishing returns. Marginal CPA ($${marginalCPA.toFixed(2)}) is ${(marginalCPA / currentCPA).toFixed(1)}x average CPA.`;
      }
      if (cpaChange > 20) {
        return `Budget increase of ${budgetChange.toFixed(0)}% would raise CPA by ${cpaChange.toFixed(0)}%. Consider scaling more gradually.`;
      }
      return `Budget increase of ${budgetChange.toFixed(0)}% — CPA impact is moderate (+${cpaChange.toFixed(0)}%). Viable for scaling.`;
    }

    // Budget decrease
    return `Budget decrease of ${Math.abs(budgetChange).toFixed(0)}% — CPA improves by ${Math.abs(cpaChange).toFixed(0)}%. Good for efficiency optimization.`;
  }
}
