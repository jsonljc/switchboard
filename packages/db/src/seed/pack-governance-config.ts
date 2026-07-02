import {
  resolveRegulatoryProfile,
  type MarketId,
  type ObserveGovernanceConfig,
  type RegulatoryProfileId,
} from "@switchboard/schemas";
import { MEDSPA_PILOT_GOVERNANCE_CONFIG } from "./medspa-governance-config.js";

/**
 * Onboarding-derived provisioning selection. Both fields are OPEN, registry-validated
 * strings (not closed unions): `regulatoryProfileId` is validated against the curated
 * regulatory-profile registry (an unknown id fails closed to `generic`, never a throw)
 * and `market` against the market registry (an unknown market keeps its SG/MY loader
 * jurisdiction for the built posture but fails closed to null currency/PDPA downstream).
 * Both are optional and default to medspa / SG, so a caller that does not (yet) thread
 * onboarding input provisions exactly as before this seam opened.
 */
export interface PackProvisioningInput {
  regulatoryProfileId?: RegulatoryProfileId;
  market?: MarketId;
}

/**
 * Provisioning selector: maps an onboarding (regulatoryProfileId, market) to the OBSERVE
 * governance posture a freshly-provisioned Alex deployment is stamped with. This is the
 * single routing point both provisioning seeders consult instead of hardcoding
 * `MEDSPA_PILOT_GOVERNANCE_CONFIG`: the db pilot-CLI twin `ensureAlexForOrg` (packages/db)
 * and the apps/api `ensureAlexListingForOrg`. Centralising the choice here means a future
 * profile changes seeded posture in ONE place, and the two seeders cannot drift on it.
 *
 * Fail-closed and never throws: an unregistered `regulatoryProfileId` resolves to the
 * `generic` safe-harbor floor via the registry, and an unregistered market rides as a
 * passthrough marker (below) rather than raising. Posture is always OBSERVE
 * (telemetry-only); the observe->enforce flip stays a deliberate per-gate ops config
 * update, never a provisioning default.
 *
 * medspa (the one vetted profile) stays byte-identical: the SG default returns the exact
 * existing `MEDSPA_PILOT_GOVERNANCE_CONFIG` constant BY REFERENCE, and any other market
 * builds the same marker-free medical observe posture as before this seam existed. The
 * `market` + `regulatoryProfileId` passthrough markers are stamped ONLY on the generic /
 * self-serve path (they would drift the medspa byte-identical output).
 */
export function selectPackGovernanceConfig(
  input: PackProvisioningInput = {},
): ObserveGovernanceConfig {
  const regulatoryProfileId = input.regulatoryProfileId ?? "medspa";
  const market = input.market ?? "SG";
  // Unknown id -> generic (fail-closed, no throw). The registry owns posture construction.
  const profile = resolveRegulatoryProfile(regulatoryProfileId);

  if (profile.id === "medspa") {
    // Vetted profile: preserve the exact SH-4 output. The canonical seeded constant for the
    // SG default (byte-identical, by reference), the same all-gates-observe medical posture
    // for any other market, and NEVER a passthrough marker.
    return market === "SG" ? MEDSPA_PILOT_GOVERNANCE_CONFIG : profile.buildObservePosture(market);
  }

  // Generic (and any unregistered id, which resolved to generic): stamp the real requested
  // market and the RESOLVED profile id as passthrough markers so a non-SG/MY market fails
  // closed on currency/PDPA downstream (the stored `jurisdiction` only holds the SG/MY loader
  // jurisdiction). Assign to an intermediate const before returning so TS does not
  // excess-property-check the marker fields against the closed ObserveGovernanceConfig.
  const posture = profile.buildObservePosture(market);
  const stamped = { ...posture, market, regulatoryProfileId: profile.id };
  return stamped;
}
