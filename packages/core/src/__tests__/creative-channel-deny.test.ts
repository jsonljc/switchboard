import { describe, it, expect } from "vitest";

import { evaluate, createGuardrailState } from "../index.js";

import type { EvaluationContext, PolicyEngineContext, ResolvedIdentity } from "../index.js";

import type { RiskInput, IdentitySpec, Policy, ActionProposal } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Why this file exists
//
// The invariant that a CONVERSATIONAL channel (whatsapp / telegram / slack) must
// NOT route a spend-capable creative intent (creative.job.submit, the render-cost
// step) or a creative reasoning intent (creative.brief.compose) holds today only
// because the policy engine DEFAULT-DENIES any intent no allow policy matches
// (policy-engine.ts:588), and the org-scoped creative allow policies are seeded
// ONLY on the dedicated Mira creative deployment (seedMiraCreativeDeployment),
// never on a conversational inbound deployment. No test pinned this, so a seed
// flip that broadened a creative allow policy (or attached one to a conversational
// org) could silently regress it.
//
// These tests pin the invariant at the decision engine: with the policy set a
// conversational surface actually carries (NO creative allow policy), a creative
// intent submitted via that surface is DENIED. The load-bearing control at the
// bottom proves the assertion is not vacuous: it FLIPS to a non-deny the moment a
// broad creative allow policy is introduced, which is exactly the seed-flip
// regression these pins guard against.
// ---------------------------------------------------------------------------

function makeBaseIdentitySpec(overrides: Partial<IdentitySpec> = {}): IdentitySpec {
  return {
    id: "spec-1",
    principalId: "user-1",
    organizationId: "org-1",
    name: "Conversational Agent",
    description: "Inbound conversational identity (no creative allowances)",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: {
      daily: 10000,
      weekly: 50000,
      monthly: 200000,
      perAction: 5000,
    },
    cartridgeSpendLimits: {},
    // A conversational deployment does NOT trust or forbid creative job/brief
    // intents by name; the deny it relies on is policy default-deny, not a
    // forbidden-behavior list. Keep both empty so the deny under test is the
    // default-deny path, not an unrelated forbidden-behavior short-circuit.
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeResolvedIdentity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  const spec = makeBaseIdentitySpec();
  return {
    spec,
    activeOverlays: [],
    effectiveRiskTolerance: { ...spec.riskTolerance },
    effectiveSpendLimits: { ...spec.globalSpendLimits },
    effectiveForbiddenBehaviors: [...spec.forbiddenBehaviors],
    effectiveTrustBehaviors: [...spec.trustBehaviors],
    delegatedApprovers: [],
    ...overrides,
  };
}

function makeRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    ...overrides,
  };
}

/**
 * Evaluation context for a creative intent arriving through a CONVERSATIONAL
 * surface. The conversational channel identity is carried on `metadata.channel`
 * (the channel gateway submits inbound chat with the originating channel), and
 * `metadata.surface` echoes the surface kind. The engine treats metadata as
 * adjudication context; the deny under test comes from policy default-deny, but
 * stamping the channel keeps the pin honest about the scenario it guards.
 */
function makeConversationalEvalContext(
  overrides: Partial<EvaluationContext> = {},
): EvaluationContext {
  return {
    actionType: "creative.job.submit",
    parameters: { estimatedSpendUsd: 8 },
    cartridgeId: "creative-pipeline",
    principalId: "user-1",
    organizationId: "org-1",
    riskCategory: "medium",
    metadata: { channel: "whatsapp", surface: "conversational" },
    ...overrides,
  };
}

function makeProposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "action-1",
    actionType: "creative.job.submit",
    parameters: { estimatedSpendUsd: 8 },
    evidence: "Inbound conversational message",
    confidence: 0.95,
    originatingMessageId: "msg-1",
    ...overrides,
  };
}

function makeEngineContext(overrides: Partial<PolicyEngineContext> = {}): PolicyEngineContext {
  return {
    // The conversational deployment's policy set: NO creative allow policy. This
    // is the seed reality the invariant rides on.
    policies: [],
    guardrails: null,
    guardrailState: createGuardrailState(),
    resolvedIdentity: makeResolvedIdentity(),
    riskInput: makeRiskInput(),
    now: new Date(),
    ...overrides,
  };
}

describe("creative-channel deny invariant (conversational surfaces)", () => {
  it("denies creative.job.submit submitted via a conversational/whatsapp surface", () => {
    const ctx = makeConversationalEvalContext({
      actionType: "creative.job.submit",
      metadata: { channel: "whatsapp", surface: "conversational" },
    });
    const proposal = makeProposal({ actionType: "creative.job.submit" });
    const engineCtx = makeEngineContext();

    const trace = evaluate(proposal, ctx, engineCtx);

    // The spend-capable render step must never auto-route from a chat channel.
    expect(trace.finalDecision).toBe("deny");
  });

  it("denies creative.brief.compose submitted via a telegram surface", () => {
    const ctx = makeConversationalEvalContext({
      actionType: "creative.brief.compose",
      parameters: {},
      metadata: { channel: "telegram", surface: "conversational" },
    });
    const proposal = makeProposal({
      actionType: "creative.brief.compose",
      parameters: {},
    });
    const engineCtx = makeEngineContext();

    const trace = evaluate(proposal, ctx, engineCtx);

    expect(trace.finalDecision).toBe("deny");
  });

  // -------------------------------------------------------------------------
  // Load-bearing control: the pins above are NOT vacuous.
  //
  // This mirrors the SHAPE of the seed's creative allow policy
  // (CREATIVE_ALLOW_POLICY_RULE in db/seed/creative-governance.ts:46, where
  // actionType matches "creative.job.*", effect "allow"). It is the exact thing a
  // seed flip would attach. When such a policy is in scope, the same
  // creative.job.submit no longer default-denies, proving the deny the two pins
  // assert is the policy default-deny, and that those pins would FAIL the moment
  // the deny is removed by broadening/attaching a creative allow policy to a
  // conversational surface.
  // -------------------------------------------------------------------------
  it("the deny is load-bearing: a broad creative allow policy flips it away from deny", () => {
    const broadCreativeAllow: Policy = {
      id: "policy-allow-creative-broad",
      name: "Allow creative pipeline actions",
      description: "Mirrors the seeded creative.job.* allow policy.",
      organizationId: "org-1",
      cartridgeId: null,
      priority: 50,
      active: true,
      rule: {
        composition: "AND",
        conditions: [{ field: "actionType", operator: "matches", value: "creative.job.*" }],
        children: [],
      },
      effect: "allow",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    };

    const ctx = makeConversationalEvalContext({ actionType: "creative.job.submit" });
    const proposal = makeProposal({ actionType: "creative.job.submit" });
    const engineCtx = makeEngineContext({ policies: [broadCreativeAllow] });

    const trace = evaluate(proposal, ctx, engineCtx);

    expect(trace.finalDecision).not.toBe("deny");
  });
});
