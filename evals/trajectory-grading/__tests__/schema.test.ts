import { describe, it, expect } from "vitest";
import {
  TrajectoryCaseSchema,
  ExpectedStepSchema,
  RecordedCallSchema,
  ViolationKindEnum,
  EffectCategoryEnum,
} from "../schema.js";

const validCase = {
  id: "demo-clean",
  trustLevel: "autonomous",
  expected: [{ toolId: "calendar", operation: "find_slots", effectCategory: "read" }],
  trajectory: [
    {
      toolId: "calendar",
      operation: "find_slots",
      params: { date: "2026-07-01" },
      result: { status: "success" },
      governanceDecision: "auto-approved",
    },
  ],
  expectedVerdict: "pass",
};

describe("trajectory-grading schema (structural)", () => {
  it("parses a minimal valid trajectory case", () => {
    expect(TrajectoryCaseSchema.safeParse(validCase).success).toBe(true);
  });

  it("rejects an unknown effectCategory on an expected step", () => {
    const bad = {
      ...validCase,
      expected: [{ toolId: "x", operation: "y", effectCategory: "teleport" }],
    };
    expect(TrajectoryCaseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown trustLevel", () => {
    expect(TrajectoryCaseSchema.safeParse({ ...validCase, trustLevel: "godmode" }).success).toBe(
      false,
    );
  });

  it("rejects an expectedVerdict outside pass|fail", () => {
    expect(TrajectoryCaseSchema.safeParse({ ...validCase, expectedVerdict: "maybe" }).success).toBe(
      false,
    );
  });

  it("ACCEPTS a recorded governanceDecision of 'simulated' (real executor emits it)", () => {
    const sim = RecordedCallSchema.safeParse({
      toolId: "booking",
      operation: "create",
      params: {},
      governanceDecision: "simulated",
    });
    expect(sim.success).toBe(true);
  });

  it("ACCEPTS an arbitrary recorded governanceDecision string (permissive; grader owns semantics)", () => {
    const weird = RecordedCallSchema.safeParse({
      toolId: "booking",
      operation: "create",
      params: {},
      governanceDecision: "weird-unknown-value",
    });
    expect(weird.success).toBe(true);
  });

  it("an expected step accepts a per-trust-level governanceOverride", () => {
    const parsed = ExpectedStepSchema.safeParse({
      toolId: "deposit",
      operation: "charge",
      effectCategory: "irreversible",
      governanceOverride: { guided: "auto-approve" },
    });
    expect(parsed.success).toBe(true);
  });

  it("exposes exactly the four violation kinds", () => {
    expect([...ViolationKindEnum.options].sort()).toEqual(
      [
        "approval-bypassed",
        "argument-invalid",
        "malformed-record",
        "tool-sequence-mismatch",
      ].sort(),
    );
  });

  it("exposes the seven effect categories", () => {
    expect(EffectCategoryEnum.options.length).toBe(7);
  });
});
