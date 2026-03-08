// ---------------------------------------------------------------------------
// Pacing Monitor — Compares actual vs planned spend for flight plans
// ---------------------------------------------------------------------------

import type { FlightPlan, PacingStatus, PacingAdjustment } from "./types.js";

export class PacingMonitor {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  /**
   * Check pacing for a flight plan by fetching actual spend from the insights API
   * and comparing it to the planned spend based on the pacing curve.
   */
  async checkPacing(flight: FlightPlan): Promise<PacingStatus> {
    const now = new Date();
    const start = new Date(flight.startDate);
    const end = new Date(flight.endDate);

    const totalDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const daysElapsed = Math.max(
      0,
      Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const daysRemaining = Math.max(0, totalDays - daysElapsed);

    // Fetch actual spend from the insights API
    const actualSpendToDate = await this.fetchActualSpend(
      flight.campaignId,
      flight.startDate,
      this.formatDate(now),
    );

    // Calculate planned spend based on pacing curve
    const plannedSpendToDate = this.calculatePlannedSpend(
      flight.totalBudget,
      totalDays,
      daysElapsed,
      flight.pacingCurve,
    );

    // Compute pacing ratio (actual / planned)
    const pacingRatio = plannedSpendToDate > 0 ? actualSpendToDate / plannedSpendToDate : 0;

    // Determine status
    let status: PacingStatus["status"];
    if (pacingRatio >= 0.9 && pacingRatio <= 1.1) {
      status = "on_pace";
    } else if (pacingRatio < 0.9) {
      status = "underpacing";
    } else {
      status = "overpacing";
    }

    // Project end spend based on current rate
    const dailySpendRate = daysElapsed > 0 ? actualSpendToDate / daysElapsed : 0;
    const projectedEndSpend = actualSpendToDate + dailySpendRate * daysRemaining;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      status,
      pacingRatio,
      flight.totalBudget,
      actualSpendToDate,
      daysRemaining,
      projectedEndSpend,
    );

    return {
      flightPlan: flight,
      daysElapsed,
      daysRemaining,
      plannedSpendToDate,
      actualSpendToDate,
      pacingRatio: Math.round(pacingRatio * 1000) / 1000,
      status,
      projectedEndSpend: Math.round(projectedEndSpend * 100) / 100,
      recommendations,
    };
  }

  /**
   * Calculate a recommended daily budget adjustment based on pacing status.
   */
  calculateAdjustment(status: PacingStatus): PacingAdjustment {
    const remainingBudget = status.flightPlan.totalBudget - status.actualSpendToDate;
    const daysRemaining = Math.max(1, status.daysRemaining);
    const recommendedDailyBudget = Math.round((remainingBudget / daysRemaining) * 100) / 100;

    const currentDailyBudget =
      status.daysElapsed > 0
        ? Math.round((status.actualSpendToDate / status.daysElapsed) * 100) / 100
        : 0;

    let reason: string;
    if (status.status === "underpacing") {
      reason = `Underpacing at ${(status.pacingRatio * 100).toFixed(1)}%. Increase daily budget to $${recommendedDailyBudget.toFixed(2)} to spend remaining $${remainingBudget.toFixed(2)} over ${daysRemaining} days.`;
    } else if (status.status === "overpacing") {
      reason = `Overpacing at ${(status.pacingRatio * 100).toFixed(1)}%. Reduce daily budget to $${recommendedDailyBudget.toFixed(2)} to avoid exhausting the $${status.flightPlan.totalBudget.toFixed(2)} budget early.`;
    } else {
      reason = "On pace. No adjustment needed.";
    }

    return {
      campaignId: status.flightPlan.campaignId,
      currentDailyBudget,
      recommendedDailyBudget: Math.max(0, recommendedDailyBudget),
      reason,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchActualSpend(
    campaignId: string,
    since: string,
    until: string,
  ): Promise<number> {
    const url =
      `${this.baseUrl}/${campaignId}/insights?` +
      `fields=spend` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
      `&access_token=${this.accessToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = body.error as Record<string, unknown> | undefined;
      throw new Error(`Meta API error: ${(error?.message as string) ?? `HTTP ${response.status}`}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rows = (data.data ?? []) as Array<Record<string, unknown>>;
    const firstRow = rows[0];
    return Number(firstRow?.spend ?? 0);
  }

  /**
   * Calculate planned spend to date based on pacing curve.
   *
   * - even: linear distribution
   * - front-loaded: 60% of budget in first half
   * - back-loaded: 40% of budget in first half
   */
  private calculatePlannedSpend(
    totalBudget: number,
    totalDays: number,
    daysElapsed: number,
    curve: FlightPlan["pacingCurve"],
  ): number {
    const progress = Math.min(1, daysElapsed / totalDays);

    switch (curve) {
      case "even":
        return totalBudget * progress;
      case "front-loaded": {
        // Use a power curve that front-loads spending
        // At 50% of time, 60% of budget should be spent
        const adjusted = Math.pow(progress, 0.73);
        return totalBudget * adjusted;
      }
      case "back-loaded": {
        // Use a power curve that back-loads spending
        // At 50% of time, 40% of budget should be spent
        const adjusted = Math.pow(progress, 1.32);
        return totalBudget * adjusted;
      }
    }
  }

  private generateRecommendations(
    status: PacingStatus["status"],
    pacingRatio: number,
    totalBudget: number,
    actualSpend: number,
    daysRemaining: number,
    projectedEndSpend: number,
  ): string[] {
    const recommendations: string[] = [];

    if (status === "underpacing") {
      const remaining = totalBudget - actualSpend;
      const suggestedDaily = daysRemaining > 0 ? remaining / daysRemaining : 0;
      recommendations.push(
        `Campaign is underpacing at ${(pacingRatio * 100).toFixed(1)}% of planned spend.`,
      );
      recommendations.push(
        `Increase daily budget to ~$${suggestedDaily.toFixed(2)} to hit the $${totalBudget.toFixed(2)} target.`,
      );
      if (pacingRatio < 0.5) {
        recommendations.push(
          "Consider broadening targeting or increasing bids to improve delivery.",
        );
      }
    } else if (status === "overpacing") {
      recommendations.push(
        `Campaign is overpacing at ${(pacingRatio * 100).toFixed(1)}% of planned spend.`,
      );
      if (projectedEndSpend > totalBudget * 1.1) {
        recommendations.push(
          `At current rate, projected end spend is $${projectedEndSpend.toFixed(2)} — ${((projectedEndSpend / totalBudget - 1) * 100).toFixed(0)}% over budget.`,
        );
        recommendations.push("Reduce daily budget or narrow targeting to slow delivery.");
      }
    } else {
      recommendations.push("Campaign is on pace. No immediate action needed.");
    }

    return recommendations;
  }

  private formatDate(date: Date): string {
    return date.toISOString().split("T")[0] ?? "";
  }
}
