import { describe, it, expect } from "vitest";
import { learningInstabilityAdvisor } from "../learning-instability.js";
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

describe("learningInstabilityAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no sub-entities", () => {
    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when no ad sets are in learning phase", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 500, inLearningPhase: false }),
      makeEntity({ entityId: "adset_2", spend: 500, inLearningPhase: false }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when learning phase but not recently edited", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 500, inLearningPhase: true, daysSinceLastEdit: 10 }),
      makeEntity({ entityId: "adset_2", spend: 500, inLearningPhase: false }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when daysSinceLastEdit is null (e.g., Google)", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 500, inLearningPhase: true, daysSinceLastEdit: null }),
      makeEntity({ entityId: "adset_2", spend: 500, inLearningPhase: false }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("detects warning when >30% spend in unstable ad sets", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 400, inLearningPhase: true, daysSinceLastEdit: 2 }),
      makeEntity({ entityId: "adset_2", spend: 300, inLearningPhase: false }),
      makeEntity({ entityId: "adset_3", spend: 300, inLearningPhase: false }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].stage).toBe("account_structure");
    expect(findings[0].message).toContain("40.0%");
    expect(findings[0].message).toContain("1 ad set");
  });

  it("flags critical when >60% spend in unstable ad sets", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 400, inLearningPhase: true, daysSinceLastEdit: 1 }),
      makeEntity({ entityId: "adset_2", spend: 400, inLearningPhase: true, daysSinceLastEdit: 2 }),
      makeEntity({ entityId: "adset_3", spend: 200, inLearningPhase: false }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("80.0%");
  });

  it("does not trigger when unstable spend is <= 30%", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 200, inLearningPhase: true, daysSinceLastEdit: 1 }),
      makeEntity({ entityId: "adset_2", spend: 400, inLearningPhase: false }),
      makeEntity({ entityId: "adset_3", spend: 400, inLearningPhase: false }),
    ];
    const context: DiagnosticContext = { subEntities: entities };

    const findings = learningInstabilityAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0); // 20% < 30% threshold
  });
});
