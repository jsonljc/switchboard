import type {
  CompositeRiskContext,
  CompetenceAdjustment,
  GuardrailConfig,
  Policy,
  RiskInput,
} from "@switchboard/schemas";
import type { Cartridge } from "@switchboard/cartridge-sdk";
import type { EvaluationContext } from "../engine/rule-evaluator.js";
import { evaluateRule } from "../engine/rule-evaluator.js";
import type { SpendLookup } from "../engine/policy-engine.js";
import {
  type ResolvedIdentity,
  resolveIdentity,
  applyCompetenceAdjustments,
} from "../identity/spec.js";

import type { SharedContext } from "./shared-context.js";
import { buildCartridgeContext } from "./shared-context.js";

/**
 * Hydrate in-memory guardrail state (rate limits + cooldowns)
 * from the persistent guardrail state store.
 */
export async function hydrateGuardrailState(
  ctx: SharedContext,
  guardrails: GuardrailConfig | null,
  actionType: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  if (!ctx.guardrailStateStore || !guardrails) return;

  const scopeKeys: string[] = [];
  for (const rl of guardrails.rateLimits) {
    const key = rl.scope === "global" ? "global" : `${rl.scope}:${actionType}`;
    scopeKeys.push(key);
  }

  const entityKeys: string[] = [];
  for (const cd of guardrails.cooldowns) {
    if (cd.actionType === actionType || cd.actionType === "*") {
      const entityId = (parameters["entityId"] as string) ?? "unknown";
      entityKeys.push(`${cd.scope}:${entityId}`);
    }
  }

  const [rateLimits, cooldowns] = await Promise.all([
    scopeKeys.length > 0
      ? ctx.guardrailStateStore.getRateLimits(scopeKeys)
      : Promise.resolve(new Map()),
    entityKeys.length > 0
      ? ctx.guardrailStateStore.getCooldowns(entityKeys)
      : Promise.resolve(new Map()),
  ]);

  for (const [key, entry] of rateLimits) {
    ctx.guardrailState.actionCounts.set(key, entry);
  }
  for (const [key, timestamp] of cooldowns) {
    ctx.guardrailState.lastActionTimes.set(key, timestamp);
  }
}

/**
 * Search active policies for a quorum requirement matching the evaluation context.
 */
export function extractQuorumFromPolicies(
  policies: Policy[],
  evalContext: EvaluationContext,
): number | null {
  const sorted = [...policies].filter((p) => p.active).sort((a, b) => a.priority - b.priority);
  for (const policy of sorted) {
    if (policy.cartridgeId && policy.cartridgeId !== evalContext.cartridgeId) continue;
    if (policy.effect !== "require_approval") continue;
    if (!policy.effectParams) continue;

    const ruleResult = evaluateRule(policy.rule, evalContext);
    if (!ruleResult.matched) continue;

    const quorum = policy.effectParams["quorum"];
    if (typeof quorum === "number" && quorum >= 1) {
      return quorum;
    }
  }
  return null;
}

/**
 * Build a SpendLookup by scanning recent executed envelopes for the
 * given principal within the organization.
 */
export async function buildSpendLookup(
  ctx: SharedContext,
  principalId: string,
  organizationId?: string,
): Promise<SpendLookup> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  let allEnvelopes: import("@switchboard/schemas").ActionEnvelope[];
  try {
    allEnvelopes = await ctx.storage.envelopes.list({
      limit: 500,
      organizationId,
    });
  } catch {
    return { dailySpend: 0, weeklySpend: 0, monthlySpend: 0 };
  }

  let dailySpend = 0;
  let weeklySpend = 0;
  let monthlySpend = 0;

  for (const env of allEnvelopes) {
    if (env.status !== "executed") continue;
    const isPrincipal = env.proposals.some((p) => p.parameters["_principalId"] === principalId);
    if (!isPrincipal) continue;

    for (const p of env.proposals) {
      const amount =
        typeof p.parameters["amount"] === "number"
          ? Math.abs(p.parameters["amount"])
          : typeof p.parameters["budgetChange"] === "number"
            ? Math.abs(p.parameters["budgetChange"])
            : 0;

      if (amount === 0) continue;

      const age = now - env.createdAt.getTime();
      if (age < monthMs) monthlySpend += amount;
      if (age < weekMs) weeklySpend += amount;
      if (age < dayMs) dailySpend += amount;
    }
  }

  return { dailySpend, weeklySpend, monthlySpend };
}

/**
 * Build a CompositeRiskContext by scanning envelopes from the last hour
 * for the given principal within the organization.
 */
