import { describe, it, expect } from "vitest";
import {
  getToolGovernanceDecision,
  GOVERNANCE_POLICY,
  type EffectCategory,
  type TrustLevel,
  type GovernanceDecision,
} from "./governance.js";
import type { SkillToolOperation } from "./types.js";

function makeOp(
  tier: EffectCategory,
  override?: Partial<Record<TrustLevel, GovernanceDecision>>,
): SkillToolOperation {
  return {
    description: "test",
    inputSchema: { type: "object", properties: {} },
    effectCategory: tier,
    governanceOverride: override,
    execute: async () => ({}),
  };
}

describe("GOVERNANCE_POLICY", () => {
  it("has entries for all 7 effect categories", () => {
    expect(Object.keys(GOVERNANCE_POLICY)).toEqual([
      "read",
      "propose",
      "simulate",
      "write",
      "external_send",
      "external_mutation",
      "irreversible",
    ]);
  });

  it("each category maps all 3 trust levels", () => {
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
  it("requires approval for write in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("write"), "supervised")).toBe("require-approval");
  });
  it("auto-approves write in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("write"), "guided")).toBe("auto-approve");
  });
  it("requires approval for external_send in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("external_send"), "supervised")).toBe(
      "require-approval",
    );
  });
  it("requires approval for external_send in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("external_send"), "guided")).toBe("require-approval");
  });
  it("denies irreversible ops in supervised mode", () => {
    expect(getToolGovernanceDecision(makeOp("irreversible"), "supervised")).toBe("deny");
  });
  it("requires approval for irreversible ops in guided mode", () => {
    expect(getToolGovernanceDecision(makeOp("irreversible"), "guided")).toBe("require-approval");
  });
  it("uses override when present", () => {
    const op = makeOp("write", { supervised: "auto-approve" });
    expect(getToolGovernanceDecision(op, "supervised")).toBe("auto-approve");
  });
  it("falls back to category when override does not cover trust level", () => {
    const op = makeOp("write", { supervised: "auto-approve" });
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
