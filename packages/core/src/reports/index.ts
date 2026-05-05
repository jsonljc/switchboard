// ---------------------------------------------------------------------------
// @switchboard/core/reports — public API surface
//
// Re-exports types, interfaces, and in-memory implementations for the
// reports projection (operator deep-dive surface).
// ---------------------------------------------------------------------------

export * from "./types.js";
export * from "./interfaces.js";
export {
  windowToRange,
  priorPeriodRange,
  formatCurrencyUSD,
  formatDateFolio,
} from "./period-helpers.js";
export {
  createInMemoryReportCacheStore,
  createInMemoryPdfCacheStore,
  createInMemoryBaselineStore,
} from "./in-memory-store.js";
export { computeAttribution } from "./attribution-rule.js";
export { computeFunnel } from "./funnel-rollup.js";
export { computeCostVsValue, SDR_MONTHLY_USD, AGENCY_MONTHLY_USD } from "./cost-vs-value-rule.js";
export { createPeriodRollup, type ReportDependencies } from "./period-rollup.js";
