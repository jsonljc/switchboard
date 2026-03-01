import { describe, it, expect } from "vitest";
import { budgetPacingAdvisor } from "../budget-pacing.js";
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
    spend: 700, // 7 days × $100/day = full delivery
    conversions: 10,
    daysSinceLastEdit: null,
    inLearningPhase: false,
    dailyBudget: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("budgetPacingAdvisor", () => {
  const snapshot = makeSnapshot();

  it("returns no findings when no sub-entities", () => {
    const findings = budgetPacingAdvisor([], [], snapshot, snapshot, undefined);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when entities have no daily budget", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", dailyBudget: null }),
      makeEntity({ entityId: "adset_2", dailyBudget: null }),
    ];
    const context: DiagnosticContext = { subEntities: entities };
    const findings = budgetPacingAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings when delivery is within normal range", () => {
    // $700 spend / 7 days = $100/day, daily budget = $120 → 83% utilization
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 700, dailyBudget: 120 }),
      makeEntity({ entityId: "adset_2", spend: 560, dailyBudget: 100 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };
    const findings = budgetPacingAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });

  it("detects under-delivery when spend < 70% of budget", () => {
    // $280 spend / 7 = $40/day, budget $100 → 40% utilization
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 280, dailyBudget: 100 }),
      makeEntity({ entityId: "adset_2", spend: 700, dailyBudget: 100 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };
    const findings = budgetPacingAdvisor([], [], snapshot, snapshot, context);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const underDelivery = findings.find((f) => f.message.includes("Under-delivery"));
    expect(underDelivery).toBeDefined();
  });

  it("detects budget-capped delivery when spend > 95% of budget", () => {
    // $700 spend / 7 = $100/day, budget $100 → 100% utilization
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 700, dailyBudget: 100 }),
      makeEntity({ entityId: "adset_2", spend: 690, dailyBudget: 100 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };
    const findings = budgetPacingAdvisor([], [], snapshot, snapshot, context);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const capped = findings.find((f) => f.message.includes("Budget-capped"));
    expect(capped).toBeDefined();
  });

  it("ignores entities with zero budget", () => {
    const entities = [
      makeEntity({ entityId: "adset_1", spend: 700, dailyBudget: 0 }),
    ];
    const context: DiagnosticContext = { subEntities: entities };
    const findings = budgetPacingAdvisor([], [], snapshot, snapshot, context);
    expect(findings).toHaveLength(0);
  });
});
