// Agent Home projection and types
export {
  projectWins,
  type WinSource,
  type WinStatus,
  type WinTerminalRecord,
  type WinsSignalStore,
  type WinViewModel,
  type WinsViewModel,
  type WinsAgentConfig,
  type ProseSegment,
  type DataFreshness,
  type ProjectWinsInput,
} from "./wins.js";
export { computeWindowStart, type WinTimeWindow } from "./window.js";
export { formatTimeFolio } from "./time-folio.js";
export { type AgentHomeKey } from "./agent-key.js";

// Metrics (PR-S5)
export {
  projectMetrics,
  type ProjectMetricsInput,
  type MetricsSignalStore,
  type MetricsViewModel,
  type HeroMetric,
  type MetricComparator,
  type SparkPoint,
  type StatCell,
} from "./metrics.js";
export { buildWeekContext, type WeekContext } from "./metrics-buckets.js";
