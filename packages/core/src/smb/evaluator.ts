import type {
  DecisionTrace,
  RiskCategory,
  ActionProposal,
  GuardrailConfig,
  ApprovalRequirement,
  GovernanceProfile,
} from "@switchboard/schemas";
import type { SmbOrgConfig } from "@switchboard/schemas";
import type { GuardrailState } from "../engine/policy-engine.js";
import {
  createTraceBuilder,
  addCheck,
  buildTrace,
} from "../engine/decision-trace.js";

export interface SmbEvaluationContext {
  orgConfig: SmbOrgConfig;
  guardrails: GuardrailConfig | null;
  guardrailState: GuardrailState;
  dailySpend: number;
  envelopeId: string;
  now?: Date;
}

/**
 * Simplified SMB risk categorization.
 * 3 buckets based on dollar amount + reversibility (no composite scoring).
 */
export function smbCategorizeRisk(
  amount: number | null,
  reversible: boolean,
): RiskCategory {
  if (amount === null) {
    return reversible ? "low" : "medium";
  }
  const abs = Math.abs(amount);
  if (abs <= 100 && reversible) return "low";
  if (abs <= 1000) return "medium";
  return "high";
}

/**
 * Map risk + governance profile to approval requirement for SMB orgs.
 * - observe → never
 * - guarded → high only
 * - strict → medium + high
 * - locked → always
 */
export function smbApprovalRequired(
  risk: RiskCategory,
  profile: GovernanceProfile,
): boolean {
  switch (profile) {
    case "observe":
      return false;
    case "guarded":
      return risk === "high" || risk === "critical";
    case "strict":
      return risk === "medium" || risk === "high" || risk === "critical";
    case "locked":
      return true;
    default:
      return risk === "high" || risk === "critical";
  }
}

/**
 * Simplified SMB policy evaluation — replaces the 10-step enterprise evaluate().
 *
 * 5-step pipeline:
 * 1. Action type filter (allowlist/blocklist)
 * 2. Guardrail checks (rate limits, cooldowns, protected entities)
 * 3. Spend cap (perActionSpendLimit + dailySpendLimit)
 * 4. Risk categorization (3 buckets)
 * 5. Approval determination (map risk + governance profile)
 */
