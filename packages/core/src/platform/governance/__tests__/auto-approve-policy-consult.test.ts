import { describe, it, expect } from "vitest";
import { consultAutoApproveOrgPolicy } from "../auto-approve-policy-consult.js";
import { DEFAULT_CARTRIDGE_CONSTRAINTS } from "../default-constraints.js";
import type { EvaluationContext } from "../../../engine/rule-evaluator.js";
import type { Policy } from "@switchboard/schemas";

// consultAutoApproveOrgPolicy is the identity-free org-policy layer the
// system_auto_approved short-circuit consults for an opted-in intent
// (consultOrgPolicyOnAutoApprove). It replicates ONLY the deny / require_approval
// selection of PolicyEngine.evaluatePolicies (engine/policy-engine.ts): active
// policies, ascending priority, a matched deny wins regardless of order (the
// engine's locked invariant), a matched require_approval parks, allow / no-match
// returns null so the caller short-circuits to execute. It deliberately does NOT
// run the identity / forbidden / risk layers, because the auto-approve path skips
// those by design (and the agent-actor draft child has no seeded IdentitySpec).

const ORG = "org-acme";
const INTENT = "creative.concept.draft";

function evalContext(over: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    actionType: INTENT,
    parameters: {},
    cartridgeId: "creative",
    principalId: "system",
    organizationId: ORG,
    riskCategory: "low",
    metadata: {},
    ...over,
  };
}

function policy(over: Partial<Policy> = {}): Policy {
  return {
    id: "p_test",
    name: "test",
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
    effect: "allow",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

describe("consultAutoApproveOrgPolicy", () => {
  it("returns null when there are no policies (caller executes)", () => {
    expect(
      consultAutoApproveOrgPolicy([], evalContext(), DEFAULT_CARTRIDGE_CONSTRAINTS),
    ).toBeNull();
  });

  it("returns null when no active policy matches the action (caller executes)", () => {
    const other = policy({
      id: "p_other",
      rule: {
        conditions: [
          { field: "actionType", operator: "matches", value: "^creative\\.job\\.submit$" },
        ],
      } as Policy["rule"],
      effect: "deny",
    });
    expect(
      consultAutoApproveOrgPolicy([other], evalContext(), DEFAULT_CARTRIDGE_CONSTRAINTS),
    ).toBeNull();
  });

  it("returns null when only a matching allow policy is present (caller executes)", () => {
    expect(
      consultAutoApproveOrgPolicy(
        [policy({ id: "p_allow", effect: "allow" })],
        evalContext(),
        DEFAULT_CARTRIDGE_CONSTRAINTS,
      ),
    ).toBeNull();
  });

  it("denies on a matching deny policy and reports the policy id", () => {
    const decision = consultAutoApproveOrgPolicy(
      [policy({ id: "p_deny", effect: "deny" })],
      evalContext(),
      DEFAULT_CARTRIDGE_CONSTRAINTS,
    );
    expect(decision?.outcome).toBe("deny");
    expect(decision?.matchedPolicies).toContain("p_deny");
  });

  it("deny wins over a higher-priority (lower number) allow", () => {
    // The engine's locked invariant: among matched policies, deny wins regardless
    // of priority order. Allow runs first (priority 10) then deny (priority 90).
    const decision = consultAutoApproveOrgPolicy(
      [
        policy({ id: "p_allow", effect: "allow", priority: 10 }),
        policy({ id: "p_deny", effect: "deny", priority: 90 }),
      ],
      evalContext(),
      DEFAULT_CARTRIDGE_CONSTRAINTS,
    );
    expect(decision?.outcome).toBe("deny");
  });

  it("parks on a matching require_approval policy (approvers empty, level from the policy)", () => {
    const decision = consultAutoApproveOrgPolicy(
      [policy({ id: "p_park", effect: "require_approval", approvalRequirement: "mandatory" })],
      evalContext(),
      DEFAULT_CARTRIDGE_CONSTRAINTS,
    );
    expect(decision?.outcome).toBe("require_approval");
    if (decision?.outcome === "require_approval") {
      expect(decision.approvalLevel).toBe("mandatory");
      expect(decision.approvers).toEqual([]);
    }
  });

  it("ignores an INACTIVE deny policy (caller executes)", () => {
    expect(
      consultAutoApproveOrgPolicy(
        [policy({ id: "p_deny", effect: "deny", active: false })],
        evalContext(),
        DEFAULT_CARTRIDGE_CONSTRAINTS,
      ),
    ).toBeNull();
  });

  it("ignores a deny scoped to a DIFFERENT cartridge", () => {
    const decision = consultAutoApproveOrgPolicy(
      [policy({ id: "p_deny", effect: "deny", cartridgeId: "other-cartridge" })],
      evalContext({ cartridgeId: "creative" }),
      DEFAULT_CARTRIDGE_CONSTRAINTS,
    );
    expect(decision).toBeNull();
  });
});
