import { z } from "zod";
import type { GovernanceVerdictSource } from "./governance-verdict.js";

/**
 * The four flippable governance "gate units" — one per mode-bearing sub-block of
 * `governanceConfig`. Each unit is independently flipped off/observe/enforce. The
 * deterministic unit intentionally couples the banned-phrase and price gates
 * (see price-claim-gate.ts). `recovery` and `lifecycleTagging` are not afterSkill
 * reply gates and are deliberately excluded.
 */
export const GOVERNANCE_GATE_UNITS = ["deterministic", "claims", "consent", "whatsapp"] as const;
export const GovernanceGateUnitSchema = z.enum(GOVERNANCE_GATE_UNITS);
export type GovernanceGateUnit = z.infer<typeof GovernanceGateUnitSchema>;

/** Each unit's `governanceConfig` sub-block key. */
export const GATE_UNIT_CONFIG_KEY: Record<
  GovernanceGateUnit,
  "deterministicGate" | "claimClassifier" | "consentState" | "whatsappWindow"
> = {
  deterministic: "deterministicGate",
  claims: "claimClassifier",
  consent: "consentState",
  whatsapp: "whatsappWindow",
};

const SOURCE_GUARD_TO_UNIT: Partial<Record<GovernanceVerdictSource, GovernanceGateUnit>> = {
  banned_phrase_scanner: "deterministic",
  price_gate: "deterministic",
  claim_classifier: "claims",
  consent_gate: "consent",
  whatsapp_window: "whatsapp",
};

/**
 * Maps a verdict `sourceGuard` to its flippable unit, or `null` when the guard is
 * not one of the four flippable units (e.g. `escalation_trigger`).
 */
export function sourceGuardToGateUnit(
  sourceGuard: GovernanceVerdictSource,
): GovernanceGateUnit | null {
  return SOURCE_GUARD_TO_UNIT[sourceGuard] ?? null;
}
