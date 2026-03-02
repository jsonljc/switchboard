import { describe, it, expect } from "vitest";
import {
  smbRouteApproval,
  smbCreateApprovalRequest,
  smbBindingHash,
} from "../smb/approval.js";
import type { SmbOrgConfig, DecisionTrace } from "@switchboard/schemas";

function makeSmbConfig(overrides?: Partial<SmbOrgConfig>): SmbOrgConfig {
  return {
    tier: "smb",
    governanceProfile: "guarded",
    perActionSpendLimit: null,
    dailySpendLimit: null,
    ownerId: "owner_1",
    ...overrides,
  };
}

function makeDecisionTrace(): DecisionTrace {
  return {
    actionId: "prop_1",
    envelopeId: "env_1",
    checks: [],
    computedRiskScore: { rawScore: 45, category: "medium", factors: [] },
    finalDecision: "allow",
    approvalRequired: "standard",
    explanation: "Test trace",
    evaluatedAt: new Date(),
  };
}

describe("smbRouteApproval", () => {
  it("should return single approver with 24h expiry", () => {
    const config = makeSmbConfig();
    const result = smbRouteApproval(config, true);

    expect(result.approvalRequired).toBe(true);
    expect(result.approverId).toBe("owner_1");
    expect(result.expiresInMs).toBe(24 * 60 * 60 * 1000);
  });

  it("should return false when not needed", () => {
    const config = makeSmbConfig();
    const result = smbRouteApproval(config, false);

    expect(result.approvalRequired).toBe(false);
    expect(result.approverId).toBe("owner_1");
  });
});

describe("smbBindingHash", () => {
  it("should produce consistent hashes for same envelope ID", () => {
    const h1 = smbBindingHash("env_123");
    const h2 = smbBindingHash("env_123");
    expect(h1).toBe(h2);
  });

  it("should produce different hashes for different envelope IDs", () => {
    const h1 = smbBindingHash("env_123");
    const h2 = smbBindingHash("env_456");
    expect(h1).not.toBe(h2);
  });
});

describe("smbCreateApprovalRequest", () => {
  it("should create a standard ApprovalRequest", () => {
    const config = makeSmbConfig();
    const trace = makeDecisionTrace();

    const request = smbCreateApprovalRequest({
      envelopeId: "env_1",
      actionId: "prop_1",
      summary: "Test action",
      riskCategory: "medium",
      decisionTrace: trace,
      orgConfig: config,
      contextSnapshot: { foo: "bar" },
    });

    expect(request.id).toMatch(/^appr_/);
    expect(request.envelopeId).toBe("env_1");
    expect(request.actionId).toBe("prop_1");
    expect(request.approvers).toEqual(["owner_1"]);
    expect(request.quorum).toBeNull();
    expect(request.status).toBe("pending");
    expect(request.expiredBehavior).toBe("deny");
    expect(request.suggestedButtons).toHaveLength(2);
    expect(request.bindingHash).toBeTruthy();
  });

  it("should set 24h expiry", () => {
    const config = makeSmbConfig();
    const trace = makeDecisionTrace();

    const request = smbCreateApprovalRequest({
      envelopeId: "env_1",
      actionId: "prop_1",
      summary: "Test",
      riskCategory: "medium",
      decisionTrace: trace,
      orgConfig: config,
      contextSnapshot: {},
    });

    const expiryMs = request.expiresAt.getTime() - request.createdAt.getTime();
    expect(expiryMs).toBe(24 * 60 * 60 * 1000);
  });

  it("should include evidence bundle", () => {
    const config = makeSmbConfig();
    const trace = makeDecisionTrace();

    const request = smbCreateApprovalRequest({
      envelopeId: "env_1",
      actionId: "prop_1",
      summary: "Test",
      riskCategory: "medium",
      decisionTrace: trace,
      orgConfig: config,
      contextSnapshot: { key: "value" },
    });

    expect(request.evidenceBundle.decisionTrace).toBe(trace);
    expect(request.evidenceBundle.contextSnapshot).toEqual({ key: "value" });
    expect(request.evidenceBundle.identitySnapshot).toEqual({
      ownerId: "owner_1",
      tier: "smb",
    });
  });
});
