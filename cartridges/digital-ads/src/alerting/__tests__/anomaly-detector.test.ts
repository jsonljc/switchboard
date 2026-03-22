import { describe, it, expect } from "vitest";
import { AnomalyDetector } from "../anomaly-detector.js";
import type { DailyMetrics } from "../anomaly-detector.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDailyMetrics(overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    date: "2024-01-01",
    spend: 100,
    impressions: 10000,
    clicks: 500,
    conversions: 25,
    ctr: 5.0,
    cpm: 10.0,
    cpa: 4.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnomalyDetector", () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  // -------------------------------------------------------------------------
  // Minimum data requirements
  // -------------------------------------------------------------------------

  describe("minimum data requirements", () => {
    it("returns empty array when fewer than 3 data points", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 110 }),
      ];

      const result = detector.scan(metrics);

      expect(result).toEqual([]);
    });

    it("processes exactly 3 data points", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 100 }),
      ];

      const result = detector.scan(metrics);

      // Should process without error (no anomalies expected for uniform data)
      expect(Array.isArray(result)).toBe(true);
    });

    it("processes many data points", () => {
      const metrics = Array.from({ length: 30 }, (_, i) =>
        makeDailyMetrics({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, spend: 100 }),
      );

      const result = detector.scan(metrics);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Z-score anomaly detection
  // -------------------------------------------------------------------------

  describe("z-score anomaly detection", () => {
    it("detects critical anomaly (z-score > 3)", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 105 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 95 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 102 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 98 }),
        makeDailyMetrics({ date: "2024-01-06", spend: 500 }), // Much higher than mean
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const spendAnomaly = result.find((r) => r.metric === "spend");
      expect(spendAnomaly).toBeDefined();
      expect(spendAnomaly!.severity).toBe("critical");
      expect(Math.abs(spendAnomaly!.zScore)).toBeGreaterThan(3);
    });

    it("detects warning anomaly (2 < z-score < 3)", () => {
      // mean=100, stdDev≈3.39 → need value between ~107 and ~110 for 2<z<3
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 105 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 95 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 102 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 98 }),
        makeDailyMetrics({ date: "2024-01-06", spend: 109 }), // z ≈ 2.65
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const spendAnomaly = result.find((r) => r.metric === "spend");
      expect(spendAnomaly).toBeDefined();
      expect(spendAnomaly!.severity).toBe("warning");
    });

    it("does not flag values within 2 standard deviations", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-06", spend: 100 }),
      ];

      const result = detector.scan(metrics);

      // Should not detect any anomalies for uniform data
      expect(result).toEqual([]);
    });

    it("detects negative anomaly (below mean)", () => {
      // Need varied historical data so stdDev > 0
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 105 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 95 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 102 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 98 }),
        makeDailyMetrics({ date: "2024-01-06", spend: 50 }), // Well below mean
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const spendAnomaly = result.find((r) => r.metric === "spend");
      expect(spendAnomaly).toBeDefined();
      expect(spendAnomaly!.zScore).toBeLessThan(0);
      expect(spendAnomaly!.message).toContain("below");
    });
  });

  // -------------------------------------------------------------------------
  // Multiple metric detection
  // -------------------------------------------------------------------------

  describe("multiple metric detection", () => {
    it("detects anomalies across multiple metrics", () => {
      // Need varied historical data so stdDev > 0 for both metrics
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100, ctr: 5.0 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 105, ctr: 5.2 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 95, ctr: 4.8 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 102, ctr: 5.1 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 98, ctr: 4.9 }),
        makeDailyMetrics({ date: "2024-01-06", spend: 500, ctr: 15.0 }), // Both anomalous
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.find((r) => r.metric === "spend")).toBeDefined();
      expect(result.find((r) => r.metric === "ctr")).toBeDefined();
    });

    it("checks all supported metrics", () => {
      const metrics = Array.from({ length: 5 }, (_, i) =>
        makeDailyMetrics({
          date: `2024-01-0${i + 1}`,
          spend: 100,
          impressions: 10000,
          clicks: 500,
          conversions: 25,
          ctr: 5.0,
          cpm: 10.0,
          cpa: 4.0,
        }),
      );

      const result = detector.scan(metrics);

      // No anomalies for uniform data
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Null and undefined handling
  // -------------------------------------------------------------------------

  describe("null and undefined handling", () => {
    it("skips metrics with null values in historical data", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", cpa: null }),
        makeDailyMetrics({ date: "2024-01-02", cpa: null }),
        makeDailyMetrics({ date: "2024-01-03", cpa: null }),
        makeDailyMetrics({ date: "2024-01-04", cpa: 4.0 }),
      ];

      const result = detector.scan(metrics);

      // Should not detect CPA anomaly (insufficient historical data)
      const cpaAnomaly = result.find((r) => r.metric === "cpa");
      expect(cpaAnomaly).toBeUndefined();
    });

    it("skips current value if null", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", cpa: 4.0 }),
        makeDailyMetrics({ date: "2024-01-02", cpa: 4.0 }),
        makeDailyMetrics({ date: "2024-01-03", cpa: 4.0 }),
        makeDailyMetrics({ date: "2024-01-04", cpa: null }),
      ];

      const result = detector.scan(metrics);

      const cpaAnomaly = result.find((r) => r.metric === "cpa");
      expect(cpaAnomaly).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // IQR-based detection
  // -------------------------------------------------------------------------

  describe("IQR-based detection", () => {
    it("detects extreme outliers using IQR (3*IQR)", () => {
      // Need varied data so IQR > 0
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 90 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 95 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 105 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 110 }),
        makeDailyMetrics({ date: "2024-01-06", spend: 1000 }), // Extreme outlier
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const spendAnomaly = result.find((r) => r.metric === "spend");
      expect(spendAnomaly).toBeDefined();
      expect(spendAnomaly!.severity).toBe("critical");
    });

    it("handles zero IQR (all values identical)", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 100 }),
      ];

      const result = detector.scan(metrics);

      // No anomalies for uniform data
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Result format
  // -------------------------------------------------------------------------

  describe("result format", () => {
    it("includes all required fields in anomaly result", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 110 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 105 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 95 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 500 }),
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const anomaly = result[0]!;
      expect(anomaly).toHaveProperty("metric");
      expect(anomaly).toHaveProperty("currentValue");
      expect(anomaly).toHaveProperty("historicalMean");
      expect(anomaly).toHaveProperty("historicalStdDev");
      expect(anomaly).toHaveProperty("zScore");
      expect(anomaly).toHaveProperty("severity");
      expect(anomaly).toHaveProperty("message");
    });

    it("rounds numerical values appropriately", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100.123 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 110.456 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 105.789 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 95.111 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 500.999 }),
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const anomaly = result[0]!;
      // Mean and stdDev should be rounded to 2 decimals
      expect(Number.isInteger(anomaly.historicalMean * 100)).toBe(true);
      expect(Number.isInteger(anomaly.historicalStdDev * 100)).toBe(true);
      // Z-score should be rounded to 2 decimals
      expect(Number.isInteger(anomaly.zScore * 100)).toBe(true);
    });

    it("includes descriptive message", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 110 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 105 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 95 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 500 }),
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const anomaly = result[0]!;
      expect(anomaly.message).toContain("spend");
      expect(anomaly.message).toContain("standard deviations");
      expect(anomaly.message).toContain("mean");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles zero standard deviation gracefully", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 100 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 100 }),
      ];

      const result = detector.scan(metrics);

      // Z-score should be 0, no anomaly detected
      expect(result).toEqual([]);
    });

    it("handles negative values", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: -100 }),
        makeDailyMetrics({ date: "2024-01-02", spend: -110 }),
        makeDailyMetrics({ date: "2024-01-03", spend: -95 }),
        makeDailyMetrics({ date: "2024-01-04", spend: -105 }),
        makeDailyMetrics({ date: "2024-01-05", spend: -500 }),
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const spendAnomaly = result.find((r) => r.metric === "spend");
      expect(spendAnomaly).toBeDefined();
    });

    it("handles very large values", () => {
      const metrics = [
        makeDailyMetrics({ date: "2024-01-01", spend: 1000000 }),
        makeDailyMetrics({ date: "2024-01-02", spend: 1100000 }),
        makeDailyMetrics({ date: "2024-01-03", spend: 1050000 }),
        makeDailyMetrics({ date: "2024-01-04", spend: 950000 }),
        makeDailyMetrics({ date: "2024-01-05", spend: 5000000 }),
      ];

      const result = detector.scan(metrics);

      expect(result.length).toBeGreaterThan(0);
      const spendAnomaly = result.find((r) => r.metric === "spend");
      expect(spendAnomaly).toBeDefined();
      expect(spendAnomaly!.severity).toBe("critical");
    });
  });
});
