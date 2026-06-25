import type { GovernanceConfig, GovernanceMode } from "./governance-config.js";
import { GATE_UNIT_CONFIG_KEY, type GovernanceGateUnit } from "./governance-gate-unit.js";

/**
 * Returns a new GovernanceConfig with `unit`'s mode set to `mode`, preserving every
 * other sub-block and every non-mode field within the target sub-block (e.g.
 * whatsappWindow.{enabled,allowMarketingTemplateSubstitution},
 * claimClassifier.{latencyBudgetMs,model,confidenceThreshold}).
 *
 * Pure. This is the single source of truth for the enforce-flip write shape: the store
 * writer merges this result into the JSON column. Used for both directions (enforce and
 * rollback to observe/off).
 */
export function setGateModeInConfig(
  config: GovernanceConfig,
  unit: GovernanceGateUnit,
  mode: GovernanceMode,
): GovernanceConfig {
  const key = GATE_UNIT_CONFIG_KEY[unit];
  const existing = (config as unknown as Record<string, unknown>)[key];
  const existingSubBlock =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  return {
    ...(config as unknown as Record<string, unknown>),
    [key]: { ...existingSubBlock, mode },
  } as unknown as GovernanceConfig;
}
