import { describe, it, expect } from "vitest";
import { GovernanceGate } from "../governance-gate.js";
import type { GovernanceGateDeps } from "../governance-gate.js";
import type { WorkUnit } from "../../work-unit.js";
import type { IntentRegistration } from "../../intent-registration.js";
import { SpendBearingAutoApproveError } from "../../intent-registration.js";
import { evaluate } from "../../../engine/policy-engine.js";
import { resolveIdentity } from "../../../identity/spec.js";
import type { IdentitySpec, Policy } from "@switchboard/schemas";

// D9-2: a system_auto_approved intent must NEVER ride the short-circuit when it is
// financial, because the short-circuit returns execute BEFORE the downstream spend
// gate (applySpendApprovalThreshold over extractSpendAmount). The pre-existing F4
// guard (assertNotSpendBearingAutoApprove) only catches a STATICALLY declared
// spendBearing:true registration; these tests pin the RUNTIME guard that also
// refuses an undeclared intent whose call parameters carry a spend amount, or that
// belongs to a money-move family by intent prefix.
//
// The harness drives the REAL GovernanceGate with the REAL policy engine and
// identity resolver (not spies), so "no policies => default-deny" and "seeded
// require_approval policy => park" are genuine end-to-end outcomes.

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

function gateDeps(over: Partial<GovernanceGateDeps> = {}): GovernanceGateDeps {
  return {
    evaluate,
    resolveIdentity,
    loadPolicies: async () => [],
    loadIdentitySpec: async () => ({ spec: systemSpec(), overlays: [] }),
    loadCartridge: async () => null,
    getGovernanceProfile: async () => null,
    ...over,
  };
}

// In production a WorkUnit and its IntentRegistration always share the same
// intent (the platform builds the work unit from the registered intent), so the
// helper keeps them aligned: the policy engine matches on proposal.actionType
// (= workUnit.intent), and the denylist guard reads registration.intent.
function workUnit(parameters: Record<string, unknown>, intent = "test.intent"): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: "2026-06-06T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent,
    parameters,
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace-1",
    trigger: "internal",
    priority: "normal",
  };
}

function autoApproved(over: Partial<IntentRegistration> = {}): IntentRegistration {
  return {
    intent: "test.intent",
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: "test.intent" },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "none",
    approvalMode: "system_auto_approved",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
    ...over,
  };
}

const REALLOCATE_INTENT = "adoptimizer.campaign.reallocate";

const reallocate: Partial<IntentRegistration> = {
  intent: REALLOCATE_INTENT,
  executor: { mode: "workflow", workflowId: REALLOCATE_INTENT },
};

const PAUSE_INTENT = "adoptimizer.campaign.pause";

const pause: Partial<IntentRegistration> = {
  intent: PAUSE_INTENT,
  executor: { mode: "workflow", workflowId: PAUSE_INTENT },
};

/** A seeded require_approval(mandatory) + allow pair for the reallocate action,
 *  mirroring the riley-pause seed shape: the allow makes the policy path non-deny,
 *  the require_approval escalates approval to mandatory => outcome require_approval. */
