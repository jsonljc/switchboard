import { describe, it, expect } from "vitest";
import {
  analyzeHeadroom,
  cleanData,
  computeTimeWeights,
  fitLogModel,
  fitPowerModel,
  predictConversions,
  classifyConfidence,
  type DailyDataPoint,
  type HeadroomModelConfig,
} from "../headroom.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate synthetic daily data following y = a * ln(x) + b pattern
 * with optional noise. This produces data where the model should fit well.
 */
function generateLogData(
  days: number,
  baseSpend: number,
  a: number,
  b: number,
  noisePercent: number = 5,
): DailyDataPoint[] {
  const data: DailyDataPoint[] = [];
  const startDate = new Date("2024-01-01");

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    // Vary spend by ±30% for good CV
    const spendVariation = 0.7 + (i % 7) * 0.1;
    const spend = baseSpend * spendVariation;

    const idealConversions = a * Math.log(spend) + b;
    const noise = 1 + (((i * 13 + 7) % 20) - 10) * (noisePercent / 1000);
    const conversions = Math.max(0, Math.round(idealConversions * noise));

    data.push({
      date: date.toISOString().slice(0, 10),
      spend,
      conversions,
      revenue: conversions * 50, // $50 AOV
      ctr: 2.0 + (i % 5) * 0.1,
    });
  }

  return data;
}

/**
 * Generate synthetic data following y = a * x^b (power-law) pattern.
 */
function generatePowerData(
  days: number,
  baseSpend: number,
  a: number,
  b: number,
): DailyDataPoint[] {
  const data: DailyDataPoint[] = [];
  const startDate = new Date("2024-01-01");

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    const spendVariation = 0.7 + (i % 7) * 0.1;
    const spend = baseSpend * spendVariation;

    const idealConversions = a * Math.pow(spend, b);
    const noise = 1 + (((i * 7 + 3) % 10) - 5) / 100;
    const conversions = Math.max(0, Math.round(idealConversions * noise));

    data.push({
      date: date.toISOString().slice(0, 10),
      spend,
      conversions,
      revenue: conversions * 50,
      ctr: 2.0,
    });
  }

  return data;
}

// ---------------------------------------------------------------------------
// Tests — Data Cleaning
// ---------------------------------------------------------------------------

