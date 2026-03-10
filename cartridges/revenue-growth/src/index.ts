// ---------------------------------------------------------------------------
// revenue-growth — Cyclic constraint-based revenue growth controller
// ---------------------------------------------------------------------------

// Cartridge
export { RevenueGrowthCartridge } from "./cartridge/index.js";
export { bootstrapRevenueGrowthCartridge } from "./cartridge/bootstrap.js";
export type {
  BootstrapRevenueGrowthConfig,
  BootstrapRevenueGrowthResult,
} from "./cartridge/bootstrap.js";
export { REVENUE_GROWTH_MANIFEST, REVENUE_GROWTH_ACTIONS } from "./cartridge/manifest.js";
export { DEFAULT_REVENUE_GROWTH_GUARDRAILS } from "./cartridge/defaults/guardrails.js";
export { DEFAULT_REVENUE_GROWTH_POLICIES } from "./cartridge/defaults/policies.js";

// Data foundation
export {
  collectNormalizedData,
  assignDataConfidenceTier,
  MockConnector,
} from "./data/normalizer.js";
export type { CartridgeConnector, DataCollectionDeps } from "./data/normalizer.js";

// Scorers
export { scoreSignalHealth } from "./scorers/signal-health.js";
export { scoreCreativeDepth } from "./scorers/creative-depth.js";

// Constraint engine
export { identifyConstraints } from "./constraint-engine/engine.js";
export type { ConstraintResult } from "./constraint-engine/engine.js";
