import { describe, it, expect } from "vitest";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";
import { applySpendApprovalThreshold } from "../governance/spend-approval-threshold.js";

const constraints: ExecutionConstraints = {
  allowedModelTiers: ["default"],
  maxToolCalls: 10,
  maxLlmTurns: 1,
  maxTotalTokens: 0,
  maxRuntimeMs: 30_000,
  maxWritesPerExecution: 10,
  trustLevel: "autonomous",
};
const approve = (): GovernanceDecision => ({
  outcome: "require_approval",
  riskScore: 10,
  approvalLevel: "standard",
  approvers: [],
  constraints,
  matchedPolicies: ["POLICY_RULE"],
});
const exec = (): GovernanceDecision => ({
  outcome: "execute",
  riskScore: 10,
  budgetProfile: "cheap",
  constraints,
  matchedPolicies: ["POLICY_RULE"],
});
const deny = (): GovernanceDecision => ({
  outcome: "deny",
  reasonCode: "SPEND_LIMIT",
  riskScore: 90,
  matchedPolicies: ["SPEND_LIMIT"],
});
const base = {
  trustLevelOverride: "autonomous" as const,
  spendAutonomyEnabled: true,
  threshold: 100,
  spendAmount: 50,
  mutationClass: "write" as const,
  reversibility: "full" as const,
};

describe("applySpendApprovalThreshold", () => {
  it("downgrades a reversible financial require_approval at/under threshold to execute", () => {
    const r = applySpendApprovalThreshold(approve(), base);
    expect(r.outcome).toBe("execute");
    expect(r.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });
  it("parks (escalates execute → require_approval) above threshold", () => {
    const r = applySpendApprovalThreshold(exec(), { ...base, spendAmount: 150 });
    expect(r.outcome).toBe("require_approval");
    expect(r.matchedPolicies).toContain("SPEND_APPROVAL_THRESHOLD");
  });
  it("NEVER touches a deny (under threshold, autonomous)", () => {
    expect(applySpendApprovalThreshold(deny(), base)).toEqual(deny());
  });
  it("does NOT downgrade an irreversible action under threshold", () => {
    expect(
      applySpendApprovalThreshold(approve(), { ...base, mutationClass: "destructive" }).outcome,
    ).toBe("require_approval");
    expect(applySpendApprovalThreshold(approve(), { ...base, reversibility: "none" }).outcome).toBe(
      "require_approval",
    );
  });
  it("is dormant unless trustLevelOverride is autonomous", () => {
    expect(
      applySpendApprovalThreshold(approve(), { ...base, trustLevelOverride: "guided" }),
    ).toEqual(approve());
    expect(
      applySpendApprovalThreshold(approve(), { ...base, trustLevelOverride: undefined }),
    ).toEqual(approve());
  });
  it("is dormant unless spend-autonomy is explicitly opted in (the always-$50 default must not auto-grant)", () => {
    expect(
      applySpendApprovalThreshold(approve(), { ...base, spendAutonomyEnabled: false }),
    ).toEqual(approve());
    expect(
      applySpendApprovalThreshold(approve(), { ...base, spendAutonomyEnabled: undefined }),
    ).toEqual(approve());
  });
  it("is a no-op when no threshold is configured", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, threshold: undefined })).toEqual(
      approve(),
    );
  });
  it("is a no-op for a non-financial action (null amount)", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, spendAmount: null })).toEqual(
      approve(),
    );
  });
  it("uses absolute value (negative budget delta under threshold downgrades)", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, spendAmount: -50 }).outcome).toBe(
      "execute",
    );
  });
  it("treats amount exactly at threshold as under (auto)", () => {
    expect(applySpendApprovalThreshold(approve(), { ...base, spendAmount: 100 }).outcome).toBe(
      "execute",
    );
  });
  it("a $0 threshold still auto-approves a $0 reversible standard spend, but parks any positive spend", () => {
    expect(
      applySpendApprovalThreshold(approve(), { ...base, threshold: 0, spendAmount: 0 }).outcome,
    ).toBe("execute");
    expect(
      applySpendApprovalThreshold(exec(), { ...base, threshold: 0, spendAmount: 1 }).outcome,
    ).toBe("require_approval");
  });
  it("does not escalate an already-parked over-threshold approval (stays require_approval, no double-mark)", () => {
    const r = applySpendApprovalThreshold(approve(), { ...base, spendAmount: 150 });
    expect(r.outcome).toBe("require_approval");
    expect(r.matchedPolicies).toEqual(["POLICY_RULE"]);
  });
  const approveAt = (approvalLevel: string): GovernanceDecision => ({
    outcome: "require_approval",
    riskScore: 10,
    approvalLevel,
    approvers: [],
    constraints,
    matchedPolicies: ["POLICY_RULE"],
  });
  it("does NOT downgrade a mandatory approval under threshold (system-critical / manual gate)", () => {
    expect(applySpendApprovalThreshold(approveAt("mandatory"), base).outcome).toBe(
      "require_approval",
    );
  });
  it("does NOT downgrade an elevated (high-risk) approval under threshold", () => {
    expect(applySpendApprovalThreshold(approveAt("elevated"), base).outcome).toBe(
      "require_approval",
    );
  });
});
