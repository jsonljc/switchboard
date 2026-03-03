import { randomUUID } from "node:crypto";
import type { ABExperiment, ABVariant } from "./types.js";

/**
 * ExperimentManager — manages A/B testing of ad variants.
 *
 * Creates parallel ad sets with different parameters, monitors performance,
 * checks statistical significance, and declares winners.
 */
export class ExperimentManager {
  private experiments = new Map<string, ABExperiment>();

  /**
   * Create a new A/B experiment.
   */
  createExperiment(params: {
    name: string;
    campaignId: string;
    primaryMetric: ABExperiment["primaryMetric"];
    minSampleSize?: number;
    confidenceLevel?: number;
    variantConfigs: Array<{
      name: string;
      adSetId: string;
      parameters: Record<string, unknown>;
    }>;
  }): ABExperiment {
    const experimentId = `exp_${randomUUID()}`;

    const variants: ABVariant[] = params.variantConfigs.map((vc) => ({
      id: `var_${randomUUID()}`,
      experimentId,
      name: vc.name,
      adSetId: vc.adSetId,
      parameters: vc.parameters,
      status: "active" as const,
    }));

    const experiment: ABExperiment = {
      id: experimentId,
      name: params.name,
      campaignId: params.campaignId,
      primaryMetric: params.primaryMetric,
      minSampleSize: params.minSampleSize ?? 100,
      confidenceLevel: params.confidenceLevel ?? 0.95,
      variants,
      status: "running",
      winnerId: null,
      createdAt: new Date().toISOString(),
      concludedAt: null,
    };

    this.experiments.set(experimentId, experiment);
    return experiment;
  }

  /**
   * Update variant metrics from performance data.
   */
  updateVariantMetrics(
    experimentId: string,
    variantId: string,
    metrics: NonNullable<ABVariant["metrics"]>,
  ): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const variant = experiment.variants.find((v) => v.id === variantId);
    if (!variant) throw new Error(`Variant ${variantId} not found`);

    variant.metrics = metrics;
  }

  /**
   * Check if the experiment has reached statistical significance.
   * Uses a simplified z-test for proportions (conversion rate).
   */
  checkSignificance(experimentId: string): {
    significant: boolean;
    winnerId: string | null;
    pValue: number | null;
    details: string;
  } {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    const variants = experiment.variants.filter((v) => v.status === "active" && v.metrics);

    if (variants.length < 2) {
      return {
        significant: false,
        winnerId: null,
        pValue: null,
        details: "Need at least 2 active variants with metrics",
      };
    }

    // Check minimum sample size
    const allMeetMinSample = variants.every(
      (v) => (v.metrics?.impressions ?? 0) >= experiment.minSampleSize,
    );
    if (!allMeetMinSample) {
      return {
        significant: false,
        winnerId: null,
        pValue: null,
        details: `Minimum sample size (${experiment.minSampleSize}) not reached for all variants`,
      };
    }

    // Get the primary metric for each variant
    const metricValues = variants.map((v) => ({
      variantId: v.id,
      value: this.getMetricValue(v, experiment.primaryMetric),
      sampleSize: v.metrics!.impressions,
    }));

    // Find best and second-best
    metricValues.sort((a, b) => b.value - a.value);
    const best = metricValues[0]!;
    const secondBest = metricValues[1]!;

    // Simplified z-test
    const pooledRate =
      (best.value * best.sampleSize + secondBest.value * secondBest.sampleSize) /
      (best.sampleSize + secondBest.sampleSize);

    if (pooledRate === 0 || pooledRate === 1) {
      return {
        significant: false,
        winnerId: null,
        pValue: null,
        details: "Cannot compute significance: degenerate pooled rate",
      };
    }

    const se = Math.sqrt(
      pooledRate * (1 - pooledRate) * (1 / best.sampleSize + 1 / secondBest.sampleSize),
    );
    const zScore = se > 0 ? (best.value - secondBest.value) / se : 0;

    // Two-tailed p-value approximation
    const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));

    const requiredAlpha = 1 - experiment.confidenceLevel;
    const significant = pValue < requiredAlpha;

    return {
      significant,
      winnerId: significant ? best.variantId : null,
      pValue,
      details: significant
        ? `Variant ${best.variantId} wins with p-value ${pValue.toFixed(4)} (< ${requiredAlpha})`
        : `Not yet significant: p-value ${pValue.toFixed(4)} (need < ${requiredAlpha})`,
    };
  }

  /**
   * Conclude the experiment — declare winner, pause losers.
   */
  conclude(experimentId: string, winnerId: string): ABExperiment {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    for (const variant of experiment.variants) {
      variant.status = variant.id === winnerId ? "winner" : "loser";
    }

    experiment.status = "concluded";
    experiment.winnerId = winnerId;
    experiment.concludedAt = new Date().toISOString();

    return experiment;
  }

  /**
   * Get experiment by ID.
   */
  getExperiment(experimentId: string): ABExperiment | null {
    return this.experiments.get(experimentId) ?? null;
  }

  /**
   * List all experiments.
   */
  listExperiments(): ABExperiment[] {
    return Array.from(this.experiments.values());
  }

  private getMetricValue(variant: ABVariant, metric: ABExperiment["primaryMetric"]): number {
    if (!variant.metrics) return 0;
    switch (metric) {
      case "cpa":
        return variant.metrics.conversions > 0
          ? variant.metrics.spend / variant.metrics.conversions
          : Infinity;
      case "ctr":
        return variant.metrics.impressions > 0
          ? variant.metrics.clicks / variant.metrics.impressions
          : 0;
      case "conversion_rate":
        return variant.metrics.clicks > 0
          ? variant.metrics.conversions / variant.metrics.clicks
          : 0;
      case "roas":
        return variant.metrics.spend > 0
          ? (variant.metrics.conversions * 100) / variant.metrics.spend // simplified
          : 0;
      default:
        return 0;
    }
  }

  /**
   * Approximate normal CDF using the rational approximation by Abramowitz and Stegun.
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x) / Math.SQRT2;
    const t = 1.0 / (1.0 + p * absX);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

    return 0.5 * (1.0 + sign * y);
  }
}
