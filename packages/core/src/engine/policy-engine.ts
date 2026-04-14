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
import { createTraceBuilder, addCheck, buildTrace } from "./decision-trace.js";
import { computeConfidence } from "./confidence.js";
import type { ConfidenceResult } from "./confidence.js";
import type { ResolvedIdentity } from "../identity/spec.js";
import { formatSimulationResult } from "./simulator.js";
import type { SimulationResult } from "./simulator.js";
import { extractSpendAmount, checkSpendLimits } from "./spend-limits.js";

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

function checkForbiddenBehavior(
  proposal: ActionProposal,
  resolvedIdentity: ResolvedIdentity,
  builder: ReturnType<typeof createTraceBuilder>,
  engineContext: PolicyEngineContext,
  config?: PolicyEngineConfig,
): boolean {
  const isForbidden = resolvedIdentity.effectiveForbiddenBehaviors.includes(proposal.actionType);
  addCheck(
    builder,
    "FORBIDDEN_BEHAVIOR",
    {
      behavior: proposal.actionType,
      forbiddenList: resolvedIdentity.effectiveForbiddenBehaviors,
    },
    isForbidden
      ? `Action type "${proposal.actionType}" is forbidden.`
      : `Action type "${proposal.actionType}" is not in the forbidden list.`,
    isForbidden,
    isForbidden ? "deny" : "skip",
  );

  if (isForbidden) {
    const riskScore = riskInput(engineContext, config);
    builder.computedRiskScore = riskScore;
    builder.finalDecision = "deny";
    builder.approvalRequired = "none";
    return true;
  }
  return false;
}

function checkTrustBehavior(
  proposal: ActionProposal,
  resolvedIdentity: ResolvedIdentity,
  engineContext: PolicyEngineContext,
  builder: ReturnType<typeof createTraceBuilder>,
): boolean {
  const isTrusted = resolvedIdentity.effectiveTrustBehaviors.includes(proposal.actionType);
  addCheck(
    builder,
    "TRUST_BEHAVIOR",
    {
      behavior: proposal.actionType,
      trustList: resolvedIdentity.effectiveTrustBehaviors,
    },
    isTrusted
      ? `Action type "${proposal.actionType}" is pre-approved (trusted).`
      : `Action type "${proposal.actionType}" is not in the trust list.`,
    isTrusted,
    isTrusted ? "allow" : "skip",
  );

  // Competence trust (informational trace)
  if (engineContext.competenceAdjustments && engineContext.competenceAdjustments.length > 0) {
    for (const adj of engineContext.competenceAdjustments) {
      addCheck(
        builder,
        "COMPETENCE_TRUST",
        {
          principalId: adj.principalId,
          actionType: adj.actionType,
          score: adj.score,
          shouldTrust: adj.shouldTrust,
          shouldEscalate: adj.shouldEscalate,
          successCount: adj.record.successCount,
          failureCount: adj.record.failureCount,
          rollbackCount: adj.record.rollbackCount,
          consecutiveSuccesses: adj.record.consecutiveSuccesses,
        },
        adj.shouldTrust
          ? `Competence earned: score ${adj.score.toFixed(1)} qualifies for auto-trust.`
          : adj.shouldEscalate
            ? `Competence low: score ${adj.score.toFixed(1)} suggests escalation.`
            : `Competence tracking: score ${adj.score.toFixed(1)}.`,
        adj.shouldTrust || adj.shouldEscalate,
        "skip",
      );
    }
  }

  return isTrusted;
}

