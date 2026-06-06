/**
 * Slice-4 — the brief-compose governance posture, exercised through the REAL
 * GovernanceGate + real policy engine + the REAL intent registration derived
 * from the REAL skills/mira/SKILL.md frontmatter (registerSkillIntents), NOT a
 * hand-built registration. Proves (spec 3.5):
 *
 *   - an org with NO seeded policies default-denies compose (the engine's
 *     default-deny baseline; the system actor is not blanket-trusted),
 *   - the seeded org-scoped compose allow policy makes compose execute,
 *   - an operator's org-scoped require_approval policy parks compose (the
 *     governance dial system_auto_approved would have removed),
 *
 * driven from the SAME rule constant the seed installs, so a seed change flows
 * into this test (feedback_safety_gate_needs_producer_population).
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration, IntentRegistry } from "@switchboard/core/platform";
import { registerSkillIntents } from "@switchboard/core/platform";
import { loadSkill } from "@switchboard/core/skill-runtime";
import { evaluate, resolveIdentity } from "@switchboard/core";
import {
  resolveTrustLevelOverride,
  resolveSpendAutonomyEnabled,
  type IdentitySpec,
  type Policy,
} from "@switchboard/schemas";
import {
  CREATIVE_GOVERNANCE_SETTINGS,
  CREATIVE_ALLOW_POLICY_RULE,
  CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE,
} from "@switchboard/db";

const ORG = "org-acme";
const SKILLS_DIR = new URL("../../../../skills", import.meta.url).pathname;

/** The seeded system principal's spec shape (bootstrap/system-identity.ts). */
function systemSpec(): IdentitySpec {
  return {
    id: "default",
    principalId: "system",
    organizationId: null,
    name: "Switchboard System",
    description: "Seeded system identity",
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    globalSpendLimits: { daily: 10_000, weekly: 50_000, monthly: 200_000, perAction: 5_000 },
    cartridgeSpendLimits: {},
    forbiddenBehaviors: [],
    trustBehaviors: [],
    delegatedApprovers: [],
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

/**
 * The REAL registration: load the real skills/mira/SKILL.md and run it through
 * the REAL registrar, capturing what production registers at boot. A frontmatter
 * drift (intent rename, a tool added flipping mutationClass to write) reds this
 * test instead of silently changing the governance posture.
 */
function composeRegistration(): IntentRegistration {
  const captured: IntentRegistration[] = [];
  const registry = { register: (r: IntentRegistration) => captured.push(r) };
  registerSkillIntents(registry as unknown as IntentRegistry, [loadSkill("mira", SKILLS_DIR)]);
  // The registrar emits the base intent plus an auto-generated `${slug}.respond`
  // companion (the managed-inbound entry point added in PR 1A-0), so the real Mira
  // SKILL.md now registers two intents. Assert both and return the base compose
  // registration the gate asserts against (drift on the base intent still reds this).
  expect(captured).toHaveLength(2);
  const compose = captured.find((r) => r.intent === "creative.brief.compose");
  expect(compose).toBeDefined();
  return compose!;
}

function policyFrom(rule: Record<string, unknown>, overrides: Partial<Policy> = {}): Policy {
  return {
    id: "policy_test",
    name: "test policy",
    description: "test",
    organizationId: ORG,
    cartridgeId: null,
    priority: 50,
    active: true,
    rule: rule as Policy["rule"],
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeComposeWorkUnit(): WorkUnit {
  return {
    id: "wu-compose-1",
    requestedAt: "2026-06-05T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: "creative.brief.compose",
    parameters: { composeSource: "weekly_scan" },
    deployment: {
      deploymentId: "dep-creative",
      skillSlug: "creative",
      trustLevel: "guided",
      trustScore: 0,
      // The seeded creative posture rides the same deployment; compose is
      // read-class with no spendAmount, so the spend lever stays a no-op.
      trustLevelOverride: resolveTrustLevelOverride(CREATIVE_GOVERNANCE_SETTINGS),
      spendAutonomyEnabled: resolveSpendAutonomyEnabled(CREATIVE_GOVERNANCE_SETTINGS),
    },
    resolvedMode: "skill",
    traceId: "trace-compose-1",
    trigger: "schedule",
    priority: "normal",
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

describe("mira brief-compose gate (real GovernanceGate + real registration)", () => {
  it("derives the registration from the real SKILL.md (read-class, skill mode, creative slug)", () => {
    const reg = composeRegistration();
    expect(reg.intent).toBe("creative.brief.compose");
    expect(reg.defaultMode).toBe("skill");
    expect(reg.executor).toEqual({ mode: "skill", skillSlug: "creative" });
    // Zero tools -> read-class -> no approval policy: the human gates live
    // downstream (draft funding, mandatory publish approval), not here.
    expect(reg.mutationClass).toBe("read");
    expect(reg.approvalPolicy).toBe("none");
    expect(reg.allowedTriggers).toContain("schedule");
    expect(reg.allowedTriggers).toContain("internal");
  });

  it("default-denies compose for an org with no seeded policies", async () => {
    const gate = buildGate([]);
    const decision = await gate.evaluate(makeComposeWorkUnit(), composeRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("executes compose when the seeded allow policy is installed", async () => {
    const gate = buildGate([
      policyFrom(CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE, {
        id: "policy_allow_creative_brief_compose_org-acme",
      }),
    ]);
    const decision = await gate.evaluate(makeComposeWorkUnit(), composeRegistration());
    expect(decision.outcome).toBe("execute");
  });

  it("the creative.job.* allow policy does NOT cover compose (separate dial)", async () => {
    const gate = buildGate([policyFrom(CREATIVE_ALLOW_POLICY_RULE, { id: "policy_allow_jobs" })]);
    const decision = await gate.evaluate(makeComposeWorkUnit(), composeRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("an operator's org-scoped require_approval policy parks compose (the dial stays real)", async () => {
    const gate = buildGate([
      policyFrom(CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE, { id: "policy_allow_compose" }),
      policyFrom(CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE, {
        id: "policy_park_compose",
        effect: "require_approval",
        approvalRequirement: "mandatory",
        priority: 40,
      }),
    ]);
    const decision = await gate.evaluate(makeComposeWorkUnit(), composeRegistration());
    expect(decision.outcome).toBe("require_approval");
  });

  it("require_approval wins regardless of priority order (override is sticky)", async () => {
    // Reversed priorities vs the case above: the allow runs FIRST (40), the
    // require_approval LAST (60). The engine's approval override is set-only
    // and never cleared, so the park still wins; this pins order-independence
    // rather than lower-number-wins.
    const gate = buildGate([
      policyFrom(CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE, {
        id: "policy_allow_compose",
        priority: 40,
      }),
      policyFrom(CREATIVE_BRIEF_COMPOSE_ALLOW_POLICY_RULE, {
        id: "policy_park_compose",
        effect: "require_approval",
        approvalRequirement: "mandatory",
        priority: 60,
      }),
    ]);
    const decision = await gate.evaluate(makeComposeWorkUnit(), composeRegistration());
    expect(decision.outcome).toBe("require_approval");
  });
});
