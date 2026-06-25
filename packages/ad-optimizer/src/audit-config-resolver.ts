import { resolveAdOptimizerConfig } from "@switchboard/schemas";

/**
 * A21 (P1-9): coerce the per-deployment numeric audit config ONCE through the
 * validated `AdOptimizerConfigSchema`, so operator-entered string values become
 * numbers before they reach the deterministic weekly-audit decision path.
 *
 * Why this exists: the marketplace listing form declares targetCPA / targetROAS /
 * monthlyBudget as `type:"text"` (seed-marketplace.ts stores e.g. `targetCPA:"30"`),
 * so `AgentDeployment.inputConfig` holds STRINGS at runtime even though the cron's
 * `DeploymentInfo.inputConfig` type claims `number`. The live cron previously read
 * `inputConfig.targetCPA ?? 100` un-coerced (the `??` only catches null/undefined):
 *   - a clean string "30" flows through and detonates at the first breach, where
 *     budget-analyzer calls `targetCPA.toFixed(2)` (strings have no `.toFixed`);
 *   - a malformed "$1,500" coerces to NaN in every `cpa > targetCPA` test, which is
 *     always false, so EVERY breach / pause / add_creative rec is silently suppressed.
 *
 * The validated `resolveAdOptimizerConfig` is the same coercion already wired into
 * the LLM batch builder; this routes the deterministic cron through it too.
 *
 * Returns a discriminated result so the cron fails CLOSED on malformed config
 * (skip + surface via the per-deployment alert wire) instead of acting on a NaN.
 *
 * BLAST RADIUS (deliberate, per the A21 plan "route the WHOLE inputConfig through
 * resolveAdOptimizerConfig"): this validates the whole config bag, so a malformed numeric in
 * ANY validated field — including monthlyBudget, which the weekly-audit cron does not itself
 * read — fails the deployment's audit closed for that cycle. The strict posture is intentional
 * (a malformed economic config is untrusted input, and Riley must not act on a partly-garbled
 * config), but it is wider than the three fields the cron consumes; surfaced + alerted, never
 * silent. Narrow to a per-field pick only if a benign cron-unused field proves noisy in practice.
 */
export type ResolvedAuditNumerics =
  | { ok: true; targetCPA: number; targetROAS: number; targetCostPerBooked?: number }
  | { ok: false; error: unknown };

export function resolveAuditNumerics(
  inputConfig: Record<string, unknown> | null | undefined,
): ResolvedAuditNumerics {
  try {
    const config = resolveAdOptimizerConfig(inputConfig);
    const cpb = config.targetCostPerBooked;
    return {
      ok: true,
      targetCPA: config.targetCPA,
      targetROAS: config.targetROAS,
      // Mirror the cron's existing booked-CAC guard: only a finite, positive target
      // activates the booked_cac tier; 0/absent stays "no tier" (undefined).
      ...(typeof cpb === "number" && Number.isFinite(cpb) && cpb > 0
        ? { targetCostPerBooked: cpb }
        : {}),
    };
  } catch (error) {
    return { ok: false, error };
  }
}