function checkGuardrails(
  proposal: ActionProposal,
  engineContext: PolicyEngineContext,
  now: Date,
  builder: ReturnType<typeof createTraceBuilder>,
  config?: PolicyEngineConfig,
): boolean {
  const { guardrails, guardrailState } = engineContext;
  if (!guardrails) return false;

  // Rate limits
  for (const rl of guardrails.rateLimits) {
    const scope = rl.scope === "global" ? "global" : `${rl.scope}:${proposal.actionType}`;
    const current = guardrailState.actionCounts.get(scope);
    const windowStart = current?.windowStart ?? now.getTime();
    const count = current?.count ?? 0;
    const inWindow = now.getTime() - windowStart < rl.windowMs;
    const exceeded = inWindow && count >= rl.maxActions;

    addCheck(
      builder,
      "RATE_LIMIT",
      {
        scope: rl.scope,
        maxActions: rl.maxActions,
        windowMs: rl.windowMs,
        currentCount: count,
      },
      exceeded
        ? `Rate limit exceeded: ${count}/${rl.maxActions} actions in window.`
        : `Rate limit OK: ${count}/${rl.maxActions} actions in window.`,
      exceeded,
      exceeded ? "deny" : "skip",
    );

    if (exceeded) {
      const riskScoreResult = riskInput(engineContext, config);
      builder.computedRiskScore = riskScoreResult;
      builder.finalDecision = "deny";
      builder.approvalRequired = "none";
      return true;
    }
  }

  // Cooldowns
  for (const cd of guardrails.cooldowns) {
    if (cd.actionType === proposal.actionType || cd.actionType === "*") {
      const entityKey = `${cd.scope}:${proposal.parameters["entityId"] ?? "unknown"}`;
      const lastTime = guardrailState.lastActionTimes.get(entityKey);
      const inCooldown = lastTime !== undefined && now.getTime() - lastTime < cd.cooldownMs;

      const elapsedMs = now.getTime() - (lastTime ?? 0);
      const remainingMs = cd.cooldownMs - elapsedMs;
      const remainingMinutes = Math.ceil(remainingMs / 60000);
      const cooldownExpiresAt = lastTime !== undefined ? new Date(lastTime + cd.cooldownMs) : null;

      addCheck(
        builder,
        "COOLDOWN",
        {
          actionType: cd.actionType,
          scope: cd.scope,
          cooldownMs: cd.cooldownMs,
          lastActionTime: lastTime ?? null,
          entityKey,
          cooldownExpiresAt: cooldownExpiresAt?.toISOString() ?? null,
        },
        inCooldown
          ? `Cooldown active: entity was modified ${Math.round(elapsedMs / 60000)} minutes ago. Try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}.`
          : `No cooldown active for this entity.`,
        inCooldown,
        inCooldown ? "deny" : "skip",
      );

      if (inCooldown) {
        const riskScoreResult = riskInput(engineContext, config);
        builder.computedRiskScore = riskScoreResult;
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return true;
      }
    }
  }

  // Protected entities
  for (const pe of guardrails.protectedEntities) {
    const entityId = proposal.parameters["entityId"] as string | undefined;
    const isProtected = entityId === pe.entityId;

    if (isProtected) {
      addCheck(
        builder,
        "PROTECTED_ENTITY",
        {
          entityType: pe.entityType,
          entityId: pe.entityId,
          reason: pe.reason,
        },
        `Protected entity: ${pe.reason}`,
        true,
        "deny",
      );

      const riskScoreResult = riskInput(engineContext, config);
      builder.computedRiskScore = riskScoreResult;
      builder.finalDecision = "deny";
      builder.approvalRequired = "none";
      return true;
    }
  }

  return false;
}

function evaluatePolicyRules(
  _proposal: ActionProposal,
  evalContext: EvaluationContext,
  policies: Policy[],
  builder: ReturnType<typeof createTraceBuilder>,
  config: PolicyEngineConfig | undefined,
  engineContext: PolicyEngineContext,
): {
  denied: boolean;
  policyDecision: "allow" | "deny" | "modify" | null;
  policyApprovalOverride: ApprovalRequirement | null;
  policyRiskOverride: RiskCategory | null;
} {
  const sortedPolicies = [...policies]
    .filter((p) => p.active)
    .sort((a, b) => a.priority - b.priority);

  let policyDecision: "allow" | "deny" | "modify" | null = null;
  let policyApprovalOverride: ApprovalRequirement | null = null;
  let policyRiskOverride: RiskCategory | null = null;

  for (const policy of sortedPolicies) {
    if (policy.cartridgeId && policy.cartridgeId !== evalContext.cartridgeId) {
      continue;
    }

    const ruleResult = evaluateRule(policy.rule, evalContext);

    addCheck(
      builder,
      "POLICY_RULE",
      {
        ruleId: policy.id,
        ruleName: policy.name,
        effect: policy.effect,
        matched: ruleResult.matched,
        conditionResults: ruleResult.conditionResults,
      },
      ruleResult.matched
        ? `Policy "${policy.name}" matched: effect is ${policy.effect}.`
        : `Policy "${policy.name}" did not match.`,
      ruleResult.matched,
      ruleResult.matched ? mapPolicyEffect(policy.effect) : "skip",
    );

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
        console.warn(
          `[PolicyEngine] Policy "${policy.name}" (${policy.id}) uses "modify" effect which is not fully implemented — action will be allowed but parameters will not be modified.`,
        );
      }
      if (policy.effect === "require_approval" && policy.approvalRequirement) {
        policyApprovalOverride = policy.approvalRequirement;
        if (policyDecision === null) {
          policyDecision = "allow";
        }
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
    return { denied: true, policyDecision, policyApprovalOverride, policyRiskOverride };
  }

  return { denied: false, policyDecision, policyApprovalOverride, policyRiskOverride };
}

