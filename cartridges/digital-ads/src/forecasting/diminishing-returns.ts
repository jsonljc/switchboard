// ---------------------------------------------------------------------------
// Diminishing Returns Analyzer — Fits log curves and finds optimal spend
// ---------------------------------------------------------------------------

import type { DiminishingReturnsResult } from "./types.js";

export class DiminishingReturnsAnalyzer {
  /**
   * Analyze spend vs. conversions data to fit a diminishing returns curve.
   *
   * Fits a log curve: conversions = a * ln(spend) + b
   * Identifies the optimal spend point where marginal CPA = 2x average CPA.
   */
  analyze(dataPoints: Array<{ spend: number; conversions: number }>): DiminishingReturnsResult {
    // Filter out invalid data points
    const validPoints = dataPoints.filter((p) => p.spend > 0 && p.conversions > 0);

    if (validPoints.length < 2) {
      return {
        dataPoints: validPoints,
        curveType: "log",
        parameters: { a: 0, b: 0 },
        optimalSpend: null,
        saturationPoint: null,
        recommendations: [
          "Insufficient data points for curve fitting. Need at least 2 data points with positive spend and conversions.",
        ],
      };
    }

    // Fit log curve using least squares: conversions = a * ln(spend) + b
    const { a, b } = this.fitLogCurve(validPoints);

    // Find optimal spend point (where marginal CPA = 2x average CPA)
    const optimalSpend = this.findOptimalSpend(a, b);

    // Find saturation point (where marginal conversions < 1% of average)
    const saturationPoint = this.findSaturationPoint(a, validPoints);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      validPoints,
      a,
      b,
      optimalSpend,
      saturationPoint,
    );

    return {
      dataPoints: validPoints,
      curveType: "log",
      parameters: { a: Math.round(a * 1000) / 1000, b: Math.round(b * 1000) / 1000 },
      optimalSpend: optimalSpend !== null ? Math.round(optimalSpend * 100) / 100 : null,
      saturationPoint: saturationPoint !== null ? Math.round(saturationPoint * 100) / 100 : null,
      recommendations,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fit a log curve (conversions = a * ln(spend) + b) using least squares regression.
   * Transform: let x = ln(spend), then fit linear y = a*x + b.
   */
  private fitLogCurve(points: Array<{ spend: number; conversions: number }>): {
    a: number;
    b: number;
  } {
    const n = points.length;

    // Transform spend to ln(spend)
    const xs = points.map((p) => Math.log(p.spend));
    const ys = points.map((p) => p.conversions);

    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i]!, 0);
    const sumXX = xs.reduce((s, x) => s + x * x, 0);

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) {
      // Degenerate case — all x values are the same
      const meanY = sumY / n;
      return { a: 0, b: meanY };
    }

    const a = (n * sumXY - sumX * sumY) / denom;
    const b = (sumY - a * sumX) / n;

    return { a, b };
  }

  /**
   * Find the optimal spend point where marginal CPA = 2x average CPA.
   *
   * Average CPA at spend s: s / (a * ln(s) + b)
   * Marginal CPA at spend s: 1 / (a / s) = s / a
   * Optimal: s / a = 2 * s / (a * ln(s) + b)
   * Simplifies to: a * ln(s) + b = 2 * a, so ln(s) = (2*a - b) / a
   */
  private findOptimalSpend(a: number, b: number): number | null {
    if (a <= 0) {
      return null;
    }

    const lnOptimal = (2 * a - b) / a;
    const optimalSpend = Math.exp(lnOptimal);

    // Sanity check — don't return unreasonable values
    if (optimalSpend <= 0 || !isFinite(optimalSpend) || optimalSpend > 1e10) {
      return null;
    }

    return optimalSpend;
  }

  /**
   * Find the saturation point where the marginal conversion rate drops below
   * 1% of the average conversion rate across data points.
   */
  private findSaturationPoint(
    a: number,
    points: Array<{ spend: number; conversions: number }>,
  ): number | null {
    if (a <= 0) {
      return null;
    }

    // Average conversion rate across data points
    const totalConversions = points.reduce((s, p) => s + p.conversions, 0);
    const totalSpend = points.reduce((s, p) => s + p.spend, 0);
    const avgRate = totalSpend > 0 ? totalConversions / totalSpend : 0;

    if (avgRate <= 0) {
      return null;
    }

    // Marginal conversion rate at spend s: a / s
    // Saturation: a / s = 0.01 * avgRate => s = a / (0.01 * avgRate) = 100 * a / avgRate
    const saturation = (100 * a) / avgRate;

    if (!isFinite(saturation) || saturation <= 0 || saturation > 1e10) {
      return null;
    }

    return saturation;
  }

  private generateRecommendations(
    points: Array<{ spend: number; conversions: number }>,
    a: number,
    b: number,
    optimalSpend: number | null,
    saturationPoint: number | null,
  ): string[] {
    const recommendations: string[] = [];

    // Current max spend in data
    const maxSpend = Math.max(...points.map((p) => p.spend));

    if (a <= 0) {
      recommendations.push(
        "Data does not show a positive relationship between spend and conversions. Review campaign targeting and creative.",
      );
      return recommendations;
    }

    recommendations.push(
      `Log curve fit: conversions = ${a.toFixed(2)} * ln(spend) + ${b.toFixed(2)}`,
    );

    if (optimalSpend !== null) {
      if (maxSpend < optimalSpend * 0.8) {
        recommendations.push(
          `Current spend is below optimal ($${optimalSpend.toFixed(2)}). Room to scale with acceptable CPA increase.`,
        );
      } else if (maxSpend > optimalSpend * 1.2) {
        recommendations.push(
          `Current spend exceeds optimal ($${optimalSpend.toFixed(2)}). Consider reducing budget to improve efficiency.`,
        );
      } else {
        recommendations.push(
          `Current spend is near the optimal level ($${optimalSpend.toFixed(2)}).`,
        );
      }
    }

    if (saturationPoint !== null) {
      recommendations.push(
        `Saturation point estimated at $${saturationPoint.toFixed(2)}. Beyond this, marginal returns are negligible.`,
      );
    }

    return recommendations;
  }
}
