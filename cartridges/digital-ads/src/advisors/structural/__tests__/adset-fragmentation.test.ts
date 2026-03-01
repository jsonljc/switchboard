import { describe, it, expect } from "vitest";
import { adsetFragmentationAdvisor } from "../adset-fragmentation.js";
import type { MetricSnapshot, DiagnosticContext, SubEntityBreakdown } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
  };
}

function makeEntity(overrides: Partial<SubEntityBreakdown> = {}): SubEntityBreakdown {
  return {
    entityId: "adset_1",
    entityLevel: "adset",
    spend: 100,
    conversions: 3,
    daysSinceLastEdit: null,
    inLearningPhase: false,
    dailyBudget: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adsetFragmentationAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no sub-entities", () => {
    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when <= 10 active ad sets", () => {
    const entities = Array.from({ length: 10 }, (_, i) =>
      makeEntity({ entityId: `adset_${i}`, conversions: 3 })
    );
    const context: DiagnosticContext = { subEntities: entities };

    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("detects fragmentation when >10 ad sets with low conversions", () => {
    const entities = Array.from({ length: 15 }, (_, i) =>
      makeEntity({ entityId: `adset_${i}`, conversions: 3, spend: 50 })
    );
    const context: DiagnosticContext = { subEntities: entities };

    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].stage).toBe("account_structure");
    expect(findings[0].message).toContain("15 active ad sets");
    expect(findings[0].message).toContain("3.0 conversions each");
  });

  it("flags critical when avg conversions < 2", () => {
    const entities = Array.from({ length: 20 }, (_, i) =>
      makeEntity({ entityId: `adset_${i}`, conversions: 1, spend: 50 })
    );
    const context: DiagnosticContext = { subEntities: entities };

    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("does not trigger when conversions are adequate", () => {
    const entities = Array.from({ length: 15 }, (_, i) =>
      makeEntity({ entityId: `adset_${i}`, conversions: 10, spend: 100 })
    );
    const context: DiagnosticContext = { subEntities: entities };

    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("excludes ad sets with zero spend", () => {
    const entities = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeEntity({ entityId: `active_${i}`, conversions: 10, spend: 100 })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        makeEntity({ entityId: `inactive_${i}`, conversions: 0, spend: 0 })
      ),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0); // Only 5 active, <= 10
  });

  it("recommends correct consolidation count", () => {
    // 12 ad sets * 3 conversions = 36 total, target = ceil(36/50) = 1
    const entities = Array.from({ length: 12 }, (_, i) =>
      makeEntity({ entityId: `adset_${i}`, conversions: 3, spend: 50 })
    );
    const context: DiagnosticContext = { subEntities: entities };

    const findings = adsetFragmentationAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].recommendation).toContain("1 ad set");
  });
});
