import { describe, expect, it } from "vitest";
import { scoreRecommendation, scoreHandoff, decisionSortComparator } from "../urgency.js";
import type { Decision } from "../types.js";

const baseRec = {
  id: "r1",
  orgId: "org-1",
  agentKey: "riley" as const,
  intent: "recommendation.ad_set_pause",
  action: "pause",
  humanSummary: "test",
  parameters: {},
  targetEntities: null,
  sourceAgent: "riley",
  sourceWorkflow: null,
  surface: "queue" as const,
  status: "pending" as const,
  actedBy: null,
  actedAt: null,
  note: null,
  createdAt: new Date(),
  expiresAt: null,
  undoableUntil: null,
};

describe("scoreRecommendation", () => {
  it("returns ~95 for high confidence + max dollar cap", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0.95,
      dollarsAtRisk: 5000,
      riskLevel: "low",
    });
    expect(score).toBe(95);
  });

  it("saturates dollar factor at $2000 (vertical: med spa LTV)", () => {
    const at2k = scoreRecommendation({
      ...baseRec,
      confidence: 0.9,
      dollarsAtRisk: 2000,
      riskLevel: "low",
    });
    const at5k = scoreRecommendation({
      ...baseRec,
      confidence: 0.9,
      dollarsAtRisk: 5000,
      riskLevel: "low",
    });
    expect(at2k).toBe(at5k);
  });

  it("high-risk floor lifts low-base scores to 60", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0.3,
      dollarsAtRisk: 50,
      riskLevel: "high",
    });
    expect(score).toBe(60);
  });

  it("medium-risk floor lifts to 40", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0.1,
      dollarsAtRisk: 0,
      riskLevel: "medium",
    });
    expect(score).toBe(40);
  });

  it("low-risk has no floor", () => {
    const score = scoreRecommendation({
      ...baseRec,
      confidence: 0,
      dollarsAtRisk: 0,
      riskLevel: "low",
    });
    expect(score).toBe(0);
  });
});

describe("scoreHandoff", () => {
  const baseHandoff = {
    id: "h1",
    organizationId: "org-1",
    sessionId: "s1",
    leadId: "c1",
    status: "pending",
    reason: "human_requested",
    leadSnapshot: {},
    qualificationSnapshot: {},
    conversationSummary: {},
    acknowledgedAt: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns 100 for past-SLA handoffs", () => {
    const score = scoreHandoff({ ...baseHandoff, slaDeadlineAt: new Date(Date.now() - 60_000) });
    expect(score).toBe(100);
  });

  it("returns 30 for handoffs 24h+ in the future", () => {
    const score = scoreHandoff({
      ...baseHandoff,
      slaDeadlineAt: new Date(Date.now() + 25 * 3_600_000),
    });
    expect(score).toBe(30);
  });

  it("ramps linearly between 0h and 24h (12h ≈ 65)", () => {
    const score = scoreHandoff({
      ...baseHandoff,
      slaDeadlineAt: new Date(Date.now() + 12 * 3_600_000),
    });
    expect(score).toBeGreaterThanOrEqual(64);
    expect(score).toBeLessThanOrEqual(66);
  });
});

describe("decisionSortComparator", () => {
  function makeDecision(
    score: number,
    createdAtMs: number,
    kind: "approval" | "handoff" = "approval",
  ): Decision {
    return {
      id: `${kind}:${score}-${createdAtMs}`,
      kind,
      orgId: "org-1",
      agentKey: "alex",
      humanSummary: "x",
      presentation: { primaryLabel: "p", secondaryLabel: "s", dismissLabel: "d", dataLines: [] },
      urgencyScore: score,
      createdAt: new Date(createdAtMs),
      threadHref: null,
      sourceRef: { kind, sourceId: "x" },
      meta: {},
    };
  }

  it("sorts descending by urgencyScore", () => {
    const a = makeDecision(50, 1000);
    const b = makeDecision(80, 2000);
    expect(decisionSortComparator(a, b)).toBeGreaterThan(0);
  });

  it("tiebreak: older createdAt wins", () => {
    const older = makeDecision(50, 1000);
    const newer = makeDecision(50, 2000);
    expect(decisionSortComparator(older, newer)).toBeLessThan(0);
  });

  it("integration: real-world ordering puts past-SLA handoff above big-money rec", () => {
    const handoffPastSla = makeDecision(100, Date.now(), "handoff");
    const bigRec = makeDecision(85, Date.now(), "approval");
    const smallRec = makeDecision(60, Date.now(), "approval");
    const sorted = [smallRec, bigRec, handoffPastSla].sort(decisionSortComparator);
    expect(sorted[0]!.kind).toBe("handoff");
    expect(sorted[1]!.urgencyScore).toBe(85);
    expect(sorted[2]!.urgencyScore).toBe(60);
  });
});
