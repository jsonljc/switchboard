import { describe, it, expect } from "vitest";
import { attributionAwarenessAdvisor } from "../attribution-awareness.js";
import type {
  MetricSnapshot,
  StageDiagnostic,
  DiagnosticContext,
} from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: {},
    ...overrides,
  };
}

function makeStage(overrides: Partial<StageDiagnostic> = {}): StageDiagnostic {
  return {
    stageName: "awareness",
    metric: "impressions",
    currentValue: 10000,
    previousValue: 10000,
    delta: 0,
    deltaPercent: 0,
    isSignificant: false,
    severity: "healthy",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attributionAwarenessAdvisor", () => {
  it("returns no findings when no attribution data is available and no heuristic pattern", () => {
    const stages = [
      makeStage({ stageName: "awareness", metric: "impressions" }),
      makeStage({ stageName: "clicks", metric: "clicks" }),
      makeStage({ stageName: "purchase", metric: "purchase" }),
    ];
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = attributionAwarenessAdvisor(stages, [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags explicit attribution window change with large stage changes", () => {
    const stages = [
      makeStage({ deltaPercent: -50, isSignificant: true }),
    ];
    const context: DiagnosticContext = {
      attributionWindow: 7,
      previousAttributionWindow: 28,
    };
    const findings = attributionAwarenessAdvisor(
      stages, [], makeSnapshot(), makeSnapshot(), context
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("28-day to 7-day");
    expect(findings[0].message).toContain("narrowed");
  });

  it("flags explicit window change as warning when no large stage changes", () => {
    const stages = [
      makeStage({ deltaPercent: 5, isSignificant: false }),
    ];
    const context: DiagnosticContext = {
      attributionWindow: 28,
      previousAttributionWindow: 7,
    };
    const findings = attributionAwarenessAdvisor(
      stages, [], makeSnapshot(), makeSnapshot(), context
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("widened");
  });

  it("does not flag when attribution windows match", () => {
    const context: DiagnosticContext = {
      attributionWindow: 7,
      previousAttributionWindow: 7,
    };
    const findings = attributionAwarenessAdvisor(
      [], [], makeSnapshot(), makeSnapshot(), context
    );
    expect(findings).toHaveLength(0);
  });

  it("detects heuristic attribution change: stable top funnel, large bottom shift", () => {
    const stages = [
      makeStage({ stageName: "awareness", metric: "impressions", deltaPercent: 5 }),
      makeStage({ stageName: "clicks", metric: "clicks", deltaPercent: 8 }),
      makeStage({ stageName: "atc", metric: "add_to_cart", deltaPercent: -55 }),
      makeStage({ stageName: "purchase", metric: "purchase", deltaPercent: -60 }),
    ];
    const current = makeSnapshot({ spend: 1000 });
    const previous = makeSnapshot({ spend: 1050 }); // Spend stable

    const findings = attributionAwarenessAdvisor(stages, [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Possible attribution window change");
    expect(findings[0].message).toContain("decreased");
  });

  it("does not flag heuristic when spend also shifted significantly", () => {
    const stages = [
      makeStage({ stageName: "awareness", metric: "impressions", deltaPercent: 5 }),
      makeStage({ stageName: "clicks", metric: "clicks", deltaPercent: 8 }),
      makeStage({ stageName: "purchase", metric: "purchase", deltaPercent: -55 }),
      makeStage({ stageName: "purchase2", metric: "lead", deltaPercent: -50 }),
    ];
    // Spend dropped 40% — this could be a real performance issue
    const current = makeSnapshot({ spend: 600 });
    const previous = makeSnapshot({ spend: 1000 });

    const findings = attributionAwarenessAdvisor(stages, [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("does not flag heuristic when conversion stages move in different directions", () => {
    const stages = [
      makeStage({ stageName: "awareness", metric: "impressions", deltaPercent: 5 }),
      makeStage({ stageName: "clicks", metric: "clicks", deltaPercent: 8 }),
      makeStage({ stageName: "atc", metric: "add_to_cart", deltaPercent: -55 }),
      makeStage({ stageName: "purchase", metric: "purchase", deltaPercent: 30 }), // Different direction
    ];
    const current = makeSnapshot({ spend: 1000 });
    const previous = makeSnapshot({ spend: 1050 });

    const findings = attributionAwarenessAdvisor(stages, [], current, previous);
    expect(findings).toHaveLength(0);
  });
});
