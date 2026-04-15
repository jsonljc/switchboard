import { describe, it, expect } from "vitest";
import {
  getToolGovernanceDecision,
  GOVERNANCE_POLICY,
  type GovernanceTier,
  type TrustLevel,
  type GovernanceDecision,
} from "./governance.js";
import type { SkillToolOperation } from "./types.js";

function makeOp(
  tier: GovernanceTier,
  override?: Partial<Record<TrustLevel, GovernanceDecision>>,
): SkillToolOperation {
  return {
    description: "test",
    inputSchema: { type: "object", properties: {} },
    governanceTier: tier,
    governanceOverride: override,
    execute: async () => ({}),
  };
}

describe("GOVERNANCE_POLICY", () => {
  it("has entries for all 4 tiers", () => {
    expect(Object.keys(GOVERNANCE_POLICY)).toEqual([
      "read",
      "internal_write",
      "external_write",
      "destructive",
    ]);
  });

  it("each tier maps all 3 trust levels", () => {
    for (const tier of Object.values(GOVERNANCE_POLICY)) {
      expect(Object.keys(tier)).toEqual(["supervised", "guided", "autonomous"]);
    }
  });
});

describe("getToolGovernanceDecision", () => {
  it("auto-approves read ops in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("read"), "supervised")).toBe("auto-approve");
  });
  it("auto-approves read ops in autonomous mode", () => {
    expect(getToolGovernanceDecision(makeOp("read"), "autonomous")).toBe("auto-approve");
  });
  it("requires approval for internal_write in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("internal_write"), "supervised")).toBe(
      "require-approval",
    );
  });
  it("auto-approves internal_write in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("internal_write"), "guided")).toBe("auto-approve");
  });
  it("requires approval for external_write in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("external_write"), "supervised")).toBe(
      "require-approval",
    );
  });
  it("requires approval for external_write in autonomous mode", () => {
    expect(getToolGovernanceDecision(makeOp("external_write"), "autonomous")).toBe(
      "require-approval",
    );
  });
  it("denies destructive ops in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("destructive"), "supervised")).toBe("deny");
  });
  it("requires approval for destructive ops in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("destructive"), "guided")).toBe("require-approval");
  });
  it("uses override when present", () => {
    const op = makeOp("internal_write", { supervised: "auto-approve" });
    expect(getToolGovernanceDecision(op, "supervised")).toBe("auto-approve");
  });
  it("falls back to tier when override does not cover trust level", () => {
    const op = makeOp("internal_write", { supervised: "auto-approve" });
    expect(getToolGovernanceDecision(op, "guided")).toBe("auto-approve");
  });
});

describe("mapDecisionToOutcome", () => {
  it("maps auto-approve to auto-approved", async () => {
    const { mapDecisionToOutcome } = await import("./governance.js");
    expect(mapDecisionToOutcome("auto-approve")).toBe("auto-approved");
  });
  it("maps require-approval to require-approval", async () => {
    const { mapDecisionToOutcome } = await import("./governance.js");
    expect(mapDecisionToOutcome("require-approval")).toBe("require-approval");
  });
  it("maps deny to denied", async () => {
    const { mapDecisionToOutcome } = await import("./governance.js");
    expect(mapDecisionToOutcome("deny")).toBe("denied");
  });
});
