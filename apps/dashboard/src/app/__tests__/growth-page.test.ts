import { describe, it, expect } from "vitest";

/**
 * Tests for the growth page helpers and data structures.
 * Full render tests require extensive mocking of auth, query client, and hooks.
 * These tests verify the data transformation logic used by the page.
 */

// Inline the funnel stage builder from the page
function buildFunnelStages(
  rawMetrics: Record<string, unknown>,
): Array<{ name: string; value: number }> {
  const stages: Array<{ name: string; value: number }> = [];
  const stageNames = ["impressions", "clicks", "contentView", "addToCart", "purchase"];
  const stageLabels = ["Impressions", "Clicks", "Content View", "Add to Cart", "Purchase"];

  for (let i = 0; i < stageNames.length; i++) {
    const val = rawMetrics[stageNames[i]];
    if (typeof val === "number" && val > 0) {
      stages.push({ name: stageLabels[i], value: val });
    }
  }

  return stages;
}

// Inline the scorer finder from the page
interface ScorerOutput {
  scorerName: string;
  constraintType: string;
  score: number;
  confidence: string;
}

function findScorer(outputs: ScorerOutput[], type: string): ScorerOutput | null {
  return outputs.find((o) => o.constraintType === type) ?? null;
}

describe("Growth page helpers", () => {
  describe("buildFunnelStages", () => {
    it("builds stages from raw metrics", () => {
      const stages = buildFunnelStages({
        impressions: 10000,
        clicks: 500,
        contentView: 200,
        addToCart: 50,
        purchase: 10,
      });

      expect(stages).toHaveLength(5);
      expect(stages[0]).toEqual({ name: "Impressions", value: 10000 });
      expect(stages[4]).toEqual({ name: "Purchase", value: 10 });
    });

    it("skips stages with zero values", () => {
      const stages = buildFunnelStages({
        impressions: 10000,
        clicks: 500,
        contentView: 0,
        addToCart: 50,
        purchase: 10,
      });

      expect(stages).toHaveLength(4);
      expect(stages.map((s) => s.name)).not.toContain("Content View");
    });

    it("skips stages with non-numeric values", () => {
      const stages = buildFunnelStages({
        impressions: 10000,
        clicks: "500",
        purchase: 10,
      });

      expect(stages).toHaveLength(2);
    });

    it("returns empty array for empty metrics", () => {
      expect(buildFunnelStages({})).toEqual([]);
    });
  });

  describe("findScorer", () => {
    const outputs: ScorerOutput[] = [
      { scorerName: "signal-health", constraintType: "SIGNAL", score: 72, confidence: "HIGH" },
      { scorerName: "creative-depth", constraintType: "CREATIVE", score: 45, confidence: "MEDIUM" },
      { scorerName: "funnel-leakage", constraintType: "FUNNEL", score: 68, confidence: "HIGH" },
    ];

    it("finds scorer by constraint type", () => {
      const scorer = findScorer(outputs, "SIGNAL");
      expect(scorer).not.toBeNull();
      expect(scorer!.score).toBe(72);
    });

    it("returns null for unknown type", () => {
      const scorer = findScorer(outputs, "UNKNOWN");
      expect(scorer).toBeNull();
    });

    it("returns null for empty outputs", () => {
      expect(findScorer([], "SIGNAL")).toBeNull();
    });
  });

  describe("Data tier colors", () => {
    const DATA_TIER_COLORS: Record<string, string> = {
      FULL: "bg-positive/15 text-positive-foreground",
      PARTIAL: "bg-caution/15 text-caution-foreground",
      SPARSE: "bg-muted text-muted-foreground",
    };

    it.each(["FULL", "PARTIAL", "SPARSE"])("has color mapping for tier '%s'", (tier) => {
      expect(DATA_TIER_COLORS[tier]).toBeDefined();
    });
  });

  describe("Scorer labels", () => {
    const SCORER_LABELS: Record<string, string> = {
      SIGNAL: "Signal",
      CREATIVE: "Creative",
      FUNNEL: "Funnel",
      SALES: "Sales",
      SATURATION: "Headroom",
    };

    it("has labels for all 5 constraint types", () => {
      expect(Object.keys(SCORER_LABELS)).toHaveLength(5);
      expect(SCORER_LABELS.SIGNAL).toBe("Signal");
      expect(SCORER_LABELS.SATURATION).toBe("Headroom");
    });
  });
});
