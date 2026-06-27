/**
 * P3-6 producer + end-to-end proof for the creative.concept.draft per-org
 * governance dial.
 *
 * The GovernanceGate consult (consultAutoApproveOrgPolicy) only fires for an intent
 * registered with consultOrgPolicyOnAutoApprove: true. This test captures what
 * bootstrapContainedWorkflows ACTUALLY registers for creative.concept.draft (the real
 * producer) and proves:
 *   - the registration carries approvalMode:"system_auto_approved" AND the new flag
 *     (so the dial is not silently inert — feedback_safety_gate_needs_producer_population),
 *   - driven through the REAL GovernanceGate, an org-scoped DENY policy denies the
 *     draft while an org with no matching policy still executes (fast path preserved).
 */
import { describe, it, expect } from "vitest";
import {
  GovernanceGate,
  ExecutionModeRegistry,
  type GovernanceGateDeps,
  type IntentRegistry,
  type IntentRegistration,
  type PlatformIngress,
  type WorkUnit,
  type WorkTraceStore,
} from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import { bootstrapContainedWorkflows } from "../bootstrap/contained-workflows.js";

const ORG = "org-acme";

async function captureConceptDraftRegistration(): Promise<IntentRegistration> {
  const captured: IntentRegistration[] = [];
  const intentRegistry = {
    register: (r: IntentRegistration) => captured.push(r),
  } as unknown as IntentRegistry;

  await bootstrapContainedWorkflows({
    prismaClient: {},
    intentRegistry,
    modeRegistry: new ExecutionModeRegistry(),
    platformIngress: {} as unknown as PlatformIngress,
    deploymentResolver: null,
    workTraceStore: {
      getByWorkUnitId: async () => null,
    } as unknown as Pick<WorkTraceStore, "getByWorkUnitId">,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });

  const reg = captured.find((r) => r.intent === "creative.concept.draft");
  expect(reg, "bootstrap must register creative.concept.draft").toBeDefined();
  return reg!;
}

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

function draftWorkUnit(): WorkUnit {
  return {
    id: "wu-draft-1",
    requestedAt: "2026-06-27T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: "creative.concept.draft",
    parameters: { brief: { productDescription: "Botox", targetAudience: "women 30-45" } },
    deployment: {
      deploymentId: "dep-creative",
      skillSlug: "creative",
      trustLevel: "guided",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace-draft-1",
    trigger: "internal",
    priority: "normal",
  };
}

function denyPolicy(): Policy {
  return {
    id: "policy_deny_creative_concept_draft_org-acme",
    name: "Pause Mira concept drafts",
    description: "Operator throttle",
    organizationId: ORG,
    cartridgeId: null,
    priority: 30,
    active: true,
    rule: {
      conditions: [
        { field: "actionType", operator: "matches", value: "^creative\\.concept\\.draft$" },
      ],
    } as Policy["rule"],
    effect: "deny",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

describe("creative.concept.draft per-org governance dial (P3-6)", () => {
  it("registers the draft handoff with system_auto_approved AND the org-policy consult flag", async () => {
    const reg = await captureConceptDraftRegistration();
    expect(reg.approvalMode).toBe("system_auto_approved");
    expect(reg.consultOrgPolicyOnAutoApprove).toBe(true);
  });

  it("an org-scoped DENY policy denies the draft through the real gate (the dial is live)", async () => {
    const reg = await captureConceptDraftRegistration();
    const decision = await buildGate([denyPolicy()]).evaluate(draftWorkUnit(), reg);
    expect(decision.outcome).toBe("deny");
  });

  it("an org with no matching policy still auto-executes the draft (fast path preserved)", async () => {
    const reg = await captureConceptDraftRegistration();
    const decision = await buildGate([]).evaluate(draftWorkUnit(), reg);
    expect(decision.outcome).toBe("execute");
  });
});
