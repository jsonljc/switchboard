import { describe, it, expect } from "vitest";
import { frequencyManagementAdvisor } from "../frequency-management.js";
import type { MetricSnapshot } from "../../../../core/types.js";

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("frequencyManagementAdvisor", () => {
  it("returns no findings when no frequency data", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = frequencyManagementAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("flags critical when frequency > 7", () => {
    const current = makeSnapshot({ topLevel: { frequency: 8.5 } });
    const previous = makeSnapshot({ topLevel: { frequency: 6.0 } });
    const findings = frequencyManagementAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("8.5");
  });

  it("flags warning when frequency is 4-7", () => {
    const current = makeSnapshot({ topLevel: { frequency: 5.5 } });
    const previous = makeSnapshot({ topLevel: { frequency: 4.0 } });
    const findings = frequencyManagementAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("flags info when frequency is too low (<1.5)", () => {
    const current = makeSnapshot({ topLevel: { frequency: 1.2 } });
    const previous = makeSnapshot({ topLevel: { frequency: 1.0 } });
    const findings = frequencyManagementAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("low");
  });

  it("reports healthy when frequency is in optimal range (1.5-4)", () => {
    const current = makeSnapshot({ topLevel: { frequency: 2.5 } });
    const previous = makeSnapshot({ topLevel: { frequency: 2.0 } });
    const findings = frequencyManagementAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("healthy");
  });

  it("does not stack findings — returns early for critical", () => {
    const current = makeSnapshot({ topLevel: { frequency: 9.0 } });
    const previous = makeSnapshot({ topLevel: { frequency: 7.0 } });
    const findings = frequencyManagementAdvisor([], [], current, previous);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });
});