function seededReallocatePolicies(): Policy[] {
  const rule = {
    conditions: [
      {
        field: "actionType",
        operator: "matches" as const,
        value: "^adoptimizer\\.campaign\\.reallocate$",
      },
    ],
  };
  return [
    {
      id: "p_appr",
      name: "reallocate-approval",
      description: "",
      organizationId: ORG,
      cartridgeId: null,
      priority: 40,
      active: true,
      rule,
      effect: "require_approval",
      approvalRequirement: "mandatory",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    {
      id: "p_allow",
      name: "reallocate-allow",
      description: "",
      organizationId: ORG,
      cartridgeId: null,
      priority: 50,
      active: true,
      rule,
      effect: "allow",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
  ];
}

/** A seeded require_approval(mandatory) + allow pair for the pause action, mirroring the
 *  production riley-pause-governance seed: the allow makes the policy path non-deny, the
 *  require_approval escalates approval to mandatory => outcome require_approval. */
function seededPausePolicies(): Policy[] {
  const rule = {
    conditions: [
      {
        field: "actionType",
        operator: "matches" as const,
        value: "^adoptimizer\\.campaign\\.pause$",
      },
    ],
  };
  return [
    {
      id: "p_pause_appr",
      name: "pause-approval",
      description: "",
      organizationId: ORG,
      cartridgeId: null,
      priority: 40,
      active: true,
      rule,
      effect: "require_approval",
      approvalRequirement: "mandatory",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    {
      id: "p_pause_allow",
      name: "pause-allow",
      description: "",
      organizationId: ORG,
      cartridgeId: null,
      priority: 50,
      active: true,
      rule,
      effect: "allow",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
  ];
}

describe("GovernanceGate system_auto_approved financial-intent guard (D9-2)", () => {
  it("still executes a non-financial system_auto_approved intent (short-circuit unchanged)", async () => {
    const gate = new GovernanceGate(gateDeps());

    const decision = await gate.evaluate(workUnit({ note: "draft only" }), autoApproved());

    expect(decision.outcome).toBe("execute");
  });

  it("refuses the short-circuit for an intent carrying a runtime OUTBOUND spend key", async () => {
    // spendBearing is NOT declared, so the F4 registration throw cannot fire; the
    // runtime outbound spend key (spendAmount) is the only signal. With no policies
    // the real policy path default-denies, proving the short-circuit was refused (a
    // bare execute would mean the guard never fired). This case executes on main today.
    const gate = new GovernanceGate(gateDeps());

    const decision = await gate.evaluate(workUnit({ spendAmount: 250 }), autoApproved());

    expect(decision.outcome).not.toBe("execute");
    expect(decision.outcome).toBe("deny");
  });

  it("STILL executes an auto-approved intent carrying only a generic inbound amount", async () => {
    // operator.record_revenue is registered system_auto_approved + write and submits
    // parameters.amount (inbound money-recording, NOT outbound spend). The generic
    // "amount" key is deliberately excluded from the guard, so revenue recording keeps
    // short-circuiting. Without this exclusion the guard would force it through the
    // policy path and default-deny every revenue write (intent-registration.ts mandates
    // inbound money-recording stays auto-approved). This is the regression pin for that.
    const gate = new GovernanceGate(gateDeps());

    const decision = await gate.evaluate(
      workUnit({ amount: 250, currency: "SGD" }),
      autoApproved(),
    );

    expect(decision.outcome).toBe("execute");
  });

  it("refuses the short-circuit for a denylisted money-move intent with no extractable amount", async () => {
    const gate = new GovernanceGate(gateDeps());

    const decision = await gate.evaluate(
      workUnit({ campaignId: "camp_1" }, REALLOCATE_INTENT),
      autoApproved(reallocate),
    );

    expect(decision.outcome).not.toBe("execute");
    expect(decision.outcome).toBe("deny");
  });

  it("refuses the short-circuit for the self-executing PAUSE intent (defense-in-depth)", async () => {
    // A self-executing pause is money-affecting (it stops spend on a campaign) and must never
    // ride the system_auto_approved short-circuit, even though it carries no outbound spend
    // delta. It is already human-gated by its seeded mandatory require_approval policy; the
    // denylist is the STRUCTURAL backstop if that policy is ever stripped/misconfigured.
    const gate = new GovernanceGate(gateDeps());

    const decision = await gate.evaluate(
      workUnit({ campaignId: "camp_1" }, PAUSE_INTENT),
      autoApproved(pause),
    );

    expect(decision.outcome).not.toBe("execute");
    expect(decision.outcome).toBe("deny");
  });

  it("parks the refused financial intent under a seeded require_approval policy (reaches the human gate)", async () => {
    const gate = new GovernanceGate(
      gateDeps({ loadPolicies: async () => seededReallocatePolicies() }),
    );

    const decision = await gate.evaluate(
      workUnit({ spendAmount: 250 }, REALLOCATE_INTENT),
      autoApproved(reallocate),
    );

    expect(decision.outcome).toBe("require_approval");
  });

  it("parks a denylisted PAUSE under its seeded mandatory policy (the real production path)", async () => {
    // Production reality for pause: the seeded mandatory require_approval policy reaches the
    // human gate. The denylist refuses the auto-approve short-circuit, so the seeded policy
    // governs and the outcome is require_approval (not an auto-execute).
    const gate = new GovernanceGate(gateDeps({ loadPolicies: async () => seededPausePolicies() }));

    const decision = await gate.evaluate(
      workUnit({ campaignId: "camp_1" }, PAUSE_INTENT),
      autoApproved(pause),
    );

    expect(decision.outcome).toBe("require_approval");
  });

  it("still throws the F4 error for a statically spend-bearing registration (throw and runtime guard coexist)", async () => {
    // The registration-time guard covers a DECLARED spend-bearing intent even with
    // no runtime amount; the runtime guard covers an UNDECLARED one that carries an
    // amount or is denylisted. This pins that the louder throw still fires first and
    // is not swallowed by the new fall-through.
    const gate = new GovernanceGate(gateDeps());

    await expect(
      gate.evaluate(
        workUnit({ note: "no runtime amount at all" }),
        autoApproved({ spendBearing: true }),
      ),
    ).rejects.toThrow(SpendBearingAutoApproveError);
  });
});
