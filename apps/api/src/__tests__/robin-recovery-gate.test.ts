/**
 * robin.recovery_campaign.send, exercised through the REAL GovernanceGate + policy engine (NOT a spy
 * ingress). Proves the Robin v1 mass-outbound approval gate (mirrors riley-reallocate-gate):
 *   - allow + approval policies + seeded system principal -> parks at MANDATORY,
 *   - allow ALONE -> executes (approval policy is load-bearing; never seed one without the other),
 *   - an un-seeded org -> default-DENY (fail safe).
 * The work unit is built from the REAL producer chain (no-show rows -> selectRecoveryCandidates ->
 * buildRecoveryCampaignSubmitRequest), so this test and the producer cannot drift, and it documents
 * the full producer->consumer seam. The deployment context is the platform-direct shape the resolver
 * produces for Robin (see platform-deployment-resolver.test.ts, which proves the carve-out so this
 * intent never throws deployment_not_found in prod).
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity, selectRecoveryCandidates } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  buildRobinRecoveryAllowPolicyInput,
  buildRobinRecoveryApprovalPolicyInput,
} from "@switchboard/db";
import {
  ROBIN_RECOVERY_SEND_INTENT,
  buildRecoveryCampaignSubmitRequest,
} from "../services/workflows/robin-recovery-request.js";

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
    ...buildRobinRecoveryAllowPolicyInput(ORG),
    cartridgeId: null,
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

function approvalPolicy(): Policy {
  return {
    ...buildRobinRecoveryApprovalPolicyInput(ORG),
    cartridgeId: null,
    effect: "require_approval",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as Policy;
}

// The gate consumes the REAL producer output, driven through the full seam: a no-show cohort row ->
// selectRecoveryCandidates (exclude rebooked, dedupe) -> buildRecoveryCampaignSubmitRequest. This is
// the producer->consumer wire the slice ships; building the work unit this way proves it end to end.
function recoveryParameters(): Record<string, unknown> {
  const noShowRows = [
    {
      bookingId: "bk_1",
      contactId: "ct_1",
      service: "Botox",
      startsAt: new Date("2026-06-03T09:00:00Z"),
      attendeeName: "Jamie",
    },
  ];
  const cohort = selectRecoveryCandidates(noShowRows, {
    existingFutureBookingContactIds: new Set(),
  });
  const req = buildRecoveryCampaignSubmitRequest({
    organizationId: ORG,
    windowFrom: new Date("2026-06-01T00:00:00Z"),
    windowTo: new Date("2026-06-08T00:00:00Z"),
    candidates: cohort,
  });
  if (!req) throw new Error("expected a non-null recovery campaign submit request");
  return req.parameters as Record<string, unknown>;
}

function recoveryWorkUnit(): WorkUnit {
  return {
    id: "wu-recovery-1",
    requestedAt: "2026-06-08T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: ROBIN_RECOVERY_SEND_INTENT,
    parameters: recoveryParameters(),
    // The platform-direct context the resolver produces for Robin (no seeded deployment). supervised
    // / trustScore 0 is the least autonomous context, so it can only make the gate more conservative.
    deployment: {
      deploymentId: "platform-direct",
      skillSlug: "robin",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace-recovery-1",
    trigger: "schedule",
    priority: "normal",
  } as WorkUnit;
}

function recoveryRegistration(): IntentRegistration {
  return {
    intent: ROBIN_RECOVERY_SEND_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: ROBIN_RECOVERY_SEND_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["schedule"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

function buildGate(policies: Policy[]): GovernanceGate {
  const deps: GovernanceGateDeps = {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => policies,
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
  };
  return new GovernanceGate(deps);
}

describe("robin.recovery_campaign.send governance gate (real engine)", () => {
  it("parks at MANDATORY with the seeded allow + require_approval policies", async () => {
    const gate = buildGate([allowPolicy(), approvalPolicy()]);
    const decision = await gate.evaluate(recoveryWorkUnit(), recoveryRegistration());
    expect(decision.outcome).toBe("require_approval");
    if (decision.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
    }
  });

  it("consumes the REAL producer's parameters: the no-show cohort + recipientCount reach the gate", () => {
    const params = recoveryParameters();
    expect(params.recipientCount).toBe(1);
    expect((params.candidates as Array<{ bookingId: string }>)[0]!.bookingId).toBe("bk_1");
  });

  it("allow ALONE EXECUTES (documents the approval policy is load-bearing - never seed one without the other)", async () => {
    const gate = buildGate([allowPolicy()]);
    const decision = await gate.evaluate(recoveryWorkUnit(), recoveryRegistration());
    expect(decision.outcome).toBe("execute");
  });

  it("an un-seeded org default-DENIES the recovery campaign (fail safe)", async () => {
    const gate = buildGate([]);
    const decision = await gate.evaluate(recoveryWorkUnit(), recoveryRegistration());
    expect(decision.outcome).not.toBe("execute");
    expect(decision.outcome).not.toBe("require_approval");
  });
});
