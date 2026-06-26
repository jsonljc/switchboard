import { z } from "zod";
import {
  JurisdictionSchema,
  ClinicTypeSchema,
  type GovernanceConfig,
  type Jurisdiction,
  type ClinicType,
} from "./governance-config.js";

/**
 * Returns a new GovernanceConfig with the org's market (`jurisdiction` + `clinicType`)
 * set, preserving every gate sub-block and every other field. Pure.
 *
 * This is the single source of truth for the market-write shape: the store writer merges
 * this result into the JSON column. Mirrors `setGateModeInConfig` (the gate-flip write),
 * but writes the two top-level market fields instead of a gate sub-block. Market is the
 * org's declaration of its clinic + jurisdiction; it drives currency (currencyForJurisdiction)
 * and is the org-level baseline for per-lead jurisdiction resolution.
 */
export function setMarketInConfig(
  config: GovernanceConfig,
  market: { jurisdiction: Jurisdiction; clinicType: ClinicType },
): GovernanceConfig {
  // Static-key spread (unlike setGateModeInConfig's computed key), so no cast is needed:
  // the result is structurally a GovernanceConfig and every passthrough sub-block is kept.
  return {
    ...config,
    jurisdiction: market.jurisdiction,
    clinicType: market.clinicType,
  };
}

/** Parameters for the `governance.set_market` operator-mutation intent (P2-B slice 2). */
export const GovernanceSetMarketParametersSchema = z.object({
  deploymentId: z.string().min(1),
  jurisdiction: JurisdictionSchema,
  clinicType: ClinicTypeSchema,
});
export type GovernanceSetMarketParameters = z.infer<typeof GovernanceSetMarketParametersSchema>;
