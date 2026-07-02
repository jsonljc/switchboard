import type { Vertical } from "./vertical.js";
import type { MarketId } from "./market-registry.js";
import { resolveMarket } from "./market-registry.js";
import {
  buildObserveGovernanceConfig,
  buildSafeHarborFloorConfig,
  type ObserveGovernanceConfig,
} from "./governance-config.js";

/**
 * Curated regulatory-profile registry (L1 S2-2): a profile bundles the vertical
 * marker the core loaders read (`loaderVertical`), the compat clinicType value
 * gate consumers read (S2-4+), and the OBSERVE governance posture builder for a
 * given market. Seeded with `generic` and `medspa` ONLY: this is a curated
 * registry, not a pack-authoring surface. A new profile is added here deliberately,
 * never discovered from tenant input.
 *
 * CROSS-LAYER NUANCE: schemas cannot import db's `MEDSPA_PILOT_GOVERNANCE_CONFIG`
 * constant (db sits above schemas in the dependency layering), so the medspa
 * `buildObservePosture` below returns a VALUE-EQUAL observe config (built via
 * `buildObserveGovernanceConfig`), not the by-reference db constant. The
 * by-reference identity for medspa/SG is preserved where it already lives, in the
 * db pack-selection seam (`selectPackGovernanceConfig`, wired in S2-4); this
 * registry's tests assert value-equality only (`toEqual`, not `toBe`).
 */
export type RegulatoryProfileId = string; // open, registry-validated

export interface RegulatoryProfile {
  readonly id: RegulatoryProfileId;
  readonly loaderVertical: Vertical; // "medspa" | "generic" for the two seeds
  readonly clinicType: "medical" | "nonMedical"; // compat value gate consumers read (S2-4+)
  readonly buildObservePosture: (market: MarketId) => ObserveGovernanceConfig;
  readonly displayName: string;
}

// Named ahead of PROFILES (rather than read back via PROFILES.generic) so the
// fail-closed fallback below never depends on an indexed lookup: under
// noUncheckedIndexedAccess, a Record's dotted access is exactly as unchecked as
// its bracket access, so a bare `PROFILES.generic` fallback would itself type as
// possibly-undefined. This constant is also the frozen map's `generic` entry, so
// the two never drift and stay the same object (referential identity holds).
const GENERIC_PROFILE: RegulatoryProfile = {
  id: "generic",
  loaderVertical: "generic",
  clinicType: "nonMedical",
  buildObservePosture: (m) =>
    buildSafeHarborFloorConfig({ jurisdiction: resolveMarket(m)?.loaderJurisdiction ?? "SG" }),
  displayName: "Generic (safe-harbor floor)",
};

// Null-prototype backing map: a plain object literal inherits from Object.prototype,
// so `PROFILES["constructor"]` (or "__proto__" / "toString" / etc.) would resolve to the
// inherited value instead of undefined, defeating the `?? GENERIC_PROFILE` fail-closed
// fallback below. Object.create(null) removes the prototype chain so only explicitly-seeded
// ids resolve; everything else (including inherited-key lookalikes) falls through.
const PROFILES: Readonly<Record<RegulatoryProfileId, RegulatoryProfile>> = Object.freeze(
  Object.assign(Object.create(null) as Record<RegulatoryProfileId, RegulatoryProfile>, {
    generic: GENERIC_PROFILE,
    medspa: {
      id: "medspa",
      loaderVertical: "medspa",
      clinicType: "medical",
      buildObservePosture: (m) =>
        buildObserveGovernanceConfig({
          jurisdiction: resolveMarket(m)?.loaderJurisdiction ?? "SG",
          clinicType: "medical",
        }),
      displayName: "Medspa (aesthetic clinics)",
    },
  } satisfies Record<RegulatoryProfileId, RegulatoryProfile>),
);

/**
 * Resolve a regulatory profile by id, failing CLOSED to `generic` (the floor) for
 * any unregistered id. This is the id-form; a config-reading overload arrives in
 * S2-3, so the parameter stays a plain `RegulatoryProfileId` string here.
 */
export function resolveRegulatoryProfile(id: RegulatoryProfileId): RegulatoryProfile {
  return PROFILES[id] ?? GENERIC_PROFILE;
}
