import { describe, it, expect } from "vitest";
import { smbEvaluate, smbCategorizeRisk, smbApprovalRequired } from "../smb/evaluator.js";
import { createGuardrailState } from "../engine/policy-engine.js";
import type { ActionProposal, GuardrailConfig } from "@switchboard/schemas";
import type { SmbOrgConfig } from "@switchboard/schemas";

function makeProposal(overrides?: Partial<ActionProposal>): ActionProposal {
  return {
    id: "prop_test",
    actionType: "digital-ads.campaign.pause",
    parameters: {},
    evidence: "test",
    confidence: 1,
    originatingMessageId: "",
    ...overrides,
  };
}

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

describe("smbCategorizeRisk", () => {
  it("should return low for null amount and reversible", () => {
    expect(smbCategorizeRisk(null, true)).toBe("low");
  });

  it("should return medium for null amount and irreversible", () => {
    expect(smbCategorizeRisk(null, false)).toBe("medium");
  });

  it("should return low for <= $100 and reversible", () => {
    expect(smbCategorizeRisk(50, true)).toBe("low");
    expect(smbCategorizeRisk(100, true)).toBe("low");
  });

  it("should return medium for $100-$1000", () => {
    expect(smbCategorizeRisk(101, true)).toBe("medium");
    expect(smbCategorizeRisk(500, true)).toBe("medium");
    expect(smbCategorizeRisk(1000, true)).toBe("medium");
  });

  it("should return high for > $1000", () => {
    expect(smbCategorizeRisk(1001, true)).toBe("high");
    expect(smbCategorizeRisk(5000, false)).toBe("high");
  });

  it("should return medium for <= $100 and irreversible", () => {
    expect(smbCategorizeRisk(50, false)).toBe("medium");
  });
});

describe("smbApprovalRequired", () => {
  it("observe → never requires approval", () => {
    expect(smbApprovalRequired("low", "observe")).toBe(false);
    expect(smbApprovalRequired("medium", "observe")).toBe(false);
    expect(smbApprovalRequired("high", "observe")).toBe(false);
    expect(smbApprovalRequired("critical", "observe")).toBe(false);
  });

  it("guarded → only high/critical", () => {
    expect(smbApprovalRequired("low", "guarded")).toBe(false);
    expect(smbApprovalRequired("medium", "guarded")).toBe(false);
    expect(smbApprovalRequired("high", "guarded")).toBe(true);
    expect(smbApprovalRequired("critical", "guarded")).toBe(true);
  });

  it("strict → medium+high+critical", () => {
    expect(smbApprovalRequired("low", "strict")).toBe(false);
    expect(smbApprovalRequired("medium", "strict")).toBe(true);
    expect(smbApprovalRequired("high", "strict")).toBe(true);
  });

  it("locked → always", () => {
    expect(smbApprovalRequired("low", "locked")).toBe(true);
    expect(smbApprovalRequired("medium", "locked")).toBe(true);
    expect(smbApprovalRequired("high", "locked")).toBe(true);
  });
});

describe("smbEvaluate", () => {
  it("should allow action when no restrictions", () => {
    const config = makeSmbConfig();
    const proposal = makeProposal();
    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("none");
  });

  it("should deny action not in allowlist", () => {
    const config = makeSmbConfig({
      allowedActionTypes: ["digital-ads.campaign.create"],
    });
    const proposal = makeProposal({ actionType: "digital-ads.campaign.pause" });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("deny");
  });

  it("should allow action in allowlist", () => {
    const config = makeSmbConfig({
      allowedActionTypes: ["digital-ads.campaign.pause"],
    });
    const proposal = makeProposal({ actionType: "digital-ads.campaign.pause" });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("allow");
  });

  it("should deny action in blocklist", () => {
    const config = makeSmbConfig({
      blockedActionTypes: ["digital-ads.campaign.pause"],
    });
    const proposal = makeProposal({ actionType: "digital-ads.campaign.pause" });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("deny");
  });

  it("should deny when per-action spend limit exceeded", () => {
    const config = makeSmbConfig({ perActionSpendLimit: 500 });
    const proposal = makeProposal({
      parameters: { amount: 600 },
    });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "SPEND_LIMIT" && c.matched)).toBe(true);
  });

  it("should deny when daily spend limit exceeded", () => {
    const config = makeSmbConfig({ dailySpendLimit: 1000 });
    const proposal = makeProposal({
      parameters: { amount: 200 },
    });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 900,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("deny");
  });

  it("should require approval for high risk with guarded profile", () => {
    const config = makeSmbConfig({ governanceProfile: "guarded" });
    const proposal = makeProposal({
      parameters: { amount: 2000 },
    });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("standard");
  });

  it("should not require approval for low risk with guarded profile", () => {
    const config = makeSmbConfig({ governanceProfile: "guarded" });
    const proposal = makeProposal({
      parameters: { amount: 50 },
    });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("none");
  });

  it("should deny when rate limit exceeded", () => {
    const guardrailState = createGuardrailState();
    guardrailState.actionCounts.set("action:digital-ads.campaign.pause", {
      count: 5,
      windowStart: Date.now() - 1000,
    });

    const guardrails: GuardrailConfig = {
      rateLimits: [{ scope: "action", maxActions: 5, windowMs: 60000 }],
      cooldowns: [],
      protectedEntities: [],
    };

    const config = makeSmbConfig();
    const proposal = makeProposal();

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails,
      guardrailState,
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "RATE_LIMIT" && c.matched)).toBe(true);
  });

  it("should deny protected entity", () => {
    const guardrails: GuardrailConfig = {
      rateLimits: [],
      cooldowns: [],
      protectedEntities: [
        { entityType: "campaign", entityId: "camp_1", reason: "High-value campaign" },
      ],
    };

    const config = makeSmbConfig();
    const proposal = makeProposal({
      parameters: { entityId: "camp_1" },
    });

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("deny");
    expect(trace.checks.some((c) => c.checkCode === "PROTECTED_ENTITY")).toBe(true);
  });

  it("should always require approval with locked profile", () => {
    const config = makeSmbConfig({ governanceProfile: "locked" });
    const proposal = makeProposal(); // no amount = low risk

    const trace = smbEvaluate(proposal, {
      orgConfig: config,
      guardrails: null,
      guardrailState: createGuardrailState(),
      dailySpend: 0,
      envelopeId: "env_test",
    });

    expect(trace.finalDecision).toBe("allow");
    expect(trace.approvalRequired).toBe("standard");
  });
});
