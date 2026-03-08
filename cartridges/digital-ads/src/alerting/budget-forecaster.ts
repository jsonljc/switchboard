// ---------------------------------------------------------------------------
// Budget Forecaster — Projects campaign budget exhaustion timelines
// ---------------------------------------------------------------------------

import type { BudgetForecast } from "./types.js";

export class BudgetForecaster {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  /**
   * Forecast budget exhaustion for all campaigns in an ad account.
   * Uses the last 7-day average spend rate to project remaining budget duration.
   */
  async forecast(adAccountId: string): Promise<BudgetForecast[]> {
    const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    // Fetch active campaigns with spend data
    const campaignsUrl =
      `${this.baseUrl}/${accountId}/campaigns?` +
      `fields=id,name,daily_budget,lifetime_budget,budget_remaining,effective_status` +
      `&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]` +
      `&access_token=${this.accessToken}`;

    const campaignsData = await this.fetchJson(campaignsUrl);
    const campaigns = (campaignsData.data ?? []) as Array<Record<string, unknown>>;

    const forecasts: BudgetForecast[] = [];

    for (const campaign of campaigns) {
      const campaignId = String(campaign.id);

      // Fetch last 7d insights
      const insightsUrl =
        `${this.baseUrl}/${campaignId}/insights?` +
        `fields=spend` +
        `&date_preset=last_7d` +
        `&access_token=${this.accessToken}`;

      let dailySpendRate = 0;
      try {
        const insightsData = await this.fetchJson(insightsUrl);
        const rows = (insightsData.data ?? []) as Array<Record<string, unknown>>;
        const totalSpend7d = rows.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
        dailySpendRate = totalSpend7d / 7;
      } catch {
        // Insights may not be available for new/paused campaigns
      }

      const dailyBudget = Number(campaign.daily_budget ?? 0) / 100; // API returns cents
      const remainingBudget = campaign.budget_remaining != null
        ? Number(campaign.budget_remaining) / 100
        : null;

      // Calculate days until exhaustion (only meaningful for lifetime budgets)
      let daysUntilExhaustion: number | null = null;
      if (remainingBudget !== null && dailySpendRate > 0) {
        daysUntilExhaustion = Math.ceil(remainingBudget / dailySpendRate);
      }

      const projectedMonthlySpend = dailySpendRate * 30;

      // Determine status
      const status = this.determineStatus(
        dailySpendRate,
        dailyBudget,
        daysUntilExhaustion,
      );

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        status,
        dailySpendRate,
        dailyBudget,
        daysUntilExhaustion,
        remainingBudget,
      );

      forecasts.push({
        campaignId,
        campaignName: String(campaign.name ?? ""),
        dailyBudget,
        dailySpendRate: Math.round(dailySpendRate * 100) / 100,
        remainingBudget,
        daysUntilExhaustion,
        projectedMonthlySpend: Math.round(projectedMonthlySpend * 100) / 100,
        status,
        recommendations,
      });
    }

    return forecasts;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private determineStatus(
    dailySpendRate: number,
    dailyBudget: number,
    daysUntilExhaustion: number | null,
  ): BudgetForecast["status"] {
    if (daysUntilExhaustion !== null && daysUntilExhaustion <= 7) {
      return "budget_exhausting";
    }

    if (dailyBudget > 0) {
      const spendRatio = dailySpendRate / dailyBudget;
      if (spendRatio > 1.1) {
        return "overspending";
      }
      if (spendRatio < 0.5) {
        return "underspending";
      }
    }

    return "healthy";
  }

  private generateRecommendations(
    status: BudgetForecast["status"],
    dailySpendRate: number,
    dailyBudget: number,
    daysUntilExhaustion: number | null,
    remainingBudget: number | null,
  ): string[] {
    const recommendations: string[] = [];

    switch (status) {
      case "budget_exhausting":
        recommendations.push(
          `Budget will be exhausted in ${daysUntilExhaustion ?? 0} day(s) at current spend rate.`,
        );
        if (remainingBudget !== null) {
          recommendations.push(
            `Remaining budget: $${remainingBudget.toFixed(2)}. Consider increasing budget or reducing bids.`,
          );
        }
        break;
      case "overspending":
        recommendations.push(
          `Daily spend ($${dailySpendRate.toFixed(2)}) exceeds daily budget ($${dailyBudget.toFixed(2)}).`,
        );
        recommendations.push(
          "Review bid strategies and audience targeting to control spend.",
        );
        break;
      case "underspending":
        recommendations.push(
          `Daily spend ($${dailySpendRate.toFixed(2)}) is well below daily budget ($${dailyBudget.toFixed(2)}).`,
        );
        recommendations.push(
          "Consider broadening targeting, increasing bids, or improving creative quality.",
        );
        break;
      case "healthy":
        recommendations.push("Budget utilization is healthy. No immediate action required.");
        break;
    }

    return recommendations;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(
        `Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
