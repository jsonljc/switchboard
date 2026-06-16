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
export { computeFunnel, LPV_DISCLOSURE } from "./funnel-rollup.js";
export {
  computeCostVsValue,
  SDR_MONTHLY_USD,
  AGENCY_MONTHLY_USD,
  COST_VS_VALUE_FOOTNOTE,
} from "./cost-vs-value-rule.js";
export { createPeriodRollup, type ReportDependencies } from "./period-rollup.js";
export {
  buildWeeklyDigest,
  renderWeeklyDigestText,
  type BuildWeeklyDigestOptions,
} from "./weekly-digest.js";
export { computeCampaignRollup } from "./campaign-rollup.js";
export { computeManagedComparison } from "./managed-comparison-rollup.js";
export { captureAdsBaseline } from "./baseline-capture.js";
export {
  createPullQuoteGenerator,
  createAnthropicReportLLMClient,
} from "./pull-quote-generator.js";