export async function buildCompositeContext(
  ctx: SharedContext,
  principalId: string,
  organizationId?: string,
): Promise<CompositeRiskContext | undefined> {
  const windowMs = 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs);

  let allRecentEnvelopes: import("@switchboard/schemas").ActionEnvelope[];
  try {
    allRecentEnvelopes = await ctx.storage.envelopes.list({
      limit: 200,
      organizationId,
    });
  } catch {
    return undefined;
  }

  const windowEnvelopes = allRecentEnvelopes.filter((e) => {
    if (e.createdAt < cutoff) return false;
    return e.proposals.some((p) => p.parameters["_principalId"] === principalId);
  });

  if (windowEnvelopes.length === 0) return undefined;

  let cumulativeExposure = 0;
  const targetEntities = new Set<string>();
  const cartridges = new Set<string>();

  for (const env of windowEnvelopes) {
    for (const decision of env.decisions) {
      const dollarsFactor = decision.computedRiskScore.factors.find(
        (f) => f.factor === "dollars_at_risk",
      );
      if (dollarsFactor) {
        cumulativeExposure += dollarsFactor.contribution;
      }
    }

    for (const proposal of env.proposals) {
      const entityId = proposal.parameters["entityId"] as string | undefined;
      if (entityId) targetEntities.add(entityId);

      const cartridgeId = proposal.parameters["_cartridgeId"] as string | undefined;
      if (cartridgeId) cartridges.add(cartridgeId);
    }
  }

  return {
    recentActionCount: windowEnvelopes.length,
    windowMs,
    cumulativeExposure,
    distinctTargetEntities: targetEntities.size,
    distinctCartridges: cartridges.size,
  };
}

/**
 * Resolve identity spec + overlays + competence adjustments for a principal.
 */
export async function resolveEffectiveIdentity(
  ctx: SharedContext,
  principalId: string,
  cartridgeId: string,
  actionType: string,
): Promise<{
  resolvedIdentity: ResolvedIdentity;
  effectiveIdentity: ResolvedIdentity;
  competenceAdjustments: CompetenceAdjustment[];
}> {
  const identitySpec = await ctx.storage.identity.getSpecByPrincipalId(principalId);
  if (!identitySpec) {
    throw new Error(`Identity spec not found for principal: ${principalId}`);
  }
  const overlays = await ctx.storage.identity.listOverlaysBySpecId(identitySpec.id);
  const resolvedIdentity = resolveIdentity(identitySpec, overlays, { cartridgeId });

  let competenceAdjustments: CompetenceAdjustment[] = [];
  let effectiveIdentity = resolvedIdentity;
  if (ctx.competenceTracker) {
    const adj = await ctx.competenceTracker.getAdjustment(principalId, actionType);
    if (adj) {
      competenceAdjustments = [adj];
      effectiveIdentity = applyCompetenceAdjustments(resolvedIdentity, competenceAdjustments);
    }
  }

  return { resolvedIdentity, effectiveIdentity, competenceAdjustments };
}

/**
 * Run cartridge enrichContext + cross-cartridge enrichment + getRiskInput.
 */
export async function enrichAndGetRiskInput(
  ctx: SharedContext,
  cartridge: Cartridge,
  actionType: string,
  parameters: Record<string, unknown>,
  principalId: string,
  organizationId: string | null,
  cartridgeId: string,
): Promise<{ enriched: Record<string, unknown>; riskInput: RiskInput }> {
  let enriched: Record<string, unknown> = {};
  try {
    enriched = await cartridge.enrichContext(
      actionType,
      parameters,
      await buildCartridgeContext(ctx, cartridgeId, principalId, organizationId),
    );
  } catch (err) {
    console.warn(
      `[orchestrator] enrichContext failed, proceeding with empty context: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (ctx.crossCartridgeEnricher && organizationId) {
    try {
      const crossCartridgeContext = await ctx.crossCartridgeEnricher.enrich({
        targetCartridgeId: cartridgeId,
        actionType,
        parameters,
        organizationId,
        principalId,
      });
      if (Object.keys(crossCartridgeContext).length > 0) {
        enriched = { ...enriched, _crossCartridge: crossCartridgeContext };
      }
    } catch (err) {
      console.warn(
        `[orchestrator] cross-cartridge enrichment failed, proceeding without: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let riskInput: RiskInput;
  try {
    riskInput = await cartridge.getRiskInput(actionType, parameters, {
      principalId,
      ...enriched,
    });
  } catch (err) {
    console.warn(
      `[orchestrator] getRiskInput failed, using default medium risk: ${err instanceof Error ? err.message : String(err)}`,
    );
    riskInput = {
      baseRisk: "medium",
      exposure: { dollarsAtRisk: 0, blastRadius: 1 },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }

  return { enriched, riskInput };
}
