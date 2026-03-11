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
export type { CartridgeConnector, DataCollectionDeps, RevGrowthDeps } from "./data/normalizer.js";
export { MetaAdsConnector } from "./data/meta-ads-connector.js";
export type { MetaAdsConnectorConfig } from "./data/meta-ads-connector.js";

// Scorers
export { scoreSignalHealth } from "./scorers/signal-health.js";
export { scoreCreativeDepth } from "./scorers/creative-depth.js";
export { scoreFunnelLeakage } from "./scorers/funnel-leakage.js";
export { scoreHeadroom } from "./scorers/headroom.js";
export { scoreSalesProcess } from "./scorers/sales-process.js";

// Constraint engine
export { identifyConstraints } from "./constraint-engine/engine.js";
export type { ConstraintResult } from "./constraint-engine/engine.js";

// Action engine
export {
  generateIntervention,
  generateInterventionWithLLM,
  estimateImpact,
  lookupActionType,
} from "./action-engine/engine.js";

// Stores
export type {
  InterventionStore,
  DiagnosticCycleStore,
  DiagnosticCycleRecord,
  RevenueAccountStore,
  RevenueAccountRecord,
  WeeklyDigestStore,
  WeeklyDigestRecord,
} from "./stores/index.js";
export {
  InMemoryInterventionStore,
  InMemoryDiagnosticCycleStore,
  InMemoryRevenueAccountStore,
  InMemoryWeeklyDigestStore,
} from "./stores/index.js";

// Outcome tracking
export { checkOutcomes } from "./outcome/tracker.js";
export type { OutcomeCheckResult } from "./outcome/tracker.js";
export { calibrateFromHistory } from "./outcome/calibrator.js";
export type { CalibrationEntry } from "./outcome/calibrator.js";

// Digest
export { generateWeeklyDigest } from "./digest/generator.js";

// Agent
export { RevenueGrowthAgent } from "./agent/revenue-growth-agent.js";
