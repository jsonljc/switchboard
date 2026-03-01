import { describe, it, expect } from "vitest";
import { audienceOverlapAdvisor } from "../audience-overlap.js";
import type {
  MetricSnapshot,
  DiagnosticContext,
  SubEntityBreakdown,
  AudienceOverlapPair,
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

function makeEntity(
  overrides: Partial<SubEntityBreakdown> = {}
): SubEntityBreakdown {
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

describe("audienceOverlapAdvisor", () => {
  it("returns no findings when no sub-entities available", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const findings = audienceOverlapAdvisor([], [], current, previous);
    expect(findings).toHaveLength(0);
  });

  it("returns no findings with only 1 sub-entity", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const context: DiagnosticContext = {
      subEntities: [makeEntity()],
    };
    const findings = audienceOverlapAdvisor([], [], current, previous, context);
    expect(findings).toHaveLength(0);
  });

  it("flags critical overlap when explicit data shows >50% overlap", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const overlaps: AudienceOverlapPair[] = [
      { adSetId1: "as1", adSetId2: "as2", overlapRate: 0.65 },
    ];
    const context: DiagnosticContext = {
      subEntities: [
        makeEntity({ entityId: "as1" }),
        makeEntity({ entityId: "as2" }),
      ],
      audienceOverlaps: overlaps,
    };
    const findings = audienceOverlapAdvisor([], [], current, previous, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].message).toContain("65%");
  });

  it("flags warning when explicit data shows >30% overlap", () => {
    const current = makeSnapshot();
    const previous = makeSnapshot();
    const overlaps: AudienceOverlapPair[] = [
      { adSetId1: "as1", adSetId2: "as2", overlapRate: 0.35 },
      { adSetId1: "as2", adSetId2: "as3", overlapRate: 0.40 },
    ];
    const context: DiagnosticContext = {
      subEntities: [
        makeEntity({ entityId: "as1" }),
        makeEntity({ entityId: "as2" }),
        makeEntity({ entityId: "as3" }),
      ],
      audienceOverlaps: overlaps,
    };
    const findings = audienceOverlapAdvisor([], [], current, previous, context);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("2 ad set pair");
  });

  it("flags heuristic overlap when many ad sets have similar CPAs", () => {
    const entities: SubEntityBreakdown[] = [];
    for (let i = 0; i < 6; i++) {
      entities.push(
        makeEntity({
          entityId: `as_${i}`,
          spend: 100,
          conversions: 10, // All have CPA = $10 — very low variance
        })
      );
    }
    const current = makeSnapshot({ topLevel: { cpm: 12 } });
    const previous = makeSnapshot();
    const context: DiagnosticContext = { subEntities: entities };
    const findings = audienceOverlapAdvisor([], [], current, previous, context);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("similar CPAs");
  });

  it("flags zero-conversion ad sets with active spending", () => {
    const totalSpend = 1000;
    const entities: SubEntityBreakdown[] = [
      makeEntity({ entityId: "as_1", spend: 200, conversions: 20 }),
      makeEntity({ entityId: "as_2", spend: 200, conversions: 15 }),
      makeEntity({ entityId: "as_3", spend: 150, conversions: 0 }),
      makeEntity({ entityId: "as_4", spend: 150, conversions: 0 }),
      makeEntity({ entityId: "as_5", spend: 150, conversions: 0 }),
      makeEntity({ entityId: "as_6", spend: 150, conversions: 0 }),
    ];
    const current = makeSnapshot({
      spend: totalSpend,
      topLevel: { cpm: 10 },
    });
    const previous = makeSnapshot();
    const context: DiagnosticContext = { subEntities: entities };
    const findings = audienceOverlapAdvisor([], [], current, previous, context);

    const overlapFindings = findings.filter(
      (f) => f.message.includes("zero conversions")
    );
    expect(overlapFindings.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag when ad sets have diverse CPAs", () => {
    const entities: SubEntityBreakdown[] = [
      makeEntity({ entityId: "as_1", spend: 100, conversions: 20 }),   // CPA = 5
      makeEntity({ entityId: "as_2", spend: 200, conversions: 10 }),   // CPA = 20
      makeEntity({ entityId: "as_3", spend: 50, conversions: 25 }),    // CPA = 2
      makeEntity({ entityId: "as_4", spend: 300, conversions: 5 }),    // CPA = 60
      makeEntity({ entityId: "as_5", spend: 150, conversions: 15 }),   // CPA = 10
    ];
    const current = makeSnapshot({ topLevel: { cpm: 10 } });
    const previous = makeSnapshot();
    const context: DiagnosticContext = { subEntities: entities };
    const findings = audienceOverlapAdvisor([], [], current, previous, context);

    // Should NOT find similar CPA warning
    const cpaFindings = findings.filter((f) => f.message.includes("similar CPAs"));
    expect(cpaFindings).toHaveLength(0);
  });
});
