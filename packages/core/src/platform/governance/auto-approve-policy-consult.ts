import type { Policy } from "@switchboard/schemas";
import { evaluateRule, type EvaluationContext } from "../../engine/rule-evaluator.js";
import type { GovernanceDecision, ExecutionConstraints } from "../governance-types.js";

/**
 * The identity-free org-policy consult for the `system_auto_approved` short-circuit.
 *
 * P3-6 (second-wave gap-eval): an auto-approved intent flagged
 * `consultOrgPolicyOnAutoApprove` (today only `creative.concept.draft`) returns
 * `execute` from the gate's short-circuit BEFORE the policy engine runs, so an
 * operator's org-scoped DENY / require_approval Policy — the per-org governance dial
 * its sibling `creative.brief.compose` already honors — was never consulted. This
 * function restores that dial for the auto-approve path.
 *
 * It replicates ONLY the org-policy decision layer of `PolicyEngine.evaluatePolicies`
 * (engine/policy-engine.ts): active policies, ascending `priority`, the same
 * `cartridgeId` scoping, a matched `deny` wins regardless of order/priority (the
 * engine's locked invariant — engine-policy-conflict.test.ts), a matched
 * `require_approval` parks. It deliberately does NOT run the identity / forbidden /
 * trust / risk layers the full path runs, because:
 *   1. the auto-approve short-circuit skips those layers BY DESIGN, and
 *   2. the draft child is also submitted by Alex's delegate tool with an UNSEEDED
 *      agent actor — the full path's `loadIdentitySpec` throws on a missing spec and
 *      hard-denies. Consulting only the org-policy layer keeps the dial real without
 *      regressing that path.
 *
 * Returns the synthesized deny / require_approval decision, or `null` when no org
 * policy denies or parks the action — in which case the caller short-circuits to
 * `execute` (the default-org auto-approve fast path is unchanged). The synthesized
 * `require_approval` mirrors `decision-adapter.ts` (empty `approvers`).
 */
export function consultAutoApproveOrgPolicy(
  policies: Policy[],
  evalContext: EvaluationContext,
  constraints: ExecutionConstraints,
): GovernanceDecision | null {
  const sorted = [...policies].filter((p) => p.active).sort((a, b) => a.priority - b.priority);

  const matchedPolicies: string[] = [];
  let approvalLevel: string | null = null;

  for (const policy of sorted) {
    // Cartridge-scoped policies only apply to their cartridge (mirrors the engine).
    if (policy.cartridgeId && policy.cartridgeId !== evalContext.cartridgeId) continue;
    if (!evaluateRule(policy.rule, evalContext).matched) continue;

    matchedPolicies.push(policy.id);

    if (policy.effect === "deny") {
      // Deny wins regardless of order/priority — return immediately.
      return { outcome: "deny", reasonCode: policy.id, riskScore: 0, matchedPolicies };
    }
    if (policy.effect === "require_approval" && policy.approvalRequirement) {
      approvalLevel = policy.approvalRequirement;
    }
    // "allow" / "modify": not a deny or a park for this layer — keep scanning; the
    // absence of a deny/require_approval ultimately resolves to execute (null).
  }

  if (approvalLevel !== null) {
    return {
      outcome: "require_approval",
      riskScore: 0,
      approvalLevel,
      approvers: [],
      constraints,
      matchedPolicies,
    };
  }

  return null;
}
