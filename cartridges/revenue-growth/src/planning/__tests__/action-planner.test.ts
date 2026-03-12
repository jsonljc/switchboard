import { describe, it, expect, vi } from "vitest";
import { ActionPlanner } from "../action-planner.js";
import type { Constraint, EscalationResult, AccountLearningProfile } from "@switchboard/schemas";
import type { LLMClient } from "@switchboard/core";

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    type: "SIGNAL",
    score: 35,
    confidence: "HIGH",
    isPrimary: true,
    scorerOutput: {
      scorerName: "signal-health",
      score: 35,
      confidence: "HIGH",
      issues: [{ code: "SH-001", severity: "critical", message: "Pixel inactive" }],
      computedAt: new Date().toISOString(),
    },
    reason: "Binding constraint: SIGNAL (score 35/60)",
    ...overrides,
  };
}

function makeEscalation(overrides: Partial<EscalationResult> = {}): EscalationResult {
  return {
    level: "INFO",
    constraintType: "SIGNAL",
    cycleCount: 1,
    score: 35,
    reason: "SIGNAL identified as primary constraint",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<AccountLearningProfile> = {}): AccountLearningProfile {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    creativePatterns: [],
    constraintHistory: [],
    calibration: {},
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ActionPlanner", () => {
  const planner = new ActionPlanner();

  it("produces a basic intervention without LLM", async () => {
    const constraint = makeConstraint();
    const escalation = makeEscalation();

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
    });

    expect(intervention.constraintType).toBe("SIGNAL");
    expect(intervention.actionType).toBe("FIX_TRACKING");
    expect(intervention.status).toBe("PROPOSED");
    expect(intervention.artifacts.length).toBeGreaterThan(0);
  });

  it("uses LLM when available", async () => {
    const llmClient: LLMClient = {
      complete: vi.fn().mockResolvedValue("LLM-generated brief content"),
    };
    const constraint = makeConstraint();
    const escalation = makeEscalation();

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
      llmClient,
    });

    expect(llmClient.complete).toHaveBeenCalled();
    expect(intervention.artifacts[0]!.content).toContain("LLM-generated");
  });

  it("falls back to template when LLM fails", async () => {
    const llmClient: LLMClient = {
      complete: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    };
    const constraint = makeConstraint();
    const escalation = makeEscalation();

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
      llmClient,
    });

    expect(intervention.artifacts[0]!.content).toContain("FIX_TRACKING");
  });

  it("downgrades impact when historical success rate is low", async () => {
    const constraint = makeConstraint({ score: 20, confidence: "HIGH" });
    const escalation = makeEscalation({ score: 20 });
    const profile = makeProfile({
      calibration: {
        SIGNAL: { successRate: 0.2, avgImprovement: 5, totalCount: 10 },
      },
    });

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
      accountProfile: profile,
    });

    // Score 20 + HIGH confidence = would normally be HIGH, but calibration downgrades to MEDIUM
    expect(intervention.estimatedImpact).toBe("MEDIUM");
  });

  it("upgrades impact when historical success rate is high", async () => {
    const constraint = makeConstraint({ score: 45, confidence: "MEDIUM" });
    const escalation = makeEscalation({ score: 45 });
    const profile = makeProfile({
      calibration: {
        SIGNAL: { successRate: 0.8, avgImprovement: 15, totalCount: 10 },
      },
    });

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
      accountProfile: profile,
    });

    // Score 45 = would normally be LOW, but calibration upgrades to MEDIUM
    expect(intervention.estimatedImpact).toBe("MEDIUM");
  });

  it("does not calibrate with insufficient history", async () => {
    const constraint = makeConstraint({ score: 20, confidence: "HIGH" });
    const escalation = makeEscalation({ score: 20 });
    const profile = makeProfile({
      calibration: {
        SIGNAL: { successRate: 0.1, avgImprovement: 2, totalCount: 2 },
      },
    });

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
      accountProfile: profile,
    });

    // Only 2 interventions in history — not enough to calibrate
    expect(intervention.estimatedImpact).toBe("HIGH");
  });

  it("adds checklist artifact for ESCALATE level", async () => {
    const constraint = makeConstraint();
    const escalation = makeEscalation({ level: "ESCALATE", cycleCount: 3 });

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
    });

    const checklist = intervention.artifacts.find((a) => a.type === "checklist");
    expect(checklist).toBeDefined();
    expect(checklist!.content).toContain("ESCALATE");
  });

  it("adds checklist and report artifacts for CRITICAL level", async () => {
    const constraint = makeConstraint({ score: 15 });
    const escalation = makeEscalation({ level: "CRITICAL", cycleCount: 4, score: 15 });

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
    });

    const checklist = intervention.artifacts.find((a) => a.type === "checklist");
    const report = intervention.artifacts.find((a) => a.type === "report");
    expect(checklist).toBeDefined();
    expect(report).toBeDefined();
    expect(report!.content).toContain("Critical Constraint Report");
    expect(checklist!.content).toContain("Schedule emergency review meeting");
  });

  it("includes calibration history in critical report when profile available", async () => {
    const constraint = makeConstraint({ score: 15 });
    const escalation = makeEscalation({ level: "CRITICAL", cycleCount: 4, score: 15 });
    const profile = makeProfile({
      calibration: {
        SIGNAL: { successRate: 0.25, avgImprovement: 3, totalCount: 8 },
      },
    });

    const intervention = await planner.planIntervention(constraint, "cycle-1", {
      escalation,
      accountProfile: profile,
    });

    const report = intervention.artifacts.find((a) => a.type === "report");
    expect(report!.content).toContain("25%");
    expect(report!.content).toContain("8");
  });
});
