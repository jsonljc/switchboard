// ---------------------------------------------------------------------------
// Weekly Digest Generator — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { generateWeeklyDigest } from "../generator.js";
import { MockLLMClient } from "@switchboard/core";
import type { DiagnosticCycleRecord } from "../../stores/interfaces.js";
import type { Intervention } from "@switchboard/schemas";

function makeCycle(overrides: Partial<DiagnosticCycleRecord> = {}): DiagnosticCycleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    accountId: "acc_1",
    organizationId: "org_1",
    dataTier: "FULL",
    scorerOutputs: [],
    constraints: [],
    primaryConstraint: "SIGNAL",
    previousPrimaryConstraint: null,
    constraintTransition: false,
    interventions: [],
    startedAt: now,
    completedAt: now,
    ...overrides,
  };
}

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle_1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "EXECUTED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "Test",
    artifacts: [],
    outcomeStatus: "IMPROVED",
    measurementWindowDays: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("generateWeeklyDigest", () => {
  it("generates template-based digest without LLM", async () => {
    const cycles = [
      makeCycle({ primaryConstraint: "SIGNAL" }),
      makeCycle({ primaryConstraint: "CREATIVE" }),
    ];
    const interventions = [makeIntervention({ outcomeStatus: "IMPROVED" })];

    const digest = await generateWeeklyDigest("acc_1", cycles, interventions);

    expect(digest.accountId).toBe("acc_1");
    expect(digest.constraintHistory).toEqual(["SIGNAL", "CREATIVE"]);
    expect(digest.interventionOutcomes).toHaveLength(1);
    expect(digest.headline).toContain("Constraint shift detected");
    expect(digest.summary).toContain("2 diagnostic cycle");
    expect(digest.id).toBeTruthy();
    expect(digest.weekStartDate).toBeTruthy();
  });

  it("generates digest with single constraint", async () => {
    const cycles = [
      makeCycle({ primaryConstraint: "SIGNAL" }),
      makeCycle({ primaryConstraint: "SIGNAL" }),
    ];

    const digest = await generateWeeklyDigest("acc_1", cycles, []);

    expect(digest.headline).toContain("Primary constraint: SIGNAL");
  });

  it("generates digest with no constraints", async () => {
    const cycles = [makeCycle({ primaryConstraint: null })];

    const digest = await generateWeeklyDigest("acc_1", cycles, []);

    expect(digest.headline).toContain("No binding constraints");
  });

  it("generates LLM-backed digest when client provided", async () => {
    const llmClient = new MockLLMClient([
      "HEADLINE: Revenue growth improving steadily\nSUMMARY:\n- Signal health improved\n- One intervention successful",
    ]);

    const cycles = [makeCycle()];
    const interventions = [makeIntervention()];

    const digest = await generateWeeklyDigest("acc_1", cycles, interventions, llmClient);

    expect(digest.headline).toBe("Revenue growth improving steadily");
    expect(digest.summary).toContain("Signal health improved");
  });

  it("falls back to template when LLM fails", async () => {
    const failingLLM: import("@switchboard/core").LLMClient = {
      complete: () => Promise.reject(new Error("LLM unavailable")),
      completeStructured: () => Promise.reject(new Error("LLM unavailable")),
    };

    const cycles = [makeCycle()];

    const digest = await generateWeeklyDigest("acc_1", cycles, [], failingLLM);

    expect(digest.headline).toContain("Primary constraint");
    expect(digest.summary).toContain("diagnostic cycle");
  });

  it("includes organization from first cycle", async () => {
    const cycles = [makeCycle({ organizationId: "org_test" })];

    const digest = await generateWeeklyDigest("acc_1", cycles, []);
    expect(digest.organizationId).toBe("org_test");
  });

  it("handles empty cycles array", async () => {
    const digest = await generateWeeklyDigest("acc_1", [], []);

    expect(digest.constraintHistory).toEqual([]);
    expect(digest.headline).toContain("No binding constraints");
    expect(digest.organizationId).toBe("unknown");
  });
});
