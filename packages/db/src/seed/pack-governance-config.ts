import {
  buildObserveGovernanceConfig,
  type Jurisdiction,
  type ObserveGovernanceConfig,
} from "@switchboard/schemas";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "./medspa-governance-config.js";

/**
 * The onboarding-selected service vertical (the vetted "pack" a tenant provisions under).
 * Today the platform ships a single vetted pack (medspa); a new pack (fitness, dental, ...)
 * extends this union and MUST gain a case in `selectPackGovernanceConfig`. The exhaustive
 * switch there makes an unhandled vertical a compile error, so a pack can never ship
 * without a declared governance posture.
 */
export type ProvisioningVertical = "medspa";

/**
 * The onboarding-selected market. Reuses the schema's closed `Jurisdiction` union (SG|MY)
 * so market and jurisdiction can never drift apart; this is a type IMPORT of the L1 union,
 * not an edit to it.
 */
export type ProvisioningMarket = Jurisdiction;

/** The default vertical: keeps an org provisioned without explicit onboarding input on medspa. */
export const DEFAULT_PROVISIONING_VERTICAL: ProvisioningVertical = "medspa";

/** The default market: keeps an org provisioned without explicit onboarding input on SG. */
export const DEFAULT_PROVISIONING_MARKET: ProvisioningMarket = "SG";

/**
 * Onboarding-derived pack selection. Both fields are optional and default to medspa / SG,
 * so a caller that does not (yet) thread onboarding input provisions exactly as before.
 */
export interface PackProvisioningInput {
  vertical?: ProvisioningVertical;
  market?: ProvisioningMarket;
}

/**
 * Pack-selection seam: maps an onboarding (vertical, market) to the pack's default OBSERVE
 * governance posture that a freshly-provisioned Alex deployment is stamped with.
 *
 * This is the single routing point both provisioning seeders now consult instead of
 * hardcoding `MEDSPA_PILOT_GOVERNANCE_CONFIG`: the db pilot-CLI twin `ensureAlexForOrg`
 * (packages/db) and the apps/api `ensureAlexListingForOrg`. Centralising the choice here
 * means a future vertical pack changes seeded posture in ONE place, and the two seeders
 * cannot drift on it.
 *
 * The default (medspa / SG) returns the exact existing `MEDSPA_PILOT_GOVERNANCE_CONFIG`
 * constant, so every existing org (and every caller that omits onboarding input) is
 * byte-identical to before this seam existed. Posture is always OBSERVE (telemetry-only);
 * the observe->enforce flip stays a deliberate per-gate ops config update, never a
 * provisioning default.
 */
export function selectPackGovernanceConfig(
  input: PackProvisioningInput = {},
): ObserveGovernanceConfig {
  const vertical = input.vertical ?? DEFAULT_PROVISIONING_VERTICAL;
  const market = input.market ?? DEFAULT_PROVISIONING_MARKET;

  switch (vertical) {
    case "medspa":
      // Medspa clinics are regulated as `clinicType: "medical"`. Return the canonical
      // seeded constant for the SG default (byte-identical to what the seeders stamped
      // before this seam), and build the same all-gates-observe posture for other markets.
      return market === "SG"
        ? MEDSPA_PILOT_GOVERNANCE_CONFIG
        : buildObserveGovernanceConfig({ jurisdiction: market, clinicType: "medical" });
    default: {
      // Exhaustiveness guard: adding a `ProvisioningVertical` without a case here is a
      // compile error AT THIS DEFINITION, so a new pack can never ship with no posture.
      const _exhaustive: never = vertical;
      throw new Error(`Unsupported provisioning vertical: ${String(_exhaustive)}`);
    }
  }
}