export function smbEvaluate(
  proposal: ActionProposal,
  ctx: SmbEvaluationContext,
): DecisionTrace {
  const { orgConfig, guardrails, guardrailState } = ctx;
  const now = ctx.now ?? new Date();
  const builder = createTraceBuilder(ctx.envelopeId, proposal.id);

  // Step 1: Action type filter
  if (orgConfig.allowedActionTypes && orgConfig.allowedActionTypes.length > 0) {
    const allowed = orgConfig.allowedActionTypes.includes(proposal.actionType);
    addCheck(builder, "FORBIDDEN_BEHAVIOR", {
      actionType: proposal.actionType,
      allowedList: orgConfig.allowedActionTypes,
    }, allowed
      ? `Action type "${proposal.actionType}" is in the allowed list.`
      : `Action type "${proposal.actionType}" is not in the allowed list.`,
    !allowed, !allowed ? "deny" : "skip");

    if (!allowed) {
      builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
      builder.finalDecision = "deny";
      builder.approvalRequired = "none";
      return buildTrace(builder);
    }
  } else if (orgConfig.blockedActionTypes && orgConfig.blockedActionTypes.length > 0) {
    const blocked = orgConfig.blockedActionTypes.includes(proposal.actionType);
    addCheck(builder, "FORBIDDEN_BEHAVIOR", {
      actionType: proposal.actionType,
      blockedList: orgConfig.blockedActionTypes,
    }, blocked
      ? `Action type "${proposal.actionType}" is blocked.`
      : `Action type "${proposal.actionType}" is not in the blocked list.`,
    blocked, blocked ? "deny" : "skip");

    if (blocked) {
      builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
      builder.finalDecision = "deny";
      builder.approvalRequired = "none";
      return buildTrace(builder);
    }
  }

  // Step 2: Guardrail checks
  if (guardrails) {
    // Rate limits
    for (const rl of guardrails.rateLimits) {
      const scope = rl.scope === "global" ? "global" : `${rl.scope}:${proposal.actionType}`;
      const current = guardrailState.actionCounts.get(scope);
      const windowStart = current?.windowStart ?? now.getTime();
      const count = current?.count ?? 0;
      const inWindow = now.getTime() - windowStart < rl.windowMs;
      const exceeded = inWindow && count >= rl.maxActions;

      addCheck(builder, "RATE_LIMIT", {
        scope: rl.scope,
        maxActions: rl.maxActions,
        windowMs: rl.windowMs,
        currentCount: count,
      }, exceeded
        ? `Rate limit exceeded: ${count}/${rl.maxActions} actions in window.`
        : `Rate limit OK: ${count}/${rl.maxActions} actions in window.`,
      exceeded, exceeded ? "deny" : "skip");

      if (exceeded) {
        builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return buildTrace(builder);
      }
    }

    // Cooldowns
    for (const cd of guardrails.cooldowns) {
      if (cd.actionType === proposal.actionType || cd.actionType === "*") {
        const entityKey = `${cd.scope}:${proposal.parameters["entityId"] ?? "unknown"}`;
        const lastTime = guardrailState.lastActionTimes.get(entityKey);
        const inCooldown = lastTime !== undefined && now.getTime() - lastTime < cd.cooldownMs;

        addCheck(builder, "COOLDOWN", {
          actionType: cd.actionType,
          scope: cd.scope,
          cooldownMs: cd.cooldownMs,
          lastActionTime: lastTime ?? null,
          entityKey,
        }, inCooldown
          ? `Cooldown active for this entity.`
          : `No cooldown active for this entity.`,
        inCooldown, inCooldown ? "deny" : "skip");

        if (inCooldown) {
          builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
          builder.finalDecision = "deny";
          builder.approvalRequired = "none";
          return buildTrace(builder);
        }
      }
    }

    // Protected entities
    for (const pe of guardrails.protectedEntities) {
      const entityId = proposal.parameters["entityId"] as string | undefined;
      const isProtected = entityId === pe.entityId;

      if (isProtected) {
        addCheck(builder, "PROTECTED_ENTITY", {
          entityType: pe.entityType,
          entityId: pe.entityId,
          reason: pe.reason,
        }, `Protected entity: ${pe.reason}`,
        true, "deny");

        builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return buildTrace(builder);
      }
    }
  }

  // Step 3: Spend cap
  const spendAmount = typeof proposal.parameters["amount"] === "number"
    ? proposal.parameters["amount"]
    : typeof proposal.parameters["budgetChange"] === "number"
      ? proposal.parameters["budgetChange"]
      : null;

  if (spendAmount !== null) {
    const absSpend = Math.abs(spendAmount);

    // Per-action spend limit
    if (orgConfig.perActionSpendLimit !== null && absSpend > orgConfig.perActionSpendLimit) {
      addCheck(builder, "SPEND_LIMIT", {
        field: "perAction",
        actualValue: absSpend,
        threshold: orgConfig.perActionSpendLimit,
      }, `Spend limit exceeded: $${absSpend} exceeds per-action limit of $${orgConfig.perActionSpendLimit}.`,
      true, "deny");

      builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
      builder.finalDecision = "deny";
      builder.approvalRequired = "none";
      return buildTrace(builder);
    }

    if (orgConfig.perActionSpendLimit !== null) {
      addCheck(builder, "SPEND_LIMIT", {
        field: "perAction",
        actualValue: absSpend,
        threshold: orgConfig.perActionSpendLimit,
      }, `Spend limit OK: $${absSpend} within per-action limit of $${orgConfig.perActionSpendLimit}.`,
      false, "skip");
    }

    // Daily spend limit
    if (orgConfig.dailySpendLimit !== null) {
      const projected = ctx.dailySpend + absSpend;
      const exceeded = projected > orgConfig.dailySpendLimit;

      addCheck(builder, "SPEND_LIMIT", {
        field: "daily",
        currentCumulative: ctx.dailySpend,
        proposedSpend: absSpend,
        projectedTotal: projected,
        threshold: orgConfig.dailySpendLimit,
      }, exceeded
        ? `Daily spend limit exceeded: $${ctx.dailySpend} + $${absSpend} = $${projected} exceeds $${orgConfig.dailySpendLimit} limit.`
        : `Daily spend limit OK: $${ctx.dailySpend} + $${absSpend} = $${projected} within $${orgConfig.dailySpendLimit} limit.`,
      exceeded, exceeded ? "deny" : "skip");

      if (exceeded) {
        builder.computedRiskScore = { rawScore: 0, category: "none", factors: [] };
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return buildTrace(builder);
      }
    }
  }

  // Step 4: Risk categorization
  const reversible = proposal.parameters["reversible"] !== false;
  const riskCategory = smbCategorizeRisk(spendAmount, reversible);
  const rawScore = riskCategory === "low" ? 15
    : riskCategory === "medium" ? 45
    : 75;

  builder.computedRiskScore = {
    rawScore,
    category: riskCategory,
    factors: [{
      factor: "smb_simple_risk",
      weight: 1,
      contribution: rawScore,
      detail: `SMB risk categorization: ${riskCategory}`,
    }],
  };

  addCheck(builder, "RISK_SCORING", {
    rawScore,
    category: riskCategory,
    amount: spendAmount,
    reversible,
  }, `SMB risk: ${riskCategory} (score ${rawScore}).`,
  true, "skip");

  // Step 5: Approval determination
  const needsApproval = smbApprovalRequired(riskCategory, orgConfig.governanceProfile);
  const approvalReq: ApprovalRequirement = needsApproval ? "standard" : "none";

  builder.approvalRequired = approvalReq;
  builder.finalDecision = "allow";

  return buildTrace(builder);
}
