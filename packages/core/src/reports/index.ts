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
