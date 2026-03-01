import { describe, it, expect } from "vitest";
import { creativeExhaustionAdvisor } from "../creative-exhaustion.js";
import type { MetricSnapshot, DiagnosticContext } from "../../../core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(ctr: number, overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    entityId: "act_123",
    entityLevel: "account",
    periodStart: "2024-01-01",
    periodEnd: "2024-01-07",
    spend: 1000,
    stages: {},
    topLevel: { ctr, cpm: 10, impressions: 10000, clicks: ctr * 100 },
    ...overrides,
  };
}

function makeContext(ctrValues: number[]): DiagnosticContext {
  // ctrValues[0] is the most recent historical, ctrValues[last] is the oldest
  return {
    historicalSnapshots: ctrValues.map((ctr, i) =>
      makeSnapshot(ctr, {
        periodStart: `2024-01-${String(7 - i * 7).padStart(2, "0")}`,
        periodEnd: `2024-01-${String(13 - i * 7).padStart(2, "0")}`,
      })
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("creativeExhaustionAdvisor", () => {
  it("returns no findings when no historical snapshots", () => {
    const findings = creativeExhaustionAdvisor(
      [],
      [],
      makeSnapshot(5),
      makeSnapshot(6),
      undefined
    );

    expect(findings).toHaveLength(0);
  });

  it("returns no findings with fewer than 3 historical snapshots", () => {
    const findings = creativeExhaustionAdvisor(
      [],
      [],
      makeSnapshot(5),
      makeSnapshot(6),
      { historicalSnapshots: [makeSnapshot(5.5), makeSnapshot(6)] }
    );

    expect(findings).toHaveLength(0);
  });

  it("detects 3 consecutive periods of CTR decline", () => {
    // Current CTR = 4.0, Historical (most recent first): 4.2, 4.5, 5.0
    // Decline: 4.0 < 4.2 < 4.5 < 5.0 → 3 consecutive declines
    // Declines: 4.0→4.2 = -4.8%, 4.2→4.5 = -6.7%, 4.5→5.0 = -10%
    // |decline[0]| (4.8%) < |decline[1]| (6.7%) → NOT accelerating → warning
    const current = makeSnapshot(4.0);
    const context = makeContext([4.2, 4.5, 5.0]);

    const findings = creativeExhaustionAdvisor(
      [],
      [],
      current,
      makeSnapshot(4.2),
      context
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].stage).toBe("click");
    expect(findings[0].message).toContain("Creative exhaustion detected");
    expect(findings[0].message).toContain("3 consecutive periods");
  });

  it("flags critical when decline is accelerating", () => {
    // Current CTR = 2.0, Historical: 3.0, 3.5, 3.8
    // Declines: 2.0→3.0 = -33%, 3.0→3.5 = -14%, 3.5→3.8 = -8%
    // Most recent decline (-33%) > second decline (-14%) → accelerating
    const current = makeSnapshot(2.0);
    const context = makeContext([3.0, 3.5, 3.8]);

    const findings = creativeExhaustionAdvisor(
      [],
      [],
      current,
      makeSnapshot(3.0),
      context
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("accelerating");
  });

  it("does not trigger when CTR is not declining consistently", () => {
    // Current CTR = 4.0, Historical: 5.0, 3.0, 4.5
    // 4.0 < 5.0 → decline, but 5.0 > 3.0 → no consecutive decline chain of 3
    const current = makeSnapshot(4.0);
    const context = makeContext([5.0, 3.0, 4.5]);

    const findings = creativeExhaustionAdvisor(
      [],
      [],
      current,
      makeSnapshot(5.0),
      context
    );

    expect(findings).toHaveLength(0);
  });

  it("does not trigger when CTR is increasing", () => {
    const current = makeSnapshot(5.0);
    const context = makeContext([4.0, 3.5, 3.0]);

    const findings = creativeExhaustionAdvisor(
      [],
      [],
      current,
      makeSnapshot(4.0),
      context
    );

    expect(findings).toHaveLength(0);
  });
});
