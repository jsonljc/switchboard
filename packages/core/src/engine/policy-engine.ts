import type {
  Policy,
  RiskCategory,
  RiskInput,
  DecisionTrace,
  ApprovalRequirement,
  ActionProposal,
  GuardrailConfig,
  CompetenceAdjustment,
  CompositeRiskContext,
  SystemRiskPosture,
} from "@switchboard/schemas";
import type { EvaluationContext } from "./rule-evaluator.js";
import { evaluateRule } from "./rule-evaluator.js";
import { computeRiskScore, computeCompositeRiskAdjustment } from "./risk-scorer.js";
import type { RiskScoringConfig, CompositeRiskConfig } from "./risk-scorer.js";
import {
  createTraceBuilder,
  addCheck,
  buildTrace,
} from "./decision-trace.js";
import type { ResolvedIdentity } from "../identity/spec.js";
import { formatSimulationResult } from "./simulator.js";
import type { SimulationResult } from "./simulator.js";

export interface PolicyEngineConfig {
  riskScoringConfig?: RiskScoringConfig;
  compositeRiskConfig?: CompositeRiskConfig;
}

export interface GuardrailState {
  actionCounts: Map<string, { count: number; windowStart: number }>;
  lastActionTimes: Map<string, number>;
}

/**
 * Provides cumulative spend totals for a principal within rolling time windows.
 * The orchestrator populates this by querying executed envelopes.
 */
export interface SpendLookup {
  dailySpend: number;
  weeklySpend: number;
  monthlySpend: number;
}

export interface PolicyEngineContext {
  policies: Policy[];
  guardrails: GuardrailConfig | null;
  guardrailState: GuardrailState;
  resolvedIdentity: ResolvedIdentity;
  riskInput: RiskInput | null;
  competenceAdjustments?: CompetenceAdjustment[];
  compositeContext?: CompositeRiskContext;
  systemRiskPosture?: SystemRiskPosture;
  spendLookup?: SpendLookup;
  now?: Date;
}

export function createGuardrailState(): GuardrailState {
  return {
    actionCounts: new Map(),
    lastActionTimes: new Map(),
  };
}

