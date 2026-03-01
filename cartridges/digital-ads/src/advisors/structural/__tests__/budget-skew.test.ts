import { describe, it, expect } from "vitest";
import { budgetSkewAdvisor } from "../budget-skew.js";
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
    conversions: 10,
    daysSinceLastEdit: null,
    inLearningPhase: false,
    dailyBudget: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("budgetSkewAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no sub-entities", () => {
    const findings = budgetSkewAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when spend is evenly distributed", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 250 }),
      makeEntity({ entityId: "adset_2", spend: 250 }),
      makeEntity({ entityId: "adset_3", spend: 250 }),
      makeEntity({ entityId: "adset_4", spend: 250 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = budgetSkewAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("detects warning when one ad set has >60% of spend", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 700 }),
      makeEntity({ entityId: "adset_2", spend: 200 }),
      makeEntity({ entityId: "adset_3", spend: 100 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = budgetSkewAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("70.0%");
    expect(findings[0].message).toContain("adset_1");
  });

  it("flags critical when one ad set has >80% of spend", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 900 }),
      makeEntity({ entityId: "adset_2", spend: 100 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = budgetSkewAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("90.0%");
  });

  it("returns no findings when only one active ad set", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 1000 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = budgetSkewAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0); // Single ad set is not a skew issue
  });

  it("ignores ad sets with zero spend", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 500 }),
      makeEntity({ entityId: "adset_2", spend: 500 }),
      makeEntity({ entityId: "adset_3", spend: 0 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = budgetSkewAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0); // 50/50 split
  });
});
