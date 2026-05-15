import { z } from "zod";

/**
 * Per-deployment ad-optimizer config. Lives at the top level of
 * AgentDeployment.inputConfig (e.g. inputConfig.targetCPA), not nested
 * under inputConfig.adOptimizer — top-level placement matches the existing
 * inngest cron readers in packages/ad-optimizer. The inputConfig column is
 * shaped as `z.record(z.unknown())` on the marketplace schema side, so
 * this typed overlay is opt-in: callers run resolveAdOptimizerConfig(inputConfig)
 * to read the fields with defaults filled.
 *
 * `z.coerce.number()` accepts both numeric and numeric-string inputs.
 * The marketplace listing form (`packages/db/prisma/seed-marketplace.ts`)
 * declares these fields as `type: "text"`, so operator-entered values are
 * stored as strings in inputConfig. Coercion normalizes to number — the
 * shape that downstream consumers (inngest crons, dashboard, the LLM
 * prompt template) actually want.
 *
 * `.passthrough()` keeps any non-schema keys in the result so the parsed
 * bag can flow into DEPLOYMENT_CONFIG for the ad-optimizer LLM prompt
 * without losing operator-supplied extras (e.g. pixelId, auditFrequency).
 *
 * Defaults match the inngest weekly-audit fallbacks: targetCPA=100,
 * targetROAS=3. monthlyBudget defaults to 0 ("not set") for parity with
 * the historical untyped read.
 */
export const AdOptimizerConfigSchema = z
  .object({
    targetCPA: z.coerce.number().nonnegative().default(100),
    targetROAS: z.coerce.number().nonnegative().default(3),
    monthlyBudget: z.coerce.number().nonnegative().default(0),
  })
  .passthrough()
  .default({});

export type AdOptimizerConfig = z.infer<typeof AdOptimizerConfigSchema>;

export function resolveAdOptimizerConfig(
  inputConfig: Record<string, unknown> | null | undefined,
): AdOptimizerConfig {
  return AdOptimizerConfigSchema.parse(inputConfig ?? {});
}
