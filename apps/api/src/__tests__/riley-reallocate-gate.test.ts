/**
 * adoptimizer.campaign.reallocate, exercised through the REAL GovernanceGate + policy engine (NOT a
 * spy ingress). Proves the Spec-1B reallocate gate and its decomposition (mirrors riley-pause-gate):
 *   - allow + approval policies + seeded system principal -> parks at MANDATORY,
 *   - the AUTONOMOUS trustLevelOverride does NOT relax it EVEN with a spendAmount (the spend lever
 *     relaxes only "standard"; a money move must stay mandatory),
 *   - allow ALONE -> executes (approval policy is load-bearing; never seed one without the other),
 *   - un-seeded org -> default-DENY (fail safe),
 *   - the anchored reallocate rule does NOT bleed onto the pause intent.
 * Uses the SAME db seed builders production provisioning uses, so the gate and the seed cannot drift.
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  buildRileyReallocateAllowPolicyInput,
  buildRileyReallocateApprovalPolicyInput,
} from "@switchboard/db";
import {
  RILEY_REALLOCATE_INTENT,
  buildRileyBudgetSubmitRequest,
} from "../services/workflows/riley-budget-submit-request.js";

const ORG = "org-acme";

function systemSpec(): IdentitySpec {
  return {
    id: "spec-system",
    principalId: "system",
    organizationId: ORG,
    name: "System",
    description: "Seeded system principal",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function allowPolicy(): Policy {
  return {
    ...buildRileyReallocateAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function approvalPolicy(): Policy {
  return {
    ...buildRileyReallocateApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

// The gate consumes the REAL producer output (no hand-duplicated parameters) so this test and the
// submit-request builder can never drift on actionType / spendAmount / frozen cents.
const REALLOCATE_INPUT = {
  organizationId: ORG,
  recommendationId: "rec_1",
  adAccountId: "act_123",
  campaignId: "camp_1",
  fromCents: 5000,
  toCents: 8000,
  rationale: "scale the daily budget up",
  evidence: { clicks: 100, conversions: 10, days: 7 },
};

function reallocateParameters(): Record<string, unknown> {
  const req = buildRileyBudgetSubmitRequest(REALLOCATE_INPUT, {
    deploymentId: "dep-riley",
    skillSlug: "ad-optimizer",
  });
  if (!req) throw new Error("expected a non-null reallocate submit request");
  return req.parameters as Record<string, unknown>;
}

function reallocateWorkUnit(opts?: { trustLevelOverride?: "autonomous" }): WorkUnit {
  return {
    id: "wu-reallocate-1",
    requestedAt: "2026-06-06T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: RILEY_REALLOCATE_INTENT,
    parameters: reallocateParameters(),
    deployment: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
      ...(opts?.trustLevelOverride ? { trustLevelOverride: opts.trustLevelOverride } : {}),
    },
    resolvedMode: "workflow",
    traceId: "trace-reallocate-1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function reallocateRegistration(): IntentRegistration {
  return {
    intent: RILEY_REALLOCATE_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: RILEY_REALLOCATE_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

function buildGate(policies: Policy[], specResolves = true): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => {
      if (!specResolves) throw new Error("IdentitySpec not found");
      return { spec: systemSpec(), overlays: [] };
    },
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

describe("adoptimizer.campaign.reallocate governance gate (real engine)", () => {
  it("parks at MANDATORY with the seeded allow + require_approval policies", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()]);
    const decision = await gate.evaluate(reallocateWorkUnit(), reallocateRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("STILL parks at MANDATORY under an autonomous deployment carrying a spendAmount (the spend lever relaxes only standard)", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()]);
    const decision = await gate.evaluate(
      reallocateWorkUnit({ trustLevelOverride: "autonomous" }),
      reallocateRegistration(),
    );
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("consumes the REAL producer's parameters: actionType 'scale' + dollar spendAmount reach the gate", () => {
    const params = reallocateParameters();
    // The re-keyed scale trigger and the structured spend-delta the gate sizes on (|8000-5000|/100).
    expect(params.actionType).toBe("scale");
    expect(params.spendAmount).toBe(30);
  });

  it("allow ALONE EXECUTES (documents the approval policy is load-bearing - never seed one without the other)", async () => {
    const gate = buildGate([allowPolicy()]);
    const decision = await gate.evaluate(reallocateWorkUnit(), reallocateRegistration());
    expect(decision.outcome).toBe("execute");
  });

  it("an un-seeded org default-DENIES the reallocation (fail safe)", async () => {
    const gate = buildGate([]);
    const decision = await gate.evaluate(reallocateWorkUnit(), reallocateRegistration());
    expect(decision.outcome).not.toBe("execute");
    expect(decision.outcome).not.toBe("require_approval");
  });

  it("the anchored reallocate rule does NOT bleed onto the pause intent", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()]);
    const pauseLike = {
      ...reallocateWorkUnit(),
      intent: "adoptimizer.campaign.pause",
    } as WorkUnit;
    const pauseReg = { ...reallocateRegistration(), intent: "adoptimizer.campaign.pause" };
    const decision = await gate.evaluate(pauseLike, pauseReg);
    // The reallocate policies must not match pause; with no pause policy seeded it default-denies.
    expect(decision.outcome).not.toBe("require_approval");
  });
});
