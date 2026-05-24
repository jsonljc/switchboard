// Historical namespace: "marketplace" is NOT a storefront/operator-UX surface.
// This module is live runtime infrastructure — TrustScoreAdapter feeds the
// orchestrator trust path (propose-helpers / lifecycle / shared-context).
// Do not delete or rename opportunistically. See docs/DOCTRINE.md → "Marketplace
// namespace (historical, but live)".
export {
  TrustScoreEngine,
  scoreToAutonomyLevel,
  scoreToPriceTier,
  computeTrustProgression,
  DEFAULT_TRUST_THRESHOLDS,
} from "./trust-score-engine.js";
export type { TrustScoreStore, TrustThresholds } from "./trust-score-engine.js";

export { TrustScoreAdapter, applyAutonomyToRiskTolerance } from "./trust-adapter.js";
export type { PrincipalListingResolver } from "./trust-adapter.js";
