import { describe, it, expect } from "vitest";
import { GovernanceGate } from "../governance-gate.js";
import type { GovernanceGateDeps } from "../governance-gate.js";
import type { WorkUnit } from "../../work-unit.js";
import type { IntentRegistration } from "../../intent-registration.js";
import { evaluate } from "../../../engine/policy-engine.js";
import { resolveIdentity } from "../../../identity/spec.js";
import type { IdentitySpec, Policy } from "@switchboard/schemas";

// P3-6: a system_auto_approved intent flagged `consultOrgPolicyOnAutoApprove` must
// still honor an org-scoped DENY / require_approval Policy — the per-org governance
// dial — BEFORE its execute short-circuit, but WITHOUT running identity resolution.
//
// The draft-only Alex->Mira handoff (creative.concept.draft) is the opted-in intent:
// it is also submitted by the delegate tool with an UNSEEDED agent actor, so routing
// it through the full policy path (which calls loadIdentitySpec) would throw and
// hard-deny. These tests pin: (1) the dial is now consulted (deny/park), (2) the
// default-org fast path is unchanged (no policy => execute), (3) only the flagged
// intent is affected, and (4) the consult never resolves identity.
//
// Driven by the REAL GovernanceGate + REAL policy engine + REAL identity resolver.

const ORG = "org-acme";
const DRAFT_INTENT = "creative.concept.draft";

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

function workUnit(
  intent = DRAFT_INTENT,
  actor: WorkUnit["actor"] = { id: "system", type: "system" },
  parameters: Record<string, unknown> = { brief: { productDescription: "x", targetAudience: "y" } },
): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: "2026-06-27T00:00:00.000Z",
    organizationId: ORG,
    actor,
    intent,
    parameters,
    deployment: {
      deploymentId: "dep-1",
      skillSlug: "creative",
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
    intent: DRAFT_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: DRAFT_INTENT },
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

/** Flagged registration: the production posture for creative.concept.draft. */
function draftReg(over: Partial<IntentRegistration> = {}): IntentRegistration {
  return autoApproved({ consultOrgPolicyOnAutoApprove: true, ...over });
}

function policyForDraft(effect: Policy["effect"], over: Partial<Policy> = {}): Policy {
  return {
    id: `p_${effect}`,
    name: `${effect} draft`,
    description: "",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: {
      conditions: [
        { field: "actionType", operator: "matches", value: "^creative\\.concept\\.draft$" },
      ],
    } as Policy["rule"],
    effect,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

describe("GovernanceGate auto-approve org-policy dial (P3-6)", () => {
  it("executes a flagged auto-approved intent when no org policy matches (fast path preserved)", async () => {
    const gate = new GovernanceGate(gateDeps());
    const decision = await gate.evaluate(workUnit(), draftReg());
    expect(decision.outcome).toBe("execute");
  });

  it("denies a flagged auto-approved intent under an org-scoped DENY policy (the gap fix)", async () => {
    const gate = new GovernanceGate(
      gateDeps({ loadPolicies: async () => [policyForDraft("deny")] }),
    );
    const decision = await gate.evaluate(workUnit(), draftReg());
    expect(decision.outcome).toBe("deny");
  });

  it("parks a flagged auto-approved intent under an org-scoped require_approval policy", async () => {
    const gate = new GovernanceGate(
      gateDeps({
        loadPolicies: async () => [
          policyForDraft("require_approval", { approvalRequirement: "mandatory" }),
        ],
      }),
    );
    const decision = await gate.evaluate(workUnit(), draftReg());
    expect(decision.outcome).toBe("require_approval");
  });

  it("does NOT consult policies for a NON-flagged auto-approved intent (scoping: still executes under a deny)", async () => {
    // Same deny policy, but the registration is NOT flagged: every other
    // system_auto_approved intent keeps the unconditional short-circuit (no added
    // loadPolicies, no deny-consult). This pins that the change is scoped.
    const gate = new GovernanceGate(
      gateDeps({ loadPolicies: async () => [policyForDraft("deny")] }),
    );
    const decision = await gate.evaluate(workUnit(), autoApproved());
    expect(decision.outcome).toBe("execute");
  });

  it("consults the dial WITHOUT resolving identity (unseeded agent actor, loadIdentitySpec throws)", async () => {
    // The delegate-tool path submits with an unseeded agent actor. If the consult
    // resolved identity, loadIdentitySpec would throw and the evaluate() would reject.
    // It must not: deny is reached purely from the org-policy layer.
    const throwingIdentity = gateDeps({
      loadIdentitySpec: async () => {
        throw new Error("Identity spec not found: alex-dep");
      },
      loadPolicies: async () => [policyForDraft("deny")],
    });
    const agentActor: WorkUnit["actor"] = { id: "alex-dep", type: "agent" };
    const gate = new GovernanceGate(throwingIdentity);
    const decision = await gate.evaluate(workUnit(DRAFT_INTENT, agentActor), draftReg());
    expect(decision.outcome).toBe("deny");
  });

  it("executes the unseeded-agent-actor fast path WITHOUT resolving identity (no policy, no throw)", async () => {
    const throwingIdentity = gateDeps({
      loadIdentitySpec: async () => {
        throw new Error("Identity spec not found: alex-dep");
      },
      loadPolicies: async () => [],
    });
    const agentActor: WorkUnit["actor"] = { id: "alex-dep", type: "agent" };
    const gate = new GovernanceGate(throwingIdentity);
    const decision = await gate.evaluate(workUnit(DRAFT_INTENT, agentActor), draftReg());
    expect(decision.outcome).toBe("execute");
  });
});
