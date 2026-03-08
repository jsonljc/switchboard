// ---------------------------------------------------------------------------
// Anomaly Detector — Statistical anomaly detection for ad metrics
// ---------------------------------------------------------------------------

import type { AnomalyResult } from "./types.js";

export interface DailyMetrics {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpm: number;
  cpa: number | null;
}

export class AnomalyDetector {
  /**
   * Scan daily metrics for anomalies using z-score and IQR methods.
   * The latest data point is compared against historical values.
   * |z-score| > 2 = warning, > 3 = critical.
   */
  scan(dailyMetrics: DailyMetrics[]): AnomalyResult[] {
    if (dailyMetrics.length < 3) {
      return [];
    }

    // Use all but the last point as historical, last point as current
    const historical = dailyMetrics.slice(0, -1);
    const current = dailyMetrics[dailyMetrics.length - 1]!;

    const results: AnomalyResult[] = [];
    const metricKeys: Array<keyof Omit<DailyMetrics, "date">> = [
      "spend",
      "impressions",
      "clicks",
      "conversions",
      "ctr",
      "cpm",
      "cpa",
    ];

    for (const key of metricKeys) {
      const historicalValues = historical
        .map((d) => d[key])
        .filter((v): v is number => v !== null && v !== undefined);

      if (historicalValues.length < 3) {
        continue;
      }

      const currentValue = current[key];
      if (currentValue === null || currentValue === undefined) {
        continue;
      }

      const mean = this.computeMean(historicalValues);
      const stdDev = this.computeStdDev(historicalValues, mean);

      // Z-score method
      let zScore = 0;
      if (stdDev > 0) {
        zScore = (currentValue - mean) / stdDev;
      }

      // IQR method as backup for non-normal distributions
      const iqrAnomaly = this.checkIQR(historicalValues, currentValue);

      const absZ = Math.abs(zScore);

      // Determine severity
      let severity: AnomalyResult["severity"];
      if (absZ > 3 || iqrAnomaly === "extreme") {
        severity = "critical";
      } else if (absZ > 2 || iqrAnomaly === "mild") {
        severity = "warning";
      } else {
        continue; // Not anomalous
      }

      const direction = zScore > 0 ? "above" : "below";
      const message =
        `${key} is ${Math.abs(zScore).toFixed(1)} standard deviations ${direction} ` +
        `the historical mean (current: ${currentValue.toFixed(2)}, ` +
        `mean: ${mean.toFixed(2)}, stdDev: ${stdDev.toFixed(2)})`;

      results.push({
        metric: key,
        currentValue,
        historicalMean: Math.round(mean * 100) / 100,
        historicalStdDev: Math.round(stdDev * 100) / 100,
        zScore: Math.round(zScore * 100) / 100,
        severity,
        message,
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private computeMean(values: number[]): number {
    const sum = values.reduce((acc, v) => acc + v, 0);
    return sum / values.length;
  }

  private computeStdDev(values: number[], mean: number): number {
    const squaredDiffs = values.map((v) => (v - mean) ** 2);
    const avgSquaredDiff = squaredDiffs.reduce((acc, v) => acc + v, 0) / values.length;
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * IQR-based outlier detection as backup for non-normal distributions.
   * Returns "extreme" if beyond 3*IQR, "mild" if beyond 1.5*IQR, or null.
   */
  private checkIQR(values: number[], current: number): "extreme" | "mild" | null {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = this.percentile(sorted, 25);
    const q3 = this.percentile(sorted, 75);
    const iqr = q3 - q1;

    if (iqr === 0) {
      return null;
    }

    const lowerExtreme = q1 - 3 * iqr;
    const upperExtreme = q3 + 3 * iqr;
    const lowerMild = q1 - 1.5 * iqr;
    const upperMild = q3 + 1.5 * iqr;

    if (current < lowerExtreme || current > upperExtreme) {
      return "extreme";
    }
    if (current < lowerMild || current > upperMild) {
      return "mild";
    }
    return null;
  }

  private percentile(sortedValues: number[], p: number): number {
    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) {
      return sortedValues[lower]!;
    }
    const fraction = index - lower;
    return sortedValues[lower]! * (1 - fraction) + sortedValues[upper]! * fraction;
  }
}
