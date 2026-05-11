import { z } from "zod";

export const GovernanceModeSchema = z.enum(["off", "observe", "enforce"]);
export type GovernanceMode = z.infer<typeof GovernanceModeSchema>;

export const GovernanceConfigSchema = z
  .object({
    jurisdiction: z.enum(["SG", "MY"]),
    clinicType: z.enum(["medical", "nonMedical"]),
    deterministicGate: z
      .object({
        mode: GovernanceModeSchema.default("off"),
      })
      .default({}),
  })
  .passthrough();

export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

/**
 * Single source of truth for "what mode is this deployment in?".
 * Returns "off" when the config is null or the gate sub-block is missing.
 */
export function resolveGovernanceMode(config: GovernanceConfig | null): GovernanceMode {
  return config?.deterministicGate?.mode ?? "off";
}

/**
 * Per-deployment configuration for the Layer 2/3 claim classifier hook
 * (Task 15). Lives under `governanceConfig.claimClassifier` as a passthrough
 * sub-block — no Prisma migration required, the JSON column accepts arbitrary
 * sub-blocks at runtime.
 *
 * Defaults: mode="off" (pure pass-through), latencyBudgetMs=800 (per-turn budget
 * for all sentence classifications combined), model="claude-haiku-4-5-20251001".
 */
export const ClaimClassifierConfigSchema = z
  .object({
    mode: GovernanceModeSchema.default("off"),
    latencyBudgetMs: z.number().int().positive().default(800),
    model: z.string().min(1).default("claude-haiku-4-5-20251001"),
  })
  .default({});

export type ClaimClassifierConfig = z.infer<typeof ClaimClassifierConfigSchema>;

/**
 * Single source of truth for "what classifier mode is this deployment in?".
 *
 * The parent GovernanceConfigSchema uses .passthrough() so the claimClassifier
 * sub-block is not validated as part of the parent schema. Callers consume it
 * via this helper which applies defaults when absent.
 */
export function resolveClaimClassifierConfig(
  config: GovernanceConfig | null,
): ClaimClassifierConfig {
  const raw = (config as unknown as Record<string, unknown> | null)?.claimClassifier;
  return ClaimClassifierConfigSchema.parse(raw ?? {});
}
