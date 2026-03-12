import { describe, it, expect } from "vitest";
import { determineEscalationLevel } from "../escalation.js";
import type { AccountLearningProfile } from "@switchboard/schemas";

function makeProfile(constraintType: string, cycleCount: number): AccountLearningProfile {
  return {
    accountId: "acct-1",
    organizationId: "org-1",
    creativePatterns: [],
    constraintHistory: [
      {
        constraintType:
          constraintType as AccountLearningProfile["constraintHistory"][0]["constraintType"],
        startedAt: "2025-01-01T00:00:00Z",
        endedAt: null,
        cycleCount,
      },
    ],
    calibration: {},
    updatedAt: new Date().toISOString(),
  };
}

describe("determineEscalationLevel", () => {
  it("returns INFO for first cycle (no profile)", () => {
    const result = determineEscalationLevel("SIGNAL", 50);
    expect(result.level).toBe("INFO");
    expect(result.cycleCount).toBe(1);
    expect(result.constraintType).toBe("SIGNAL");
  });

  it("returns INFO for ≤1 cycle with profile", () => {
    const profile = makeProfile("SIGNAL", 1);
    const result = determineEscalationLevel("SIGNAL", 50, profile);
    expect(result.level).toBe("INFO");
  });

  it("returns WARN for 2 consecutive cycles", () => {
    const profile = makeProfile("CREATIVE", 2);
    const result = determineEscalationLevel("CREATIVE", 40, profile);
    expect(result.level).toBe("WARN");
    expect(result.cycleCount).toBe(2);
  });

  it("returns ESCALATE for 3+ cycles above critical threshold", () => {
    const profile = makeProfile("FUNNEL", 3);
    const result = determineEscalationLevel("FUNNEL", 30, profile);
    expect(result.level).toBe("ESCALATE");
    expect(result.cycleCount).toBe(3);
  });

  it("returns CRITICAL for 3+ cycles below critical threshold", () => {
    // SIGNAL critical threshold is 30
    const profile = makeProfile("SIGNAL", 4);
    const result = determineEscalationLevel("SIGNAL", 20, profile);
    expect(result.level).toBe("CRITICAL");
    expect(result.cycleCount).toBe(4);
    expect(result.reason).toContain("below critical threshold");
  });

  it("returns ESCALATE for 3+ cycles when score equals critical threshold", () => {
    // CREATIVE critical threshold is 25
    const profile = makeProfile("CREATIVE", 3);
    const result = determineEscalationLevel("CREATIVE", 25, profile);
    expect(result.level).toBe("ESCALATE");
  });

  it("returns CRITICAL for 3+ cycles when score is 1 below critical threshold", () => {
    // CREATIVE critical threshold is 25
    const profile = makeProfile("CREATIVE", 3);
    const result = determineEscalationLevel("CREATIVE", 24, profile);
    expect(result.level).toBe("CRITICAL");
  });

  it("uses default cycle count of 1 when constraint not in profile history", () => {
    const profile = makeProfile("SIGNAL", 5);
    // Asking about CREATIVE but profile only has SIGNAL history
    const result = determineEscalationLevel("CREATIVE", 40, profile);
    expect(result.level).toBe("INFO");
    expect(result.cycleCount).toBe(1);
  });

  it("handles null profile", () => {
    const result = determineEscalationLevel("SATURATION", 15, null);
    expect(result.level).toBe("INFO");
    expect(result.cycleCount).toBe(1);
  });

  it("includes score in result", () => {
    const result = determineEscalationLevel("SALES", 35);
    expect(result.score).toBe(35);
  });

  it("includes descriptive reason", () => {
    const profile = makeProfile("SIGNAL", 2);
    const result = determineEscalationLevel("SIGNAL", 45, profile);
    expect(result.reason).toContain("SIGNAL");
    expect(result.reason).toContain("2");
  });
});
