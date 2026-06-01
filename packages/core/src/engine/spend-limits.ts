import type { ActionProposal } from "@switchboard/schemas";
import type { DecisionTraceBuilder } from "./decision-trace.js";
import { addCheck } from "./decision-trace.js";
import type { ResolvedIdentity } from "../identity/spec.js";
import type { PolicyEngineContext, PolicyEngineConfig } from "./policy-engine.js";
import type { computeRiskScore } from "./risk-scorer.js";

type RiskScoreResult = ReturnType<typeof computeRiskScore>;

/**
 * Canonical spend-amount keys, in precedence order. `spendAmount` is the
 * preferred key for new producers; `amount`/`budgetChange`/`newBudget` are
 * accepted aliases for existing producers. This single extractor feeds BOTH the
 * spend-limit deny check (below) and the spend-approval-threshold autonomy lever
 * in the governance gate, so they can never disagree about "the amount".
 */
const SPEND_KEYS = ["spendAmount", "amount", "budgetChange", "newBudget"] as const;

export function extractSpendAmount(proposal: ActionProposal): number | null {
  for (const key of SPEND_KEYS) {
    const value = proposal.parameters[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function checkSpendLimits(
  spendAmount: number | null,
  resolvedIdentity: ResolvedIdentity,
  engineContext: PolicyEngineContext,
  builder: DecisionTraceBuilder,
  computeRisk: (ctx: PolicyEngineContext, cfg?: PolicyEngineConfig) => RiskScoreResult,
  config?: PolicyEngineConfig,
): boolean {
  if (spendAmount === null) return false;

  const limits = resolvedIdentity.effectiveSpendLimits;
  const perActionLimit = limits.perAction;

  if (perActionLimit !== null && Math.abs(spendAmount) > perActionLimit) {
    addCheck(
      builder,
      "SPEND_LIMIT",
      {
        field: "perAction",
        actualValue: Math.abs(spendAmount),
        threshold: perActionLimit,
      },
      `Spend limit exceeded: $${Math.abs(spendAmount)} exceeds per-action limit of $${perActionLimit}.`,
      true,
      "deny",
    );

    const riskScoreResult = computeRisk(engineContext, config);
    builder.computedRiskScore = riskScoreResult;
    builder.finalDecision = "deny";
    builder.approvalRequired = "none";
    return true;
  }

  if (perActionLimit !== null) {
    addCheck(
      builder,
      "SPEND_LIMIT",
      {
        field: "perAction",
        actualValue: Math.abs(spendAmount),
        threshold: perActionLimit,
      },
      `Spend limit OK: $${Math.abs(spendAmount)} within per-action limit of $${perActionLimit}.`,
      false,
      "skip",
    );
  }

  // Time-windowed spend limits
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

      addCheck(
        builder,
        "SPEND_LIMIT",
        {
          field: wc.field,
          currentCumulative: wc.cumulative,
          proposedSpend: absSpend,
          projectedTotal: projected,
          threshold: wc.limit,
        },
        exceeded
          ? `${wc.field} spend limit exceeded: $${wc.cumulative} + $${absSpend} = $${projected} exceeds $${wc.limit} limit.`
          : `${wc.field} spend limit OK: $${wc.cumulative} + $${absSpend} = $${projected} within $${wc.limit} limit.`,
        exceeded,
        exceeded ? "deny" : "skip",
      );

      if (exceeded) {
        const riskScoreResult = computeRisk(engineContext, config);
        builder.computedRiskScore = riskScoreResult;
        builder.finalDecision = "deny";
        builder.approvalRequired = "none";
        return true;
      }
    }
  }

  return false;
}
