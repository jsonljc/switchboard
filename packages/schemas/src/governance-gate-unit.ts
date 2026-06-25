import { z } from "zod";
import type { GovernanceVerdictSource } from "./governance-verdict.js";
import {
  resolveGovernanceMode,
  resolveConsentStateConfig,
  GovernanceModeSchema,
  type GovernanceConfig,
  type GovernanceMode,
} from "./governance-config.js";

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

/** Parameters for the `governance.set_gate_mode` operator-mutation intent (slice 3). */
export const GovernanceSetGateModeParametersSchema = z.object({
  deploymentId: z.string().min(1),
  unit: GovernanceGateUnitSchema,
  mode: GovernanceModeSchema,
});
export type GovernanceSetGateModeParameters = z.infer<typeof GovernanceSetGateModeParametersSchema>;

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

/**
 * Reads a unit's CURRENT mode from a governanceConfig, via the same resolver each gate
 * uses (so the displayed mode matches the gate's runtime mode). `null`/absent config or
 * sub-block resolves to "off". The whatsappWindow sub-block is passthrough (not validated
 * by the parent schema), so its mode is read defensively and coerced to "off" if unknown.
 */
export function readGateMode(
  config: GovernanceConfig | null,
  unit: GovernanceGateUnit,
): GovernanceMode {
  switch (unit) {
    case "deterministic":
      return resolveGovernanceMode(config);
    case "claims": {
      // Read the mode defensively rather than via resolveClaimClassifierConfig, which
      // `.parse()`s the whole sub-block and THROWS on a corrupt claimClassifier (a
      // passthrough sub-block survives the parent safeParse). A corrupt sub-block must
      // read as "off", never crash the readiness surface or the flip handler.
      const raw = (config as unknown as Record<string, unknown> | null)?.["claimClassifier"];
      const mode =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>)["mode"] : undefined;
      const parsed = GovernanceModeSchema.safeParse(mode);
      return parsed.success ? parsed.data : "off";
    }
    case "consent":
      return resolveConsentStateConfig(config).mode;
    case "whatsapp": {
      const raw = (config as unknown as Record<string, unknown> | null)?.whatsappWindow;
      const mode =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>)["mode"] : undefined;
      const parsed = GovernanceModeSchema.safeParse(mode);
      return parsed.success ? parsed.data : "off";
    }
  }
}