function computeFinalRisk(
  engineContext: PolicyEngineContext,
  config: PolicyEngineConfig | undefined,
  policyRiskOverride: RiskCategory | null,
  builder: ReturnType<typeof createTraceBuilder>,
): { finalRiskCategory: RiskCategory; riskScoreResult: ReturnType<typeof computeRiskScore> } {
  const riskScoreResult = riskInput(engineContext, config);
  builder.computedRiskScore = riskScoreResult;

  const effectiveRiskCategory = policyRiskOverride ?? riskScoreResult.category;

  addCheck(
    builder,
    "RISK_SCORING",
    {
      rawScore: riskScoreResult.rawScore,
      category: riskScoreResult.category,
      effectiveCategory: effectiveRiskCategory,
      factors: riskScoreResult.factors,
    },
    `Risk score: ${riskScoreResult.rawScore.toFixed(1)} (${effectiveRiskCategory}).`,
    true,
    "skip",
  );

  // Composite risk adjustment
  let finalRiskCategory = effectiveRiskCategory;
  if (engineContext.compositeContext) {
    const { adjustedScore, compositeFactors } = computeCompositeRiskAdjustment(
      riskScoreResult,
      engineContext.compositeContext,
      config?.compositeRiskConfig,
    );

    const categoryChanged = adjustedScore.category !== riskScoreResult.category;

    addCheck(
      builder,
      "COMPOSITE_RISK",
      {
        originalScore: riskScoreResult.rawScore,
        adjustedScore: adjustedScore.rawScore,
        originalCategory: riskScoreResult.category,
        adjustedCategory: adjustedScore.category,
        compositeFactors,
        context: engineContext.compositeContext,
      },
      categoryChanged
        ? `Composite risk adjustment: score ${riskScoreResult.rawScore.toFixed(1)} → ${adjustedScore.rawScore.toFixed(1)} (${riskScoreResult.category} → ${adjustedScore.category}).`
        : `Composite risk check: no category change (score ${riskScoreResult.rawScore.toFixed(1)} → ${adjustedScore.rawScore.toFixed(1)}).`,
      categoryChanged,
      "skip",
    );

    if (categoryChanged) {
      builder.computedRiskScore = adjustedScore;
      finalRiskCategory = policyRiskOverride ?? adjustedScore.category;
    }
  }

  return { finalRiskCategory, riskScoreResult };
}

function determineApprovalRequirement(
  policyApprovalOverride: ApprovalRequirement | null,
  resolvedIdentity: ResolvedIdentity,
  finalRiskCategory: RiskCategory,
  systemRiskPosture: SystemRiskPosture | undefined,
  builder: ReturnType<typeof createTraceBuilder>,
  confidence?: ConfidenceResult,
): ApprovalRequirement {
  let approvalReq: ApprovalRequirement =
    policyApprovalOverride ?? resolvedIdentity.effectiveRiskTolerance[finalRiskCategory];

  const posture = systemRiskPosture ?? "normal";
  if (posture === "critical") {
    approvalReq = "mandatory";
    addCheck(
      builder,
      "SYSTEM_POSTURE",
      {
        posture,
        previousApproval: approvalReq,
      },
      `System posture is CRITICAL: all actions require mandatory approval.`,
      true,
      "skip",
    );
  } else if (posture === "elevated" && (approvalReq === "none" || approvalReq === "standard")) {
    approvalReq = "elevated";
    addCheck(
      builder,
      "SYSTEM_POSTURE",
      {
        posture,
        previousApproval: approvalReq,
      },
      `System posture is ELEVATED: approval escalated to elevated.`,
      true,
      "skip",
    );
  }

  if (confidence?.level === "low" && approvalReq === "none") {
    approvalReq = "standard";
    addCheck(
      builder,
      "CONFIDENCE",
      { previousApproval: "none", newApproval: "standard", confidenceLevel: "low" },
      "Low confidence: escalating from auto-allow to standard approval.",
      true,
      "skip",
    );
  }

  return approvalReq;
}