describe("cleanData", () => {
  it("removes zero-spend days", () => {
    const data: DailyDataPoint[] = [
      { date: "2024-01-01", spend: 100, conversions: 10, revenue: 500, ctr: 2.0 },
      { date: "2024-01-02", spend: 0, conversions: 0, revenue: 0, ctr: 0 },
      { date: "2024-01-03", spend: 120, conversions: 12, revenue: 600, ctr: 2.1 },
    ];
    const { cleaned, gapDays } = cleanData(data);
    expect(cleaned).toHaveLength(2);
    expect(gapDays).toBe(1);
  });

  it("removes IQR outliers", () => {
    const data: DailyDataPoint[] = [];
    for (let i = 0; i < 20; i++) {
      data.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        spend: 100 + (i % 5) * 10,
        conversions: 10,
        revenue: 500,
        ctr: 2.0,
      });
    }
    // Add extreme outlier
    data.push({
      date: "2024-01-21",
      spend: 10000,
      conversions: 100,
      revenue: 5000,
      ctr: 2.0,
    });

    const { cleaned, outliersRemoved } = cleanData(data);
    expect(outliersRemoved).toBeGreaterThan(0);
    expect(cleaned.length).toBeLessThan(data.length);
  });

  it("handles empty input", () => {
    const { cleaned, gapDays } = cleanData([]);
    expect(cleaned).toHaveLength(0);
    expect(gapDays).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Time Weighting
// ---------------------------------------------------------------------------

describe("computeTimeWeights", () => {
  it("assigns higher weights to recent days", () => {
    const data: DailyDataPoint[] = [
      { date: "2024-01-01", spend: 100, conversions: 10, revenue: 500, ctr: 2.0 },
      { date: "2024-01-15", spend: 100, conversions: 10, revenue: 500, ctr: 2.0 },
      { date: "2024-01-30", spend: 100, conversions: 10, revenue: 500, ctr: 2.0 },
    ];

    const weights = computeTimeWeights(data, 14);

    // Most recent day should have the highest weight
    expect(weights[2]).toBeGreaterThan(weights[1]!);
    expect(weights[1]).toBeGreaterThan(weights[0]!);
  });

  it("normalizes weights to sum to N", () => {
    const data = generateLogData(30, 500, 5, 10);
    const weights = computeTimeWeights(data, 14);

    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(30, 0);
  });

  it("returns empty array for empty data", () => {
    expect(computeTimeWeights([], 14)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — Regression Models
// ---------------------------------------------------------------------------

describe("fitLogModel", () => {
  it("produces positive R² for logarithmic data", () => {
    const data = generateLogData(30, 500, 5, 10);
    const x = data.map((d) => d.spend);
    const y = data.map((d) => d.conversions);
    const weights = new Array(data.length).fill(1);

    const result = fitLogModel(x, y, weights);

    expect(result.modelType).toBe("logarithmic");
    expect(result.rSquared).toBeGreaterThan(0.3);
    expect(result.coefficients[0]).not.toBe(0);
  });

  it("returns zero R² for constant data", () => {
    const x = [100, 200, 300, 400, 500];
    const y = [10, 10, 10, 10, 10]; // No relationship
    const weights = [1, 1, 1, 1, 1];

    const result = fitLogModel(x, y, weights);
    // With constant y, R² should be very low
    expect(result.rSquared).toBeLessThan(0.01);
  });
});

describe("fitPowerModel", () => {
  it("produces positive R² and elasticity for power-law data", () => {
    const data = generatePowerData(30, 500, 0.1, 0.8);
    const x = data.map((d) => d.spend);
    const y = data.map((d) => d.conversions);
    const weights = new Array(data.length).fill(1);

    const result = fitPowerModel(x, y, weights);

    expect(result.modelType).toBe("power-law");
    expect(result.rSquared).toBeGreaterThan(0);
    expect(result.elasticity).not.toBeNull();
  });

  it("returns zero R² when insufficient valid data", () => {
    const x = [100, 200, 300];
    const y = [0, 0, 0]; // All zeros can't be log-transformed
    const weights = [1, 1, 1];

    const result = fitPowerModel(x, y, weights);
    expect(result.rSquared).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — Prediction
// ---------------------------------------------------------------------------

describe("predictConversions", () => {
  it("predicts using logarithmic model", () => {
    const model = {
      modelType: "logarithmic" as const,
      coefficients: [10, -20] as [number, number],
      rSquared: 0.8,
      elasticity: null,
    };

    const result = predictConversions(model, 100);
    // y = 10 * ln(100) - 20 = 10 * 4.605 - 20 = 26.05
    expect(result).toBeCloseTo(26.05, 0);
  });

  it("predicts using power-law model", () => {
    const model = {
      modelType: "power-law" as const,
      coefficients: [0.5, 0.7] as [number, number],
      rSquared: 0.8,
      elasticity: 0.7,
    };

    const result = predictConversions(model, 1000);
    // y = 0.5 * 1000^0.7
    const expected = 0.5 * Math.pow(1000, 0.7);
    expect(result).toBeCloseTo(expected, 0);
  });

  it("returns 0 for zero spend", () => {
    const model = {
      modelType: "logarithmic" as const,
      coefficients: [10, 5] as [number, number],
      rSquared: 0.8,
      elasticity: null,
    };
    expect(predictConversions(model, 0)).toBe(0);
  });

  it("clamps negative predictions to 0", () => {
    const model = {
      modelType: "logarithmic" as const,
      coefficients: [10, -100] as [number, number], // Large negative intercept
      rSquared: 0.8,
      elasticity: null,
    };
    expect(predictConversions(model, 1)).toBe(0); // 10*ln(1) - 100 = -100 → 0
  });
});

// ---------------------------------------------------------------------------
// Tests — Confidence Classification
// ---------------------------------------------------------------------------

describe("classifyConfidence", () => {
  it("classifies high confidence for R² ≥ 0.65", () => {
    expect(classifyConfidence(0.65)).toBe("high");
    expect(classifyConfidence(0.9)).toBe("high");
  });

  it("classifies medium confidence for 0.5 ≤ R² < 0.65", () => {
    expect(classifyConfidence(0.5)).toBe("medium");
    expect(classifyConfidence(0.6)).toBe("medium");
  });

  it("classifies low confidence for R² < 0.5", () => {
    expect(classifyConfidence(0.49)).toBe("low");
    expect(classifyConfidence(0.1)).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Tests — Full Headroom Analysis
// ---------------------------------------------------------------------------

describe("analyzeHeadroom", () => {
  it("returns null for insufficient data (< 21 days)", () => {
    const data = generateLogData(15, 500, 5, 10);
    const result = analyzeHeadroom(data);
    expect(result).toBeNull();
  });

  it("produces a result with 30 days of log data", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    expect(result!.selectedModel.rSquared).toBeGreaterThan(0);
    expect(result!.estimate.currentDailySpend).toBeGreaterThan(0);
    expect(result!.estimate.headroomPercent).toBeGreaterThanOrEqual(0);
    expect(result!.dataQuality.cleanPointCount).toBeGreaterThanOrEqual(21);
  });

  it("selects the model with higher R²", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    expect(result!.selectedModel.rSquared).toBeGreaterThanOrEqual(
      result!.alternativeModel.rSquared,
    );
  });

  it("produces confidence bands", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    expect(result!.confidenceBand.lowerPercent).toBeDefined();
    expect(result!.confidenceBand.upperPercent).toBeDefined();
    expect(result!.confidenceBand.upperPercent).toBeGreaterThanOrEqual(
      result!.confidenceBand.lowerPercent,
    );
  });

  it("respects CPA target when set", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const config: HeadroomModelConfig = { targetCPA: 30 };
    const result = analyzeHeadroom(data, config);

    expect(result).not.toBeNull();
    // With a target CPA, headroom should be bounded
    expect(result!.estimate.headroomPercent).toBeGreaterThanOrEqual(0);
    expect(result!.estimate.headroomPercent).toBeLessThanOrEqual(100); // Safety cap
  });

  it("respects ROAS target when set", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const config: HeadroomModelConfig = { targetROAS: 2.0 };
    const result = analyzeHeadroom(data, config);

    expect(result).not.toBeNull();
    expect(result!.estimate.headroomPercent).toBeGreaterThanOrEqual(0);
  });

  it("flags low variability in data quality", () => {
    // Create data with very low spend variance
    const data: DailyDataPoint[] = [];
    for (let i = 0; i < 30; i++) {
      data.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        spend: 500 + (i % 3), // CV < 0.01
        conversions: 50 + (i % 5),
        revenue: 2500,
        ctr: 2.0,
      });
    }
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    expect(result!.dataQuality.lowVariability).toBe(true);
    expect(result!.caveats.some((c) => c.includes("variability"))).toBe(true);
  });

  it("caps headroom at safety cap (2x default)", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    // Max headroom should be 100% (2x = 100% increase)
    expect(result!.estimate.headroomPercent).toBeLessThanOrEqual(100);
  });

  it("detects seasonal boundary when data spans known events", () => {
    // Data spanning Black Friday
    const data: DailyDataPoint[] = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date("2024-11-10");
      date.setDate(date.getDate() + i);
      data.push({
        date: date.toISOString().slice(0, 10),
        spend: 500 + i * 20,
        conversions: 50 + i * 2,
        revenue: 2500 + i * 100,
        ctr: 2.0,
      });
    }
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    expect(result!.dataQuality.seasonalBoundary).toBe(true);
    expect(result!.caveats.some((c) => c.includes("seasonal"))).toBe(true);
  });

  it("generates caveats for low confidence", () => {
    // Random/noisy data should produce low R²
    const data: DailyDataPoint[] = [];
    for (let i = 0; i < 30; i++) {
      data.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        spend: 100 + ((i * 137) % 900),
        conversions: 5 + ((i * 73) % 50),
        revenue: 250 + ((i * 73) % 50) * 50,
        ctr: 2.0,
      });
    }
    const result = analyzeHeadroom(data);

    if (result && result.confidence === "low") {
      expect(result.caveats.some((c) => c.includes("Low model confidence"))).toBe(true);
    }
  });

  it("includes elasticity in power-law model", () => {
    const data = generatePowerData(30, 500, 0.1, 0.8);
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    // At least one model should have elasticity
    const hasElasticity =
      result!.selectedModel.elasticity !== null || result!.alternativeModel.elasticity !== null;
    expect(hasElasticity).toBe(true);
  });

  it("provides multi-goal output (CPA + ROAS + volume)", () => {
    const data = generateLogData(30, 500, 5, 10, 3);
    const result = analyzeHeadroom(data);

    expect(result).not.toBeNull();
    expect(result!.estimate.predictedConversions).toBeGreaterThan(0);
    // With revenue data, ROAS should be computed
    expect(result!.estimate.predictedROAS).not.toBeNull();
  });
});
