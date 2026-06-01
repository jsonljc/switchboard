import type { RiskInput } from "@switchboard/schemas";
import type { TrustLevel } from "../../skill-runtime/governance.js";
import type { GovernanceDecision } from "../governance-types.js";
import type { MutationClass } from "../types.js";

/** Audit marker appended to matchedPolicies whenever the autonomy threshold acts. */
export const SPEND_APPROVAL_THRESHOLD_MARKER = "SPEND_APPROVAL_THRESHOLD";

export interface SpendApprovalThresholdContext {
  /** Deployment launch posture. The threshold engages ONLY when "autonomous". */
  trustLevelOverride?: TrustLevel;
  /** Per-deployment spendApprovalThreshold (dollars). Undefined ⇒ no-op. */
  threshold?: number;
  /** Action spend amount; null for a non-financial action ⇒ no-op. */
  spendAmount: number | null;
  mutationClass: MutationClass;
  reversibility: RiskInput["reversibility"];
}

/**
 * Post-processes a base GovernanceDecision with the per-deployment spend-approval
 * threshold — the "less-human-in-loop" autonomy lever.
 *
 * Safety properties (pinned by tests): a `deny` is a fixed point; only a
 * reversible financial `require_approval` at/under the threshold under an
 * explicitly-autonomous deployment is relaxed to `execute`; an over-threshold
 * `execute` is escalated to `require_approval` ("asks above $X"); everything else
 * is a no-op. Dormant for every non-autonomous deployment ⇒ default behaviour is
 * byte-identical to before this lever existed.
 *
 * This is a pure platform-gate post-processor, NOT a skill-runtime hook, so it
 * cannot reach the afterSkill deny floor (banned-phrase / claim / consent), which
 * stays trust-independent.
 */
export function applySpendApprovalThreshold(
  decision: GovernanceDecision,
  ctx: SpendApprovalThresholdContext,
): GovernanceDecision {
  // Opt-in: only an explicitly-autonomous deployment uses the threshold.
  if (ctx.trustLevelOverride !== "autonomous") return decision;
  // Never relax a deny — the compliance/limit floor is independent of autonomy.
  if (decision.outcome === "deny") return decision;
  // No threshold configured.
  if (typeof ctx.threshold !== "number" || !Number.isFinite(ctx.threshold)) return decision;
  // Non-financial action: the threshold only governs spend.
  if (ctx.spendAmount === null || !Number.isFinite(ctx.spendAmount)) return decision;

  const amount = Math.abs(ctx.spendAmount);
  const isReversible = ctx.mutationClass !== "destructive" && ctx.reversibility !== "none";

  if (amount <= ctx.threshold) {
    // Autonomy grant: a reversible financial approval at/under threshold executes
    // without a human. Irreversible stays parked; an execute stays an execute.
    if (decision.outcome === "require_approval" && isReversible) {
      return {
        outcome: "execute",
        riskScore: decision.riskScore,
        budgetProfile:
          decision.riskScore <= 20 ? "cheap" : decision.riskScore <= 60 ? "standard" : "expensive",
        constraints: decision.constraints,
        matchedPolicies: [...decision.matchedPolicies, SPEND_APPROVAL_THRESHOLD_MARKER],
      };
    }
    return decision;
  }

  // amount > threshold ⇒ park. Escalating an execute is the safe direction and
  // delivers the "asks above $X" guarantee; an already-parked decision is unchanged.
  if (decision.outcome === "execute") {
    return {
      outcome: "require_approval",
      riskScore: decision.riskScore,
      approvalLevel: "standard",
      approvers: [],
      constraints: decision.constraints,
      matchedPolicies: [...decision.matchedPolicies, SPEND_APPROVAL_THRESHOLD_MARKER],
    };
  }
  return decision;
}