export function evaluate(
  proposal: ActionProposal,
  evalContext: EvaluationContext,
  engineContext: PolicyEngineContext,
  config?: PolicyEngineConfig,
): DecisionTrace {
  const { resolvedIdentity } = engineContext;
  const now = engineContext.now ?? new Date();
  const builder = createTraceBuilder(
    (evalContext.metadata["envelopeId"] ?? "unknown") as string,
    proposal.id,
  );

  // Step 0: Manual approval gate — hard requirement regardless of trust
  if (evalContext.metadata["requiresManualApproval"]) {
    const riskScoreResult = riskInput(engineContext, config);
    builder.computedRiskScore = riskScoreResult;
    addCheck(
      builder,
      "MANUAL_APPROVAL_GATE",
      { tool: proposal.actionType },
      `Tool "${proposal.actionType}" requires manual approval regardless of trust level.`,
      true,
      "skip",
    );
    builder.finalDecision = "allow";
    builder.approvalRequired = "mandatory";
    return buildTrace(builder);
  }

  // Step 1: Forbidden behaviors
  if (checkForbiddenBehavior(proposal, resolvedIdentity, builder, engineContext, config)) {
    return buildTrace(builder);
  }

  // Step 2: Trust behaviors (fast path)
  const isTrusted = checkTrustBehavior(proposal, resolvedIdentity, engineContext, builder);

  // Step 3-5: Guardrail checks
  if (checkGuardrails(proposal, engineContext, now, builder, config)) {
    return buildTrace(builder);
  }

  // Step 6: Spend limits
  const spendAmount = extractSpendAmount(proposal);
  if (checkSpendLimits(spendAmount, resolvedIdentity, engineContext, builder, riskInput, config)) {
    return buildTrace(builder);
  }

  // Step 7: Policy rules
  const policyResult = evaluatePolicyRules(
    proposal,
    evalContext,
    engineContext.policies,
    builder,
    config,
    engineContext,
  );
  if (policyResult.denied) {
    return buildTrace(builder);
  }

  // Step 8: Compute risk score
  const { finalRiskCategory } = computeFinalRisk(
    engineContext,
    config,
    policyResult.policyRiskOverride,
    builder,
  );

  // Step 8.5: Compute confidence
  const schemaComplete =
    typeof evalContext.metadata["schemaComplete"] === "boolean"
      ? evalContext.metadata["schemaComplete"]
      : Boolean(evalContext.parameters && Object.keys(evalContext.parameters).length > 0);
  const hasRequiredParams =
    typeof evalContext.metadata["hasRequiredParams"] === "boolean"
      ? evalContext.metadata["hasRequiredParams"]
      : schemaComplete;

  const confidence = computeConfidence({
    riskScore: builder.computedRiskScore?.rawScore ?? 0,
    schemaComplete,
    hasRequiredParams,
    retrievalQuality: evalContext.metadata["retrievalQuality"] as number | undefined,
    toolSuccessRate: evalContext.metadata["toolSuccessRate"] as number | undefined,
  });

  addCheck(
    builder,
    "CONFIDENCE",
    {
      score: confidence.score,
      level: confidence.level,
      factors: confidence.factors,
    },
    `Confidence: ${confidence.score.toFixed(2)} (${confidence.level}).`,
    confidence.level === "low",
    "skip",
  );

  // Step 9: Determine approval requirement
  const approvalReq = determineApprovalRequirement(
    policyResult.policyApprovalOverride,
    resolvedIdentity,
    finalRiskCategory,
    engineContext.systemRiskPosture,
    builder,
    confidence,
  );

  builder.approvalRequired = approvalReq;

  // If trusted, allow without approval regardless
  if (isTrusted) {
    builder.finalDecision = "allow";
    builder.approvalRequired = "none";
    return buildTrace(builder);
  }

  // Step 10: Final decision — default deny if no policy matched
  builder.finalDecision = policyResult.policyDecision ?? "deny";

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

function riskInput(engineContext: PolicyEngineContext, config?: PolicyEngineConfig) {
  if (engineContext.riskInput) {
    return computeRiskScore(engineContext.riskInput, config?.riskScoringConfig);
  }
  return computeRiskScore(
    {
      baseRisk: "low",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    },
    config?.riskScoringConfig,
  );
}

function mapPolicyEffect(effect: string): "allow" | "deny" | "modify" | "skip" {
  switch (effect) {
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    case "modify":
      return "modify";
    case "require_approval":
      return "allow";
    default:
      return "skip";
  }
}
