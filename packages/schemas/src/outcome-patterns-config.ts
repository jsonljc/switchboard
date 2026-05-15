import { z } from "zod";

/**
 * Per-deployment outcome-pattern surfacing config. Lives under
 * AgentDeployment.inputConfig.outcomePatterns. The inputConfig column is
 * shaped as `z.record(z.unknown())` on the marketplace schema side, so this
 * typed overlay is opt-in: callers run resolveOutcomePatternsConfig(inputConfig)
 * to read the field with defaults filled.
 */
export const OutcomePatternsConfigSchema = z
  .object({
    pilotMode: z.boolean().default(false),
  })
  .default({ pilotMode: false });

export type OutcomePatternsConfig = z.infer<typeof OutcomePatternsConfigSchema>;

export function resolveOutcomePatternsConfig(
  inputConfig: Record<string, unknown> | null | undefined,
): OutcomePatternsConfig {
  const raw =
    inputConfig && typeof inputConfig === "object" ? inputConfig.outcomePatterns : undefined;
  return OutcomePatternsConfigSchema.parse(raw ?? {});
}