export function evaluate(
  proposal: ActionProposal,
  evalContext: EvaluationContext,
  engineContext: PolicyEngineContext,
  config?: PolicyEngineConfig,
): DecisionTrace {
  const { resolvedIdentity, guardrails, guardrailState, policies } = engineContext;
  const now = engineContext.now ?? new Date();
  const builder = createTraceBuilder((evalContext.metadata["envelopeId"] ?? "unknown") as string, proposal.id);

  // Step 1: Forbidden behaviors
  const isForbidden = resolvedIdentity.effectiveForbiddenBehaviors.includes(
    proposal.actionType,
  );
  addCheck(builder, "FORBIDDEN_BEHAVIOR", {
    behavior: proposal.actionType,
    forbiddenList: resolvedIdentity.effectiveForbiddenBehaviors,
  }, isForbidden
    ? `Action type "${proposal.actionType}" is forbidden.`
    : `Action type "${proposal.actionType}" is not in the forbidden list.`,
  isForbidden, isForbidden ? "deny" : "skip");

  if (isForbidden) {
    const riskScore = riskInput(engineContext, config);
    builder.computedRiskScore = riskScore;
    builder.finalDecision = "deny";
    builder.approvalRequired = "none";
    return buildTrace(builder);
  }

  // Step 2: Trust behaviors (fast path)
  const isTrusted = resolvedIdentity.effectiveTrustBehaviors.includes(
    proposal.actionType,
  );
  addCheck(builder, "TRUST_BEHAVIOR", {
    behavior: proposal.actionType,
    trustList: resolvedIdentity.effectiveTrustBehaviors,
  }, isTrusted
    ? `Action type "${proposal.actionType}" is pre-approved (trusted).`
    : `Action type "${proposal.actionType}" is not in the trust list.`,
  isTrusted, isTrusted ? "allow" : "skip");

  // Step 2b: Competence trust (informational trace)
  if (engineContext.competenceAdjustments && engineContext.competenceAdjustments.length > 0) {
    for (const adj of engineContext.competenceAdjustments) {
      addCheck(builder, "COMPETENCE_TRUST", {
        principalId: adj.principalId,
        actionType: adj.actionType,
        score: adj.score,
        shouldTrust: adj.shouldTrust,
        shouldEscalate: adj.shouldEscalate,
        successCount: adj.record.successCount,
        failureCount: adj.record.failureCount,
        rollbackCount: adj.record.rollbackCount,
        consecutiveSuccesses: adj.record.consecutiveSuccesses,
      }, adj.shouldTrust
        ? `Competence earned: score ${adj.score.toFixed(1)} qualifies for auto-trust.`
        : adj.shouldEscalate
          ? `Competence low: score ${adj.score.toFixed(1)} suggests escalation.`
          : `Competence tracking: score ${adj.score.toFixed(1)}.`,
      adj.shouldTrust || adj.shouldEscalate, "skip");
    }
  }

  // Step 3: Rate guardrails
  if (guardrails) {
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
        const riskScoreResult = riskInput(engineContext, config);
        builder.computedRiskScore = riskScoreResult;
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return buildTrace(builder);
      }
    }

    // Step 4: Cooldown check
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
          ? `Cooldown active: entity was modified ${Math.round((now.getTime() - (lastTime ?? 0)) / 60000)} minutes ago.`
          : `No cooldown active for this entity.`,
        inCooldown, inCooldown ? "deny" : "skip");

        if (inCooldown) {
          const riskScoreResult = riskInput(engineContext, config);
          builder.computedRiskScore = riskScoreResult;
          builder.finalDecision = "deny";
          builder.approvalRequired = "none";
          return buildTrace(builder);
        }
      }
    }

    // Step 5: Protected entities
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

        const riskScoreResult = riskInput(engineContext, config);
        builder.computedRiskScore = riskScoreResult;
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return buildTrace(builder);
      }
    }
  }

  // Step 6: Spend limits
  const spendAmount = typeof proposal.parameters["amount"] === "number"
    ? proposal.parameters["amount"]
    : typeof proposal.parameters["budgetChange"] === "number"
      ? proposal.parameters["budgetChange"]
      : null;

  if (spendAmount !== null) {
    const limits = resolvedIdentity.effectiveSpendLimits;
    const perActionLimit = limits.perAction;

    if (perActionLimit !== null && Math.abs(spendAmount) > perActionLimit) {
      addCheck(builder, "SPEND_LIMIT", {
        field: "perAction",
        actualValue: Math.abs(spendAmount),
        threshold: perActionLimit,
      }, `Spend limit exceeded: $${Math.abs(spendAmount)} exceeds per-action limit of $${perActionLimit}.`,
      true, "deny");

      const riskScoreResult = riskInput(engineContext, config);
      builder.computedRiskScore = riskScoreResult;
      builder.finalDecision = "deny";
      builder.approvalRequired = "none";
      return buildTrace(builder);
    }

    if (perActionLimit !== null) {
      addCheck(builder, "SPEND_LIMIT", {
        field: "perAction",
        actualValue: Math.abs(spendAmount),
        threshold: perActionLimit,
      }, `Spend limit OK: $${Math.abs(spendAmount)} within per-action limit of $${perActionLimit}.`,
      false, "skip");
    }

    // Step 6b: Time-windowed spend limits (daily/weekly/monthly)
    if (engineContext.spendLookup) {
      const lookup = engineContext.spendLookup;
      const absSpend = Math.abs(spendAmount);

      const windowChecks: Array<{ field: string; cumulative: number; limit: number | null }> = [
        { field: "daily", cumulative: lookup.dailySpend, limit: limits.daily },
        { field: "weekly", cumulative: lookup.weeklySpend, limit: limits.weekly },
        { field: "monthly", cumulative: lookup.monthlySpend, limit: limits.monthly },
      ];

      for (const wc of windowChecks) {
        if (wc.limit === null) continue;

        const projected = wc.cumulative + absSpend;
        const exceeded = projected > wc.limit;

        addCheck(builder, "SPEND_LIMIT", {
          field: wc.field,
          currentCumulative: wc.cumulative,
          proposedSpend: absSpend,
          projectedTotal: projected,
          threshold: wc.limit,
        }, exceeded
          ? `${wc.field} spend limit exceeded: $${wc.cumulative} + $${absSpend} = $${projected} exceeds $${wc.limit} limit.`
          : `${wc.field} spend limit OK: $${wc.cumulative} + $${absSpend} = $${projected} within $${wc.limit} limit.`,
        exceeded, exceeded ? "deny" : "skip");

        if (exceeded) {
          const riskScoreResult = riskInput(engineContext, config);
          builder.computedRiskScore = riskScoreResult;
          builder.finalDecision = "deny";
          builder.approvalRequired = "none";
          return buildTrace(builder);
        }
      }
    }
  }

  // Step 7: Policy rules (sorted by priority)
  const sortedPolicies = [...policies]
    .filter((p) => p.active)
    .sort((a, b) => a.priority - b.priority);

  let policyDecision: "allow" | "deny" | "modify" | null = null;
  let policyApprovalOverride: ApprovalRequirement | null = null;
  let policyRiskOverride: RiskCategory | null = null;

  for (const policy of sortedPolicies) {
    // Check cartridge filter
    if (policy.cartridgeId && policy.cartridgeId !== evalContext.cartridgeId) {
      continue;
    }

    const ruleResult = evaluateRule(policy.rule, evalContext);

    addCheck(builder, "POLICY_RULE", {
      ruleId: policy.id,
      ruleName: policy.name,
      effect: policy.effect,
      matched: ruleResult.matched,
      conditionResults: ruleResult.conditionResults,
    }, ruleResult.matched
      ? `Policy "${policy.name}" matched: effect is ${policy.effect}.`
      : `Policy "${policy.name}" did not match.`,
    ruleResult.matched, ruleResult.matched ? mapPolicyEffect(policy.effect) : "skip");

    if (ruleResult.matched) {
      if (policy.effect === "deny") {
        policyDecision = "deny";
        break;
      }
      if (policy.effect === "allow") {
        policyDecision = "allow";
      }
      if (policy.effect === "modify") {
        policyDecision = "modify";
      }
      if (policy.effect === "require_approval" && policy.approvalRequirement) {
        policyApprovalOverride = policy.approvalRequirement;
      }
      if (policy.riskCategoryOverride) {
        policyRiskOverride = policy.riskCategoryOverride;
      }
    }
  }

  if (policyDecision === "deny") {
    const riskScoreResult = riskInput(engineContext, config);
    builder.computedRiskScore = riskScoreResult;
    builder.finalDecision = "deny";
    builder.approvalRequired = "none";
    return buildTrace(builder);
  }

  // Step 8: Compute risk score
  const riskScoreResult = riskInput(engineContext, config);
  builder.computedRiskScore = riskScoreResult;

  const effectiveRiskCategory = policyRiskOverride ?? riskScoreResult.category;

  addCheck(builder, "RISK_SCORING", {
    rawScore: riskScoreResult.rawScore,
    category: riskScoreResult.category,
    effectiveCategory: effectiveRiskCategory,
    factors: riskScoreResult.factors,
  }, `Risk score: ${riskScoreResult.rawScore.toFixed(1)} (${effectiveRiskCategory}).`,
  true, "skip");

  // Step 8b: Composite risk adjustment
  let finalRiskCategory = effectiveRiskCategory;
  if (engineContext.compositeContext) {
    const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(
      riskScoreResult,
      engineContext.compositeContext,
      config?.compositeRiskConfig,
    );

    const categoryChanged = adjustedScore.category !== riskScoreResult.category;

    addCheck(builder, "COMPOSITE_RISK", {
      originalScore: riskScoreResult.rawScore,
      adjustedScore: adjustedScore.rawScore,
      originalCategory: riskScoreResult.category,
      adjustedCategory: adjustedScore.category,
      compositeFactors,
      context: engineContext.compositeContext,
    }, categoryChanged
      ? `Composite risk adjustment: score ${riskScoreResult.rawScore.toFixed(1)} → ${adjustedScore.rawScore.toFixed(1)} (${riskScoreResult.category} → ${adjustedScore.category}).`
      : `Composite risk check: no category change (score ${riskScoreResult.rawScore.toFixed(1)} → ${adjustedScore.rawScore.toFixed(1)}).`,
    categoryChanged, "skip");

    if (categoryChanged) {
      builder.computedRiskScore = adjustedScore;
      finalRiskCategory = policyRiskOverride ?? adjustedScore.category;
    }
  }

  // Step 9: Determine approval requirement
  let approvalReq: ApprovalRequirement = policyApprovalOverride
    ?? resolvedIdentity.effectiveRiskTolerance[finalRiskCategory];

  // Step 9b: System-wide risk posture override
  const posture = engineContext.systemRiskPosture ?? "normal";
  if (posture === "critical") {
    approvalReq = "mandatory";
    addCheck(builder, "SYSTEM_POSTURE", {
      posture,
      previousApproval: approvalReq,
    }, `System posture is CRITICAL: all actions require mandatory approval.`,
    true, "skip");
  } else if (posture === "elevated" && (approvalReq === "none" || approvalReq === "standard")) {
    approvalReq = "elevated";
    addCheck(builder, "SYSTEM_POSTURE", {
      posture,
      previousApproval: approvalReq,
    }, `System posture is ELEVATED: approval escalated to elevated.`,
    true, "skip");
  }

  builder.approvalRequired = approvalReq;

  // If trusted, allow without approval regardless
  if (isTrusted) {
    builder.finalDecision = "allow";
    builder.approvalRequired = "none";
    return buildTrace(builder);
  }

  // Step 10: Final decision — default deny if no policy matched
  builder.finalDecision = policyDecision ?? "allow";

  return buildTrace(builder);
}

export function simulate(
  proposal: ActionProposal,
  evalContext: EvaluationContext,
  engineContext: PolicyEngineContext,
  config?: PolicyEngineConfig,
): SimulationResult {
  const trace = evaluate(proposal, evalContext, engineContext, config);
  return formatSimulationResult(trace);
}

function riskInput(
  engineContext: PolicyEngineContext,
  config?: PolicyEngineConfig,
) {
  if (engineContext.riskInput) {
    return computeRiskScore(engineContext.riskInput, config?.riskScoringConfig);
  }
  return computeRiskScore({
    baseRisk: "low",
    exposure: { dollarsAtRisk: 0, blastRadius: 1 },
    reversibility: "full",
    sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
  }, config?.riskScoringConfig);
}

function mapPolicyEffect(effect: string): "allow" | "deny" | "modify" | "skip" {
  switch (effect) {
    case "allow": return "allow";
    case "deny": return "deny";
    case "modify": return "modify";
    case "require_approval": return "allow";
    default: return "skip";
  }
}
